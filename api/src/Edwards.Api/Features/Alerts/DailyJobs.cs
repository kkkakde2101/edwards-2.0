using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Sales;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Alerts;

public sealed record DailyJobResult(int FollowUpsOverdue, int TransfersApplied, int RemindersCreated, int UpcomingServices, int WarrantyAlerts,
    int AmcAlerts);

/// <summary>
/// Time-based work: overdue follow-ups, transfers reaching their effective date, service reminders and expiry warnings.
/// Each step marks what it handled, so running it again on the same day does nothing twice.
/// </summary>
public sealed class DailyJobRunner(AppDbContext db, AlertService alerts, Recipients recipients)
{
    private const int Batch = 500;

    public async Task<DailyJobResult> RunAsync(DateOnly today, CancellationToken ct) => new(
        await FollowUpsOverdueAsync(today, ct),
        await TransfersDueAsync(today, ct),
        await ServiceRemindersAsync(today, ct),
        await UpcomingServicesAsync(today, ct),
        await WarrantyEndingAsync(today, ct),
        await AmcEndingAsync(today, ct));

    private async Task<int> FollowUpsOverdueAsync(DateOnly today, CancellationToken ct)
    {
        var due = await db.Opportunities.Include(o => o.Customer)
            .Where(o => o.IsActive && (o.Stage == OpportunityStage.Open || o.Stage == OpportunityStage.Postponed)
                && o.NextFollowUpDate < today && !o.FollowUpOverdueAlerted)
            .OrderBy(o => o.Id).Take(Batch).ToListAsync(ct);
        foreach (var o in due)
        {
            var to = new List<int?> { o.DealerUserId, o.OwnerUserId };
            if (o.DealerUserId is null) to.AddRange((await recipients.DealerPrincipalsAsync(o.DealerId, ct)).Cast<int?>());
            await alerts.RaiseAsync(AlertType.FollowUpOverdue, to, $"Follow-up overdue: {o.Name}",
                $"{o.Customer!.Name}\nThe follow-up planned for {o.NextFollowUpDate:dd MMM yyyy} has not been logged.", $"/opportunities/{o.Id}", ct);
            o.FollowUpOverdueAlerted = true;
        }
        await db.SaveChangesAsync(ct);
        return due.Count;
    }

    private async Task<int> TransfersDueAsync(DateOnly today, CancellationToken ct)
    {
        var due = await db.CustomerTransfers
            .Where(t => t.Status == TransferStatus.Approved && t.AppliedAt == null && t.EffectiveDate <= today)
            .OrderBy(t => t.EffectiveDate).ThenBy(t => t.Id).ToListAsync(ct);
        var applied = 0;
        foreach (var t in due)
        {
            var dealerId = await db.Customers.Where(c => c.Id == t.CustomerId).Select(c => c.DealerId).FirstAsync(ct);
            if (dealerId != t.FromDealerId)
            {
                t.AppliedAt = DateTime.UtcNow;
                t.DecisionRemark = $"{t.DecisionRemark} Not applied: the customer had already moved.".Trim();
            }
            else
            {
                await CustomerTransfers.ApplyAsync(db, t, ct);
                applied++;
            }
            await db.SaveChangesAsync(ct);
        }
        return applied;
    }

    private async Task<int> ServiceRemindersAsync(DateOnly today, CancellationToken ct)
    {
        var horizon = today.AddDays(30);
        var assets = await db.Assets.Include(a => a.Customer).Include(a => a.ProductModel)
            .Where(a => a.IsActive && a.Customer!.IsActive && a.NextServiceDate != null && a.NextServiceDate <= horizon
                && !db.ServiceReminders.Any(r => r.AssetId == a.Id && r.DueDate == a.NextServiceDate))
            .OrderBy(a => a.NextServiceDate).Take(Batch).ToListAsync(ct);
        var now = DateTime.UtcNow;
        foreach (var a in assets)
        {
            db.ServiceReminders.Add(new ServiceReminder { AssetId = a.Id, DueDate = a.NextServiceDate!.Value, Status = ReminderStatus.Pending });
            db.AssetEvents.Add(new AssetEvent { AssetId = a.Id, At = now, Kind = "Reminder", Text = $"Service reminder raised for {a.NextServiceDate:dd MMM yyyy}" });
            var to = await recipients.CustomerTeamAsync(a.Customer!.DealerId, a.Customer.DealerUserId, [RoleDefaults.ServiceCoordinator], ct);
            to.Add(a.EngineerUserId);
            await alerts.RaiseAsync(AlertType.ServiceReminder, to, $"Service due: {a.SerialNumber}",
                $"{a.Customer.Name}\n{a.ProductModel?.Name ?? a.Description} at {a.SiteName ?? a.City}\nThe next service is due on {a.NextServiceDate:dd MMM yyyy}. Contact the customer to plan it.",
                $"/assets/{a.Id}", ct);
        }
        await db.SaveChangesAsync(ct);
        return assets.Count;
    }

