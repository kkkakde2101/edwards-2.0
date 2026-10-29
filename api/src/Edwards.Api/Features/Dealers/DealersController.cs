using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Dealers;

public sealed class DealerQuery : ListQuery
{
    public int? ZoneId { get; set; }
    public string Status { get; set; } = "active";
}

public sealed record DealerListItem(int Id, string Name, string Zone, string? Mobile, string? Email, int Users, int Customers, bool IsActive);

public sealed record DealerDetail(int Id, string Name, string? Description, int ZoneId, string Zone, string? Address, string? Mobile,
    string? Pan, string? Email, string? Gstn, bool IsActive);

public sealed class DealerInput
{
    [Required, StringLength(100, MinimumLength = 2)]
    public string Name { get; set; } = "";

    [StringLength(200)]
    public string? Description { get; set; }

    [Required]
    public int? ZoneId { get; set; }

    [StringLength(300)]
    public string? Address { get; set; }

    [StringLength(50)]
    public string? Mobile { get; set; }

    [StringLength(20)]
    public string? Pan { get; set; }

    [EmailAddress, StringLength(100)]
    public string? Email { get; set; }

    [StringLength(15)]
    public string? Gstn { get; set; }

    public bool IsActive { get; set; } = true;
}

[Route("api/dealers")]
public sealed class DealersController(AppDbContext db, ICurrentUser currentUser) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.DealersView)]
    public async Task<PagedResult<DealerListItem>> List([FromQuery] DealerQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = db.Dealers.AsNoTracking().InScope(user);
        if (Clean(q.Search) is string s) query = query.Where(d => d.Name.Contains(s) || (d.Email != null && d.Email.Contains(s)));
        if (q.ZoneId is int zoneId) query = query.Where(d => d.ZoneId == zoneId);
        query = q.Status switch { "inactive" => query.Where(d => !d.IsActive), "all" => query, _ => query.Where(d => d.IsActive) };

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await query
            .OrderBy(d => d.Name)
            .Skip((page - 1) * size).Take(size)
            .Select(d => new DealerListItem(d.Id, d.Name, d.Zone!.Name, d.Mobile, d.Email,
                db.Users.Count(u => u.DealerId == d.Id && u.IsActive),
                db.Customers.Count(c => c.DealerId == d.Id && c.IsActive), d.IsActive))
            .ToListAsync(ct);
        return new PagedResult<DealerListItem>(items, total, page, size);
    }

    [HttpGet("{id:int}")]
    [HasPermission(Permissions.DealersView)]
    public async Task<ActionResult<DealerDetail>> Get(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var d = await db.Dealers.AsNoTracking().InScope(user).Where(x => x.Id == id)
            .Select(x => new DealerDetail(x.Id, x.Name, x.Description, x.ZoneId, x.Zone!.Name, x.Address, x.Mobile, x.Pan, x.Email, x.Gstn, x.IsActive))
            .FirstOrDefaultAsync(ct);
        return d is null ? NotFound() : d;
    }

    [HttpPost]
    [HasPermission(Permissions.DealersEdit)]
    public async Task<ActionResult<DealerDetail>> Create(DealerInput input, CancellationToken ct)
    {
        if (await ValidateAsync(input, null, ct) is ActionResult problem) return problem;
        var dealer = new Dealer();
        Apply(dealer, input);
        db.Dealers.Add(dealer);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = dealer.Id }, (await Get(dealer.Id, ct)).Value);
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.DealersEdit)]
    public async Task<ActionResult<DealerDetail>> Update(int id, DealerInput input, CancellationToken ct)
    {
        var dealer = await db.Dealers.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (dealer is null) return NotFound();
        if (await ValidateAsync(input, id, ct) is ActionResult problem) return problem;
        Apply(dealer, input);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    private async Task<ActionResult?> ValidateAsync(DealerInput input, int? id, CancellationToken ct)
    {
        var name = input.Name.Trim();
        if (await db.Dealers.AnyAsync(d => d.Name == name && d.Id != (id ?? 0), ct))
            ModelState.AddModelError("name", "Another dealer already has this name.");
        if (!await db.Zones.AnyAsync(z => z.Id == input.ZoneId && z.IsActive, ct))
            ModelState.AddModelError("zoneId", "Choose a zone from the list.");
        return ModelState.IsValid ? null : ValidationProblem(ModelState);
    }

    private static void Apply(Dealer d, DealerInput input)
    {
        d.Name = input.Name.Trim();
        d.Description = Clean(input.Description);
        d.ZoneId = input.ZoneId!.Value;
        d.Address = Clean(input.Address);
        d.Mobile = Clean(input.Mobile);
        d.Pan = Clean(input.Pan)?.ToUpperInvariant();
        d.Email = Clean(input.Email);
        d.Gstn = Clean(input.Gstn)?.ToUpperInvariant();
        d.IsActive = input.IsActive;
    }
}

