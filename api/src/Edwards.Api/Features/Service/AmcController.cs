using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Service;

public enum AmcState { Upcoming, Active, Ending, Expired, Cancelled }

public sealed class AmcQuery : ListQuery
{
    /// <summary>current (active or ending), ending, upcoming, expired, cancelled or all.</summary>
    public string Status { get; set; } = "current";

    public int? AssetId { get; set; }
    public int? CustomerId { get; set; }
}

public sealed record AmcItem(int Id, int AssetId, string SerialNumber, string? Model, int CustomerId, string Customer, string Dealer,
    int? AmcTypeId, string? AmcType, DateOnly StartDate, DateOnly EndDate, int VisitsPerYear, decimal? Value, string? Remark, AmcState State);

public sealed class AmcInput
{
    [Required]
    public int? AssetId { get; set; }

    public int? AmcTypeId { get; set; }

    [Required]
    public DateOnly? StartDate { get; set; }

    [Required]
    public DateOnly? EndDate { get; set; }

    [Range(0, 12)]
    public int VisitsPerYear { get; set; } = 2;

    [Range(0, 100_000_000_000)]
    public decimal? Value { get; set; }

    [StringLength(1000)]
    public string? Remark { get; set; }
}

/// <summary>Annual maintenance contracts on assets. Contracts on one asset may not overlap.</summary>
[Route("api/amc")]
public sealed class AmcController(AppDbContext db, ICurrentUser currentUser) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.AmcView)]
    public async Task<PagedResult<AmcItem>> List([FromQuery] AmcQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var ending = today.AddDays(ServiceRules.EndingDays);
        var query = db.AmcContracts.AsNoTracking().InScope(user);
        if (Clean(q.Search) is string s) query = query.Where(c => c.Asset!.SerialNumber.Contains(s) || c.Asset.Customer!.Name.Contains(s));
        if (q.AssetId is int assetId) query = query.Where(c => c.AssetId == assetId);
        if (q.CustomerId is int customerId) query = query.Where(c => c.Asset!.CustomerId == customerId);
        query = q.Status switch
        {
            "ending" => query.Where(c => c.IsActive && c.StartDate <= today && c.EndDate >= today && c.EndDate <= ending),
            "upcoming" => query.Where(c => c.IsActive && c.StartDate > today),
            "expired" => query.Where(c => c.IsActive && c.EndDate < today),
            "cancelled" => query.Where(c => !c.IsActive),
            "all" => query,
            _ => query.Where(c => c.IsActive && c.StartDate <= today && c.EndDate >= today),
        };

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await Items(query.OrderBy(c => c.EndDate).Skip((page - 1) * size).Take(size), today).ToListAsync(ct);
        return new PagedResult<AmcItem>(items, total, page, size);
    }

    [HttpPost]
    [HasPermission(Permissions.AmcEdit)]
    public async Task<ActionResult<AmcItem>> Create(AmcInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var asset = await db.Assets.InScope(user).FirstOrDefaultAsync(a => a.Id == input.AssetId && a.IsActive, ct);
        if (asset is null) return Invalid("assetId", "Choose an active asset you have access to.");
        if (await ValidateAsync(input, null, ct) is ActionResult problem) return problem;

        var c = new AmcContract { AssetId = asset.Id };
        Apply(c, input);
        db.AmcContracts.Add(c);
        db.LogAsset(asset.Id, "AMC", $"AMC from {c.StartDate:dd MMM yyyy} to {c.EndDate:dd MMM yyyy}, {c.VisitsPerYear} visits a year", null, user.UserId);
        await db.SaveChangesAsync(ct);
        return await GetAsync(c.Id, ct);
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.AmcEdit)]
    public async Task<ActionResult<AmcItem>> Update(int id, AmcInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var c = await db.AmcContracts.InScope(user).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        if (!c.IsActive) return StateConflict("Cancelled contracts cannot be changed.");
        if (input.AssetId != c.AssetId) return Invalid("assetId", "A contract cannot move to another asset.");
        if (await ValidateAsync(input, c, ct) is ActionResult problem) return problem;

        var end = c.EndDate;
        Apply(c, input);
        if (c.EndDate != end)
        {
            c.Alert60Sent = false;
            c.Alert30Sent = false;
            db.LogAsset(c.AssetId, "AMC", $"AMC end changed to {c.EndDate:dd MMM yyyy}", null, user.UserId);
        }
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    [HttpPost("{id:int}/cancel")]
    [HasPermission(Permissions.AmcEdit)]
    public async Task<ActionResult<AmcItem>> Cancel(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var c = await db.AmcContracts.InScope(user).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        if (!c.IsActive) return StateConflict("This contract is already cancelled.");
        c.IsActive = false;
        db.LogAsset(c.AssetId, "AMC", $"AMC {c.StartDate:dd MMM yyyy} – {c.EndDate:dd MMM yyyy} cancelled", null, user.UserId);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    private async Task<ActionResult?> ValidateAsync(AmcInput input, AmcContract? existing, CancellationToken ct)
    {
        if (input.EndDate <= input.StartDate) ModelState.AddModelError("endDate", "The contract must end after it starts.");
        else if (input.EndDate > input.StartDate!.Value.AddYears(5)) ModelState.AddModelError("endDate", "A contract can run for at most 5 years.");
        var keepType = existing?.AmcTypeId;
        if (input.AmcTypeId is int type && !await db.Set<AmcType>().AnyAsync(t => t.Id == type && (t.IsActive || t.Id == keepType), ct))
            ModelState.AddModelError("amcTypeId", "Choose an AMC type from the list.");
        var id = existing?.Id ?? 0;
        if (ModelState.IsValid && await db.AmcContracts.AnyAsync(c => c.AssetId == input.AssetId && c.IsActive && c.Id != id
                && c.StartDate <= input.EndDate && c.EndDate >= input.StartDate, ct))
            ModelState.AddModelError("startDate", "These dates overlap another contract on this asset.");
        return ModelState.IsValid ? null : ValidationProblem(ModelState);
    }

    private static void Apply(AmcContract c, AmcInput input)
    {
        c.AmcTypeId = input.AmcTypeId;
        c.StartDate = input.StartDate!.Value;
        c.EndDate = input.EndDate!.Value;
        c.VisitsPerYear = input.VisitsPerYear;
        c.Value = input.Value;
        c.Remark = Clean(input.Remark);
    }

    private async Task<ActionResult<AmcItem>> GetAsync(int id, CancellationToken ct) =>
        await Items(db.AmcContracts.AsNoTracking().Where(c => c.Id == id), DateOnly.FromDateTime(DateTime.Today)).FirstAsync(ct);

    private static IQueryable<AmcItem> Items(IQueryable<AmcContract> q, DateOnly today) =>
        q.Select(c => new AmcItem(c.Id, c.AssetId, c.Asset!.SerialNumber, c.Asset.ProductModel != null ? c.Asset.ProductModel.Name : null,
            c.Asset.CustomerId, c.Asset.Customer!.Name, c.Asset.Customer.Dealer!.Name, c.AmcTypeId, c.AmcType != null ? c.AmcType.Name : null,
            c.StartDate, c.EndDate, c.VisitsPerYear, c.Value, c.Remark, StateOf(c.IsActive, c.StartDate, c.EndDate, today)));

    private static AmcState StateOf(bool active, DateOnly start, DateOnly end, DateOnly today) =>
        !active ? AmcState.Cancelled
        : start > today ? AmcState.Upcoming
        : end < today ? AmcState.Expired
        : end <= today.AddDays(ServiceRules.EndingDays) ? AmcState.Ending
        : AmcState.Active;
}
