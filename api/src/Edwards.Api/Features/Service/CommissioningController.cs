using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Service;

public sealed class CommissioningQuery : ListQuery
{
    /// <summary>A status, or "open" for everything not completed.</summary>
    public string? Status { get; set; }

    public int? AssetId { get; set; }
}

public sealed record CommissioningItem(int Id, int AssetId, string SerialNumber, string? Model, int CustomerId, string Customer, string City,
    DateOnly PlannedDate, int? EngineerUserId, string? Engineer, CommissioningStatus Status, DateOnly? CompletedDate, int WarrantyMonths,
    string? Remark, bool CanEdit);

public sealed class CommissioningInput
{
    [Required]
    public int? AssetId { get; set; }

    [Required]
    public DateOnly? PlannedDate { get; set; }

    public int? EngineerUserId { get; set; }

    [Range(1, 60)]
    public int WarrantyMonths { get; set; } = 12;

    [StringLength(1000)]
    public string? Remark { get; set; }

    /// <summary>Planned, InProgress or OnHold. Completing has its own action.</summary>
    public CommissioningStatus Status { get; set; } = CommissioningStatus.Planned;
}

public sealed class CompleteCommissioningInput
{
    [Required]
    public DateOnly? CompletedDate { get; set; }

    [Range(1, 60)]
    public int WarrantyMonths { get; set; } = 12;

    [StringLength(1000)]
    public string? Remark { get; set; }
}

