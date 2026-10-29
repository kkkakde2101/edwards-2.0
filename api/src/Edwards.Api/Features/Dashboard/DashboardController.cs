using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Service;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Dashboard;

public sealed record NameCount(string Name, int Count);

public sealed record RecentCustomer(int Id, string Name, string? City, string Dealer, DateOnly CustomerDate);

public sealed record DashboardSummary(
    int ActiveCustomers,
    int Contacts,
    int NewLast30Days,
    int MissingCity,
    List<NameCount> ByBusinessLine,
    List<NameCount> BySegment,
    List<RecentCustomer> Recent);

public sealed record StageValue(OpportunityStage Stage, int Count, decimal Value);

public sealed record MonthValue(string Month, int Count, decimal Value);

public sealed record SalesKpis(int OpenLeads, int OpenOpportunities, decimal PipelineValue, int WonCount, decimal WonValue, decimal TargetValue,
    int QuotationsAwaiting, int FollowUpsOverdue, int AwaitingAcceptance, List<StageValue> ByStage, List<MonthValue> WonByMonth);

public sealed record ServiceKpis(int Assets, int OpenJobs, int HighPriorityJobs, int RemindersDue, int WarrantyEnding, int AmcEnding,
    int CommissioningOpen, List<NameCount> JobsByStatus);

public sealed record WorkItem(string Kind, string Title, string Detail, string Link, DateOnly? Due);

public sealed record WorkSummary(string FiscalYear, SalesKpis? Sales, ServiceKpis? Service, List<WorkItem> MyWork);

[ApiController]
[Route("api/dashboard")]
public sealed class DashboardController(AppDbContext db, ICurrentUser currentUser) : ControllerBase
{
    /// <summary>Counts for the signed-in user's data scope only.</summary>
    [HttpGet("summary")]
    [HasPermission(Permissions.DashboardView)]
    public async Task<DashboardSummary> Summary(CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        if (!user.Has(Permissions.CustomersView)) return new DashboardSummary(0, 0, 0, 0, [], [], []);

        var customers = db.Customers.AsNoTracking().InScope(user).Where(c => c.IsActive);
        var since = DateOnly.FromDateTime(DateTime.Today.AddDays(-30));

        var byBusinessLine = await customers
            .GroupBy(c => c.BusinessLine != null ? c.BusinessLine.Name : "Not set")
            .OrderByDescending(g => g.Count())
            .Select(g => new NameCount(g.Key, g.Count()))
            .ToListAsync(ct);

        var bySegment = await customers
            .GroupBy(c => c.Segment!.Name)
            .OrderByDescending(g => g.Count())
            .Take(6)
            .Select(g => new NameCount(g.Key, g.Count()))
            .ToListAsync(ct);

        var recent = await customers
            .OrderByDescending(c => c.CustomerDate).ThenByDescending(c => c.Id)
            .Take(8)
            .Select(c => new RecentCustomer(c.Id, c.Name, c.City, c.Dealer!.Name, c.CustomerDate))
            .ToListAsync(ct);

        return new DashboardSummary(
            await customers.CountAsync(ct),
            await customers.SelectMany(c => c.Contacts).CountAsync(x => x.IsActive, ct),
            await customers.CountAsync(c => c.CustomerDate >= since, ct),
            await customers.CountAsync(c => c.City == null || c.City == "", ct),
            byBusinessLine, bySegment, recent);
    }

