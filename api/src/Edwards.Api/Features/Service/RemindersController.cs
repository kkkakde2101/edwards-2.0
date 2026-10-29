using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Service;

public sealed class ReminderQuery : ListQuery
{
    /// <summary>A status, or "open" for pending and contacted.</summary>
    public string? Status { get; set; } = "open";

    /// <summary>overdue, or week for the next 7 days.</summary>
    public string? Due { get; set; }

    public int? AssetId { get; set; }
    public int? CustomerId { get; set; }
}

public sealed record ReminderItem(int Id, int AssetId, string SerialNumber, string? Model, int CustomerId, string Customer, string Dealer,
    string City, DateOnly DueDate, DateOnly? LastServiceDate, ReminderStatus Status, string? Notes, string? DismissReason, int? OpportunityId,
    int? ServiceJobId, string? Engineer, bool Covered);

public sealed class ReminderNoteInput
{
    [Required, StringLength(500, MinimumLength = 3)]
    public string Text { get; set; } = "";
}

public sealed class ReminderJobInput
{
    public DateOnly? PlannedDate { get; set; }
    public int? EngineerUserId { get; set; }
}

public sealed record ConvertedTo(int? ServiceJobId, int? OpportunityId);

/// <summary>
/// Service reminders are raised 30 days before an asset's next service date by the daily job. The dealer contacts the customer,
/// then raises a service job (asset under warranty or AMC) or a paid service opportunity, or dismisses the reminder with a reason.
/// </summary>
[Route("api/reminders")]
public sealed class RemindersController(AppDbContext db, ICurrentUser currentUser, JobFactory jobs, AlertService alerts, Recipients recipients)
    : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.RemindersView)]
    public async Task<PagedResult<ReminderItem>> List([FromQuery] ReminderQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var query = db.ServiceReminders.AsNoTracking().InScope(user).Where(r => r.IsActive);
        if (Clean(q.Search) is string s) query = query.Where(r => r.Asset!.SerialNumber.Contains(s) || r.Asset.Customer!.Name.Contains(s));
        if (q.Status == "open") query = query.Where(r => r.Status == ReminderStatus.Pending || r.Status == ReminderStatus.Contacted);
        else if (Enum.TryParse<ReminderStatus>(q.Status, true, out var status)) query = query.Where(r => r.Status == status);
        if (q.Due == "overdue") query = query.Where(r => r.DueDate < today);
        else if (q.Due == "week") query = query.Where(r => r.DueDate >= today && r.DueDate <= today.AddDays(7));
        if (q.AssetId is int assetId) query = query.Where(r => r.AssetId == assetId);
        if (q.CustomerId is int customerId) query = query.Where(r => r.Asset!.CustomerId == customerId);

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await Items(query.OrderBy(r => r.DueDate).ThenBy(r => r.Id).Skip((page - 1) * size).Take(size), today).ToListAsync(ct);
        return new PagedResult<ReminderItem>(items, total, page, size);
    }

    [HttpPost("{id:int}/contacted")]
    [HasPermission(Permissions.RemindersEdit)]
    public async Task<ActionResult<ReminderItem>> Contacted(int id, ReminderNoteInput input, CancellationToken ct)
    {
        var (user, r) = await LoadOpenAsync(id, ct);
        if (r is null) return NotFound();
        if (r.Status is not (ReminderStatus.Pending or ReminderStatus.Contacted)) return StateConflict("This reminder is already closed.");
        r.Status = ReminderStatus.Contacted;
        AddNote(r, user, input.Text);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    [HttpPost("{id:int}/dismiss")]
    [HasPermission(Permissions.RemindersEdit)]
    public async Task<ActionResult<ReminderItem>> Dismiss(int id, ReminderNoteInput input, CancellationToken ct)
    {
        var (user, r) = await LoadOpenAsync(id, ct);
        if (r is null) return NotFound();
        if (r.Status is not (ReminderStatus.Pending or ReminderStatus.Contacted)) return StateConflict("This reminder is already closed.");
        r.Status = ReminderStatus.Dismissed;
        r.DismissReason = input.Text.Trim().Length > 300 ? input.Text.Trim()[..300] : input.Text.Trim();
        db.LogAsset(r.AssetId, "Reminder", $"Service reminder for {r.DueDate:dd MMM yyyy} dismissed: {r.DismissReason}", null, user.UserId);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>Raises a preventive-maintenance job for the reminder.</summary>
    [HttpPost("{id:int}/job")]
    [HasPermission(Permissions.RemindersEdit)]
    public async Task<ActionResult<ConvertedTo>> RaiseJob(int id, ReminderJobInput input, CancellationToken ct)
    {
        var (user, r) = await LoadOpenAsync(id, ct);
        if (r is null) return NotFound();
        if (!user.Has(Permissions.JobsCreate)) return Forbid();
        if (r.Status is not (ReminderStatus.Pending or ReminderStatus.Contacted)) return StateConflict("This reminder is already closed.");
        var asset = r.Asset!;
        var engineer = user.Has(Permissions.JobsAssign) ? input.EngineerUserId ?? asset.EngineerUserId : null;
        if (engineer is int e && !await db.CanServeAsync(e, asset.Customer!.DealerId, ct))
            return Invalid("engineerUserId", "Choose an Edwards engineer or an engineer of the customer's dealer.");

        var job = await jobs.CreateAsync(asset, $"Preventive maintenance due {r.DueDate:dd MMM yyyy}", JobPriority.Medium, JobSource.Reminder,
            input.PlannedDate ?? r.DueDate, engineer, user, ct);
        job.ReminderId = r.Id;
        r.Status = ReminderStatus.Converted;
        r.ServiceJobId = job.Id;
        await db.SaveChangesAsync(ct);
        return new ConvertedTo(job.Id, null);
    }

    /// <summary>Creates a paid service opportunity for an asset outside warranty and AMC.</summary>
    [HttpPost("{id:int}/opportunity")]
    [HasPermission(Permissions.RemindersEdit)]
    public async Task<ActionResult<ConvertedTo>> RaiseOpportunity(int id, CancellationToken ct)
    {
        var (user, r) = await LoadOpenAsync(id, ct);
        if (r is null) return NotFound();
        if (!user.Has(Permissions.OpportunitiesCreate)) return Forbid();
        if (r.Status is not (ReminderStatus.Pending or ReminderStatus.Contacted)) return StateConflict("This reminder is already closed.");
        var asset = r.Asset!;
        var customer = asset.Customer!;
        var o = new Opportunity
        {
            Name = $"Service {asset.SerialNumber} due {r.DueDate:MMM yyyy}",
            Type = OpportunityType.Service,
            Source = OpportunitySource.Reminder,
            Stage = OpportunityStage.Open,
            CustomerId = customer.Id,
            AssetId = asset.Id,
            ReminderId = r.Id,
            DealerId = customer.DealerId,
            DealerUserId = user.Scope == DataScope.Own ? user.UserId : customer.DealerUserId,
            OwnerUserId = user.UserType == UserType.Edwards ? user.UserId : null,
            DealerAccepted = user.UserType != UserType.Edwards,
            ExpectedCloseDate = r.DueDate,
        };
        db.Opportunities.Add(o);
        await db.SaveChangesAsync(ct);
        r.Status = ReminderStatus.Converted;
        r.OpportunityId = o.Id;
        db.LogAsset(asset.Id, "Opportunity", $"Service opportunity raised from the reminder for {r.DueDate:dd MMM yyyy}", $"/opportunities/{o.Id}",
            user.UserId);
        if (!o.DealerAccepted)
        {
            var to = (await recipients.DealerPrincipalsAsync(o.DealerId, ct)).Cast<int?>().Append(o.DealerUserId);
            await alerts.RaiseAsync(AlertType.OpportunityAssigned, to, "Opportunity assigned to you",
                $"{customer.Name}: {o.Name}\nPlease accept it and contact the customer.", $"/opportunities/{o.Id}", ct);
        }
        await db.SaveChangesAsync(ct);
        return new ConvertedTo(null, o.Id);
    }

    private async Task<(UserContext User, ServiceReminder? Reminder)> LoadOpenAsync(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var r = await db.ServiceReminders.InScope(user).Include(x => x.Asset).ThenInclude(a => a!.Customer)
            .FirstOrDefaultAsync(x => x.Id == id && x.IsActive, ct);
        return (user, r);
    }

    private static void AddNote(ServiceReminder r, UserContext user, string text)
    {
        var line = $"{DateTime.Today:dd MMM yyyy}, {user.DisplayName}: {text.Trim()}";
        r.Notes = string.IsNullOrEmpty(r.Notes) ? line : $"{r.Notes}\n{line}";
    }

    private async Task<ActionResult<ReminderItem>> GetAsync(int id, CancellationToken ct) =>
        await Items(db.ServiceReminders.AsNoTracking().Where(r => r.Id == id), DateOnly.FromDateTime(DateTime.Today)).FirstAsync(ct);

    private IQueryable<ReminderItem> Items(IQueryable<ServiceReminder> q, DateOnly today) =>
        q.Select(r => new ReminderItem(r.Id, r.AssetId, r.Asset!.SerialNumber, r.Asset.ProductModel != null ? r.Asset.ProductModel.Name : null,
            r.Asset.CustomerId, r.Asset.Customer!.Name, r.Asset.Customer.Dealer!.Name, r.Asset.City, r.DueDate, r.Asset.LastServiceDate, r.Status,
            r.Notes, r.DismissReason, r.OpportunityId, r.ServiceJobId,
            r.Asset.Engineer != null ? (r.Asset.Engineer.FirstName + " " + r.Asset.Engineer.LastName).Trim() : null,
            db.AmcContracts.Any(c => c.AssetId == r.AssetId && c.IsActive && c.StartDate <= r.DueDate && c.EndDate >= r.DueDate)
                || r.Asset.WarrantyEnd >= r.DueDate));
}