/// <summary>
/// Commissioning starts an asset's life: completing it records the commissioning date, starts the warranty
/// and schedules the first service. Dealer and zone sales are told, so they can plan the AMC conversation.
/// </summary>
[Route("api/commissioning")]
public sealed class CommissioningController(AppDbContext db, ICurrentUser currentUser, AlertService alerts, Recipients recipients) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.CommissioningView)]
    public async Task<PagedResult<CommissioningItem>> List([FromQuery] CommissioningQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = db.Commissionings.AsNoTracking().InScope(user);
        if (Clean(q.Search) is string s) query = query.Where(c => c.Asset!.SerialNumber.Contains(s) || c.Asset.Customer!.Name.Contains(s));
        if (q.Status == "open") query = query.Where(c => c.Status != CommissioningStatus.Completed);
        else if (Enum.TryParse<CommissioningStatus>(q.Status, true, out var status)) query = query.Where(c => c.Status == status);
        if (q.AssetId is int assetId) query = query.Where(c => c.AssetId == assetId);

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var canEdit = user.Has(Permissions.CommissioningEdit);
        var items = await Items(query.OrderBy(c => c.Status == CommissioningStatus.Completed).ThenBy(c => c.PlannedDate)
            .Skip((page - 1) * size).Take(size), canEdit).ToListAsync(ct);
        return new PagedResult<CommissioningItem>(items, total, page, size);
    }

    [HttpPost]
    [HasPermission(Permissions.CommissioningEdit)]
    public async Task<ActionResult<CommissioningItem>> Create(CommissioningInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var asset = await db.Assets.InScope(user).Include(a => a.Customer).FirstOrDefaultAsync(a => a.Id == input.AssetId && a.IsActive, ct);
        if (asset is null) return Invalid("assetId", "Choose an active asset you have access to.");
        if (asset.CommissioningDate is not null) return StateConflict("This asset is already commissioned.");
        if (await db.Commissionings.AnyAsync(c => c.AssetId == asset.Id && c.Status != CommissioningStatus.Completed, ct))
            return StateConflict("This asset already has commissioning planned.");
        if (input.Status == CommissioningStatus.Completed) return Invalid("status", "Use Complete to record a finished commissioning.");
        if (input.EngineerUserId is int engineer && !await db.CanServeAsync(engineer, asset.Customer!.DealerId, ct))
            return Invalid("engineerUserId", "Choose an Edwards engineer or an engineer of the customer's dealer.");

        var c = new Commissioning
        {
            AssetId = asset.Id,
            PlannedDate = input.PlannedDate!.Value,
            EngineerUserId = input.EngineerUserId,
            WarrantyMonths = input.WarrantyMonths,
            Remark = Clean(input.Remark),
            Status = input.Status,
        };
        db.Commissionings.Add(c);
        db.LogAsset(asset.Id, "Commissioning", $"Commissioning planned for {c.PlannedDate:dd MMM yyyy}", null, user.UserId);
        await NotifyEngineerAsync(c, asset, user, ct);
        await db.SaveChangesAsync(ct);
        return await GetAsync(c.Id, ct);
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.CommissioningEdit)]
    public async Task<ActionResult<CommissioningItem>> Update(int id, CommissioningInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var c = await db.Commissionings.InScope(user).Include(x => x.Asset).ThenInclude(a => a!.Customer).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        if (c.Status == CommissioningStatus.Completed) return StateConflict("Completed commissioning cannot be changed.");
        if (input.Status == CommissioningStatus.Completed) return Invalid("status", "Use Complete to record a finished commissioning.");
        if (input.EngineerUserId is int engineer && engineer != c.EngineerUserId && !await db.CanServeAsync(engineer, c.Asset!.Customer!.DealerId, ct))
            return Invalid("engineerUserId", "Choose an Edwards engineer or an engineer of the customer's dealer.");

        var engineerChanged = input.EngineerUserId != c.EngineerUserId;
        if (input.PlannedDate != c.PlannedDate)
            db.LogAsset(c.AssetId, "Commissioning", $"Commissioning moved to {input.PlannedDate:dd MMM yyyy}", null, user.UserId);
        c.PlannedDate = input.PlannedDate!.Value;
        c.EngineerUserId = input.EngineerUserId;
        c.WarrantyMonths = input.WarrantyMonths;
        c.Remark = Clean(input.Remark);
        c.Status = input.Status;
        if (engineerChanged) await NotifyEngineerAsync(c, c.Asset!, user, ct);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    [HttpPost("{id:int}/complete")]
    [HasPermission(Permissions.CommissioningEdit)]
    public async Task<ActionResult<CommissioningItem>> Complete(int id, CompleteCommissioningInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var c = await db.Commissionings.InScope(user).Include(x => x.Asset).ThenInclude(a => a!.Customer).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        if (c.Status == CommissioningStatus.Completed) return StateConflict("This commissioning is already completed.");
        var date = input.CompletedDate!.Value;
        if (date > DateOnly.FromDateTime(DateTime.Today)) return Invalid("completedDate", "The completion date cannot be in the future.");

        c.Status = CommissioningStatus.Completed;
        c.CompletedDate = date;
        c.WarrantyMonths = input.WarrantyMonths;
        if (Clean(input.Remark) is string remark) c.Remark = remark;

        var a = c.Asset!;
        a.CommissioningDate = date;
        a.WarrantyStart = date;
        a.WarrantyEnd = date.AddMonths(input.WarrantyMonths).AddDays(-1);
        a.WarrantyAlert60Sent = false;
        a.WarrantyAlert30Sent = false;
        a.NextServiceDate = date.AddMonths(a.ServiceIntervalMonths);
        a.EngineerUserId ??= c.EngineerUserId;
        db.ServiceVisits.Add(new ServiceVisit
        {
            AssetId = a.Id,
            Type = ServiceVisitType.Commissioning,
            EngineerUserId = c.EngineerUserId ?? user.UserId,
            VisitDate = date,
            CompletionDate = date,
            Completed = true,
            Remarks = c.Remark,
        });
        db.LogAsset(a.Id, "Commissioned",
            $"Commissioned on {date:dd MMM yyyy}. Warranty until {a.WarrantyEnd:dd MMM yyyy}; first service due {a.NextServiceDate:dd MMM yyyy}.",
            null, user.UserId);

        var to = await recipients.CustomerTeamAsync(a.Customer!.DealerId, a.Customer.DealerUserId, [RoleDefaults.Sales], ct);
        await alerts.RaiseAsync(AlertType.PostCommissioning, to.Where(x => x != user.UserId), $"Commissioned: {a.SerialNumber}",
            $"{a.Customer.Name}, {a.SiteName ?? a.City}\nCommissioned on {date:dd MMM yyyy}. Warranty runs until {a.WarrantyEnd:dd MMM yyyy}.",
            $"/assets/{a.Id}", ct);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    private async Task NotifyEngineerAsync(Commissioning c, Asset asset, UserContext user, CancellationToken ct)
    {
        if (c.EngineerUserId is not int engineer || engineer == user.UserId) return;
        var customer = asset.Customer?.Name ?? await db.Customers.Where(x => x.Id == asset.CustomerId).Select(x => x.Name).FirstAsync(ct);
        await alerts.RaiseAsync(AlertType.JobAssigned, [engineer], $"Commissioning assigned: {asset.SerialNumber}",
            $"{customer}, {asset.SiteName ?? asset.City}\nPlanned for {c.PlannedDate:dd MMM yyyy}.", "/commissioning", ct);
    }

    private async Task<ActionResult<CommissioningItem>> GetAsync(int id, CancellationToken ct) =>
        await Items(db.Commissionings.AsNoTracking().Where(c => c.Id == id), true).FirstAsync(ct);

    private static IQueryable<CommissioningItem> Items(IQueryable<Commissioning> q, bool canEdit) =>
        q.Select(c => new CommissioningItem(c.Id, c.AssetId, c.Asset!.SerialNumber, c.Asset.ProductModel != null ? c.Asset.ProductModel.Name : null,
            c.Asset.CustomerId, c.Asset.Customer!.Name, c.Asset.City, c.PlannedDate, c.EngineerUserId,
            c.Engineer != null ? (c.Engineer.FirstName + " " + c.Engineer.LastName).Trim() : null, c.Status, c.CompletedDate, c.WarrantyMonths,
            c.Remark, canEdit && c.Status != CommissioningStatus.Completed));
}