    /// <summary>Sales and service figures for the user's scope, and the user's own open work.</summary>
    [HttpGet("work")]
    [HasPermission(Permissions.DashboardView)]
    public async Task<WorkSummary> Work(CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var fy = FiscalYear.Current;
        var (start, end) = FiscalYear.Range(fy);
        var mine = new List<WorkItem>();
        SalesKpis? sales = null;
        ServiceKpis? service = null;

        if (user.Has(Permissions.OpportunitiesView))
        {
            var opps = db.Opportunities.AsNoTracking().InScope(user).Where(o => o.IsActive);
            var open = opps.Where(o => o.Stage == OpportunityStage.Open || o.Stage == OpportunityStage.Postponed);
            var won = opps.Where(o => o.Stage == OpportunityStage.Won && o.ClosedDate >= start && o.ClosedDate <= end);
            var byStage = await opps.GroupBy(o => o.Stage)
                .Select(g => new StageValue(g.Key, g.Count(), g.Sum(o => o.Value))).ToListAsync(ct);
            var byMonth = await won.GroupBy(o => new { o.ClosedDate!.Value.Year, o.ClosedDate.Value.Month })
                .Select(g => new { g.Key.Year, g.Key.Month, Count = g.Count(), Value = g.Sum(o => o.Value) }).ToListAsync(ct);
            var months = Enumerable.Range(0, 12).Select(i => start.AddMonths(i)).Where(m => m <= today)
                .Select(m => byMonth.FirstOrDefault(x => x.Year == m.Year && x.Month == m.Month) is { } x
                    ? new MonthValue(m.ToString("MMM"), x.Count, x.Value)
                    : new MonthValue(m.ToString("MMM"), 0, 0))
                .ToList();
            var dealers = db.Dealers.AsNoTracking().InScope(user).Select(d => d.Id);
            var visibleOpps = db.Opportunities.InScope(user);
            sales = new SalesKpis(
                user.Has(Permissions.LeadsView)
                    ? await db.Leads.AsNoTracking().InScope(user).CountAsync(l => l.IsActive && (l.Status == LeadStatus.New || l.Status == LeadStatus.Qualified), ct)
                    : 0,
                await open.CountAsync(ct),
                await open.SumAsync(o => o.Value, ct),
                await won.CountAsync(ct),
                await won.SumAsync(o => o.Value, ct),
                user.Has(Permissions.TargetsView)
                    ? await db.DealerTargets.AsNoTracking().Where(t => t.FiscalYear == fy && dealers.Contains(t.DealerId)).SumAsync(t => t.TargetValue, ct)
                    : 0,
                await db.Quotations.AsNoTracking().CountAsync(q => q.Status == QuotationStatus.Submitted && visibleOpps.Any(o => o.Id == q.OpportunityId), ct),
                await open.CountAsync(o => o.NextFollowUpDate < today, ct),
                await open.CountAsync(o => !o.DealerAccepted, ct),
                byStage.OrderBy(x => x.Stage).ToList(),
                months);

            // Personal work: what is waiting for this user.
            if (user.UserType != UserType.Edwards && user.DealerId is int dealerId)
                mine.AddRange(await open.Where(o => !o.DealerAccepted && o.DealerId == dealerId).OrderBy(o => o.Id).Take(5)
                    .Select(o => new WorkItem("Accept", o.Name, o.Customer!.Name, "/opportunities/" + o.Id, o.ExpectedCloseDate)).ToListAsync(ct));
            mine.AddRange(await open.Where(o => (o.DealerUserId == user.UserId || o.OwnerUserId == user.UserId) && o.NextFollowUpDate <= today.AddDays(3))
                .OrderBy(o => o.NextFollowUpDate).Take(5)
                .Select(o => new WorkItem("Follow up", o.Name, o.Customer!.Name, "/opportunities/" + o.Id, o.NextFollowUpDate)).ToListAsync(ct));
            if (user.Has(Permissions.QuotationsApprove))
                mine.AddRange(await db.Quotations.AsNoTracking()
                    .Where(q => q.Status == QuotationStatus.Submitted && visibleOpps.Any(o => o.Id == q.OpportunityId))
                    .OrderBy(q => q.SubmittedAt).Take(5)
                    .Select(q => new WorkItem("Review quotation", q.Number, q.Opportunity!.Customer!.Name, "/opportunities/" + q.OpportunityId, null))
                    .ToListAsync(ct));
        }

        if (user.Has(Permissions.TransfersApprove))
            mine.AddRange(await db.CustomerTransfers.AsNoTracking().InScope(user).Where(t => t.Status == TransferStatus.Pending)
                .OrderBy(t => t.RequestedAt).Take(5)
                .Select(t => new WorkItem("Approve transfer", t.Customer!.Name, t.FromDealer!.Name + " → " + t.ToDealer!.Name, "/transfers", t.EffectiveDate))
                .ToListAsync(ct));

        if (user.Has(Permissions.AssetsView) || user.Has(Permissions.JobsView))
        {
            var ending = today.AddDays(ServiceRules.EndingDays);
            var jobs = db.ServiceJobs.AsNoTracking().InScope(user);
            var openJobs = jobs.Where(j => j.Status != JobStatus.Completed && j.Status != JobStatus.Closed);
            var assets = db.Assets.AsNoTracking().InScope(user).Where(a => a.IsActive);
            var jobsByStatus = await openJobs.GroupBy(j => j.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
            service = new ServiceKpis(
                await assets.CountAsync(ct),
                await openJobs.CountAsync(ct),
                await openJobs.CountAsync(j => j.Priority == JobPriority.High, ct),
                await db.ServiceReminders.AsNoTracking().InScope(user)
                    .CountAsync(r => r.IsActive && (r.Status == ReminderStatus.Pending || r.Status == ReminderStatus.Contacted) && r.DueDate <= today.AddDays(30), ct),
                await assets.CountAsync(a => a.WarrantyEnd >= today && a.WarrantyEnd <= ending
                    && !db.AmcContracts.Any(c => c.AssetId == a.Id && c.IsActive && c.EndDate > a.WarrantyEnd), ct),
                await db.AmcContracts.AsNoTracking().InScope(user).CountAsync(c => c.IsActive && c.EndDate >= today && c.EndDate <= ending, ct),
                await db.Commissionings.AsNoTracking().InScope(user).CountAsync(c => c.Status != CommissioningStatus.Completed, ct),
                jobsByStatus.OrderBy(x => x.Key).Select(x => new NameCount(x.Key.ToString(), x.Count)).ToList());

            mine.AddRange(await openJobs.Where(j => j.EngineerUserId == user.UserId).OrderByDescending(j => j.Priority).ThenBy(j => j.PlannedDate).Take(5)
                .Select(j => new WorkItem("Service job", j.Number + " · " + j.Asset!.SerialNumber, j.Asset.Customer!.Name, "/jobs/" + j.Id, j.PlannedDate))
                .ToListAsync(ct));
            if (user.Has(Permissions.RemindersEdit))
                mine.AddRange(await db.ServiceReminders.AsNoTracking().InScope(user)
                    .Where(r => r.IsActive && r.Status == ReminderStatus.Pending && r.DueDate <= today.AddDays(7))
                    .OrderBy(r => r.DueDate).Take(5)
                    .Select(r => new WorkItem("Service due", r.Asset!.SerialNumber, r.Asset.Customer!.Name, "/reminders", r.DueDate))
                    .ToListAsync(ct));
        }

        return new WorkSummary(FiscalYear.Label(fy), sales, service, mine.OrderBy(w => w.Due ?? DateOnly.MaxValue).Take(12).ToList());
    }
}