    private async Task<int> UpcomingServicesAsync(DateOnly today, CancellationToken ct)
    {
        var horizon = today.AddDays(7);
        var due = await db.ServiceReminders.Include(r => r.Asset).ThenInclude(a => a!.Customer)
            .Where(r => r.IsActive && (r.Status == ReminderStatus.Pending || r.Status == ReminderStatus.Contacted)
                && r.DueDate >= today && r.DueDate <= horizon && !r.UpcomingAlertSent)
            .OrderBy(r => r.DueDate).Take(Batch).ToListAsync(ct);
        foreach (var r in due)
        {
            var a = r.Asset!;
            var to = await recipients.CustomerTeamAsync(a.Customer!.DealerId, a.Customer.DealerUserId, [], ct);
            to.Add(a.EngineerUserId);
            await alerts.RaiseAsync(AlertType.UpcomingService, to, $"Service in {r.DueDate.DayNumber - today.DayNumber} days: {a.SerialNumber}",
                $"{a.Customer.Name}, {a.SiteName ?? a.City}\nService is due on {r.DueDate:dd MMM yyyy}.", "/reminders", ct);
            r.UpcomingAlertSent = true;
        }
        await db.SaveChangesAsync(ct);
        return due.Count;
    }

    private async Task<int> WarrantyEndingAsync(DateOnly today, CancellationToken ct)
    {
        var horizon = today.AddDays(60);
        var soon = today.AddDays(30);
        var assets = await db.Assets.Include(a => a.Customer)
            .Where(a => a.IsActive && a.Customer!.IsActive && a.WarrantyEnd >= today && a.WarrantyEnd <= horizon
                && (!a.WarrantyAlert60Sent || (a.WarrantyEnd <= soon && !a.WarrantyAlert30Sent))
                && !db.AmcContracts.Any(c => c.AssetId == a.Id && c.IsActive && c.EndDate > a.WarrantyEnd))
            .OrderBy(a => a.WarrantyEnd).Take(Batch).ToListAsync(ct);
        foreach (var a in assets)
        {
            var end = a.WarrantyEnd!.Value;
            var to = await recipients.CustomerTeamAsync(a.Customer!.DealerId, a.Customer.DealerUserId,
                [RoleDefaults.Sales, RoleDefaults.ServiceCoordinator], ct);
            await alerts.RaiseAsync(AlertType.WarrantyExpiring, to, $"Warranty ends in {end.DayNumber - today.DayNumber} days: {a.SerialNumber}",
                $"{a.Customer.Name}, {a.SiteName ?? a.City}\nWarranty ends on {end:dd MMM yyyy}. Offer an AMC so the unit stays covered.",
                $"/assets/{a.Id}", ct);
            a.WarrantyAlert60Sent = true;
            if (end <= soon) a.WarrantyAlert30Sent = true;
        }
        await db.SaveChangesAsync(ct);
        return assets.Count;
    }

    private async Task<int> AmcEndingAsync(DateOnly today, CancellationToken ct)
    {
        var horizon = today.AddDays(60);
        var soon = today.AddDays(30);
        var contracts = await db.AmcContracts.Include(c => c.Asset).ThenInclude(a => a!.Customer)
            .Where(c => c.IsActive && c.EndDate >= today && c.EndDate <= horizon
                && (!c.Alert60Sent || (c.EndDate <= soon && !c.Alert30Sent))
                && !db.AmcContracts.Any(n => n.AssetId == c.AssetId && n.IsActive && n.Id != c.Id && n.StartDate > c.StartDate))
            .OrderBy(c => c.EndDate).Take(Batch).ToListAsync(ct);
        foreach (var c in contracts)
        {
            var a = c.Asset!;
            var to = await recipients.CustomerTeamAsync(a.Customer!.DealerId, a.Customer.DealerUserId,
                [RoleDefaults.Sales, RoleDefaults.ServiceCoordinator], ct);
            await alerts.RaiseAsync(AlertType.AmcExpiring, to, $"AMC ends in {c.EndDate.DayNumber - today.DayNumber} days: {a.SerialNumber}",
                $"{a.Customer.Name}, {a.SiteName ?? a.City}\nThe AMC ends on {c.EndDate:dd MMM yyyy}. Offer a renewal.", $"/assets/{a.Id}", ct);
            c.Alert60Sent = true;
            if (c.EndDate <= soon) c.Alert30Sent = true;
        }
        await db.SaveChangesAsync(ct);
        return contracts.Count;
    }
}

/// <summary>Runs <see cref="DailyJobRunner"/> shortly after start and then every hour.</summary>
public sealed class DailyJobs(IServiceScopeFactory scopes, ILogger<DailyJobs> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var runner = scope.ServiceProvider.GetRequiredService<DailyJobRunner>();
                var result = await runner.RunAsync(DateOnly.FromDateTime(DateTime.Today), stoppingToken);
                log.LogInformation("Daily jobs ran: {Result}", result);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Daily jobs failed.");
            }
            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
        }
    }
}