public sealed record RangeTarget(int ProductRangeId, string ProductRange, int TargetQuantity, decimal TargetValue, int AchievedQuantity, decimal AchievedValue);

public sealed record DealerTargetRow(int DealerId, string Dealer, string Zone, decimal TargetValue, decimal AchievedValue, int WonCount, List<RangeTarget> Ranges);

public sealed record TargetSheet(int FiscalYear, string Label, List<DealerTargetRow> Dealers);

public sealed class RangeTargetInput
{
    public int ProductRangeId { get; set; }

    [Range(0, 1_000_000)]
    public int TargetQuantity { get; set; }

    [Range(0, 100_000_000_000)]
    public decimal TargetValue { get; set; }
}

public sealed class DealerTargetInput
{
    [Range(0, 100_000_000_000)]
    public decimal TargetValue { get; set; }

    public List<RangeTargetInput> Ranges { get; set; } = [];
}

/// <summary>Targets per dealer and fiscal year (April–March), with achievement from won opportunities.</summary>
[Route("api/targets")]
public sealed class TargetsController(AppDbContext db, ICurrentUser currentUser) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.TargetsView)]
    public async Task<TargetSheet> Sheet([FromQuery] int? fiscalYear, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var year = fiscalYear ?? FiscalYear.Current;
        var (start, end) = FiscalYear.Range(year);

        var dealers = await db.Dealers.AsNoTracking().InScope(user).Where(d => d.IsActive)
            .OrderBy(d => d.Name).Select(d => new { d.Id, d.Name, Zone = d.Zone!.Name }).ToListAsync(ct);
        var dealerIds = dealers.Select(d => d.Id).ToList();

        var valueTargets = await db.DealerTargets.AsNoTracking()
            .Where(t => t.FiscalYear == year && dealerIds.Contains(t.DealerId)).ToDictionaryAsync(t => t.DealerId, t => t.TargetValue, ct);
        var rangeTargets = await db.DealerQuantityTargets.AsNoTracking()
            .Where(t => t.FiscalYear == year && dealerIds.Contains(t.DealerId))
            .Select(t => new { t.DealerId, t.ProductRangeId, Range = t.ProductRange!.Name, t.TargetQuantity, t.TargetValue }).ToListAsync(ct);

        var won = db.Opportunities.AsNoTracking()
            .Where(o => o.Stage == OpportunityStage.Won && o.ClosedDate >= start && o.ClosedDate <= end && dealerIds.Contains(o.DealerId));
        var wonValue = await won.GroupBy(o => o.DealerId)
            .Select(g => new { DealerId = g.Key, Value = g.Sum(o => o.Value), Count = g.Count() }).ToDictionaryAsync(x => x.DealerId, ct);
        var wonLines = await db.QuotationLines.AsNoTracking()
            .Where(l => l.ProductRangeId != null && db.Quotations.Any(q => q.Id == l.QuotationId && q.Status == QuotationStatus.Accepted
                && won.Any(o => o.Id == q.OpportunityId)))
            .Select(l => new { DealerId = db.Quotations.Where(q => q.Id == l.QuotationId).Select(q => q.Opportunity!.DealerId).First(),
                ProductRangeId = l.ProductRangeId!.Value, Range = l.ProductRange!.Name, l.Quantity, l.LineTotal })
            .ToListAsync(ct);

        var rows = dealers.Select(d =>
        {
            var ranges = rangeTargets.Where(t => t.DealerId == d.Id)
                .Select(t => (t.ProductRangeId, t.Range, t.TargetQuantity, t.TargetValue))
                .Concat(wonLines.Where(l => l.DealerId == d.Id).Select(l => (l.ProductRangeId, l.Range, 0, 0m)))
                .GroupBy(x => (x.ProductRangeId, x.Range))
                .Select(g => new RangeTarget(g.Key.ProductRangeId, g.Key.Range, g.Sum(x => x.Item3), g.Sum(x => x.Item4),
                    wonLines.Where(l => l.DealerId == d.Id && l.ProductRangeId == g.Key.ProductRangeId).Sum(l => l.Quantity),
                    wonLines.Where(l => l.DealerId == d.Id && l.ProductRangeId == g.Key.ProductRangeId).Sum(l => l.LineTotal)))
                .OrderBy(r => r.ProductRange)
                .ToList();
            wonValue.TryGetValue(d.Id, out var w);
            return new DealerTargetRow(d.Id, d.Name, d.Zone, valueTargets.GetValueOrDefault(d.Id), w?.Value ?? 0, w?.Count ?? 0, ranges);
        }).ToList();

        return new TargetSheet(year, FiscalYear.Label(year), rows);
    }

    [HttpPut("{dealerId:int}/{fiscalYear:int}")]
    [HasPermission(Permissions.TargetsEdit)]
    public async Task<IActionResult> Save(int dealerId, int fiscalYear, DealerTargetInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        if (!await db.Dealers.InScope(user).AnyAsync(d => d.Id == dealerId, ct)) return NotFound();
        if (fiscalYear is < 2015 or > 2100) return Invalid("fiscalYear", "Choose a fiscal year between 2015 and 2100.");
        var rangeIds = input.Ranges.Select(r => r.ProductRangeId).Distinct().ToList();
        if (rangeIds.Count != input.Ranges.Count) return Invalid("ranges", "Each product range can appear only once.");
        if (await db.ProductRanges().CountAsync(r => rangeIds.Contains(r.Id), ct) != rangeIds.Count)
            return Invalid("ranges", "Choose product ranges from the list.");

        var target = await db.DealerTargets.FirstOrDefaultAsync(t => t.DealerId == dealerId && t.FiscalYear == fiscalYear, ct);
        if (target is null) db.DealerTargets.Add(target = new DealerTarget { DealerId = dealerId, FiscalYear = fiscalYear });
        target.TargetValue = input.TargetValue;

        var existing = await db.DealerQuantityTargets.Where(t => t.DealerId == dealerId && t.FiscalYear == fiscalYear).ToListAsync(ct);
        db.DealerQuantityTargets.RemoveRange(existing.Where(t => !rangeIds.Contains(t.ProductRangeId)));
        foreach (var r in input.Ranges)
        {
            var row = existing.FirstOrDefault(t => t.ProductRangeId == r.ProductRangeId);
            if (row is null) db.DealerQuantityTargets.Add(row = new DealerQuantityTarget { DealerId = dealerId, FiscalYear = fiscalYear, ProductRangeId = r.ProductRangeId });
            row.TargetQuantity = r.TargetQuantity;
            row.TargetValue = r.TargetValue;
        }
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}

internal static class DbSets
{
    public static IQueryable<ProductRange> ProductRanges(this AppDbContext db) => db.Set<ProductRange>();
}
