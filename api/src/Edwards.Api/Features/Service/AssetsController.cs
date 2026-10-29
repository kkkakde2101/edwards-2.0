using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Service;

public sealed class AssetQuery : ListQuery
{
    public int? CustomerId { get; set; }

    /// <summary>warranty, ending, amc, expired or none.</summary>
    public string? Coverage { get; set; }

    /// <summary>Only assets whose next service is due within 30 days (or overdue).</summary>
    public bool ServiceDue { get; set; }

    public string Status { get; set; } = "active";
}

public sealed record AssetListItem(int Id, string SerialNumber, string? Model, string? Range, int CustomerId, string Customer, string Dealer,
    string City, DateOnly? CommissioningDate, DateOnly? WarrantyEnd, DateOnly? AmcEnd, Coverage Coverage, DateOnly? NextServiceDate,
    string? Engineer, bool IsActive);

public sealed record AssetEventItem(long Id, DateTime At, string Kind, string Text, string? Link, string? By);

public sealed record AmcSummary(int Id, string? Type, DateOnly StartDate, DateOnly EndDate, int VisitsPerYear, decimal? Value, bool IsActive);

public sealed record CommissioningSummary(int Id, DateOnly PlannedDate, CommissioningStatus Status, DateOnly? CompletedDate, string? Engineer);

public sealed record JobSummary(int Id, string Number, string Problem, JobStatus Status, JobPriority Priority, DateTime CreatedAt);

public sealed record AssetActions(bool Edit, bool RaiseJob, bool AddAmc, bool Commission);

public sealed record AssetDetail(int Id, string SerialNumber, int? ProductRangeId, string? ProductRange, int? ProductModelId, string? ProductModel,
    string? Description, int CustomerId, string Customer, int DealerId, string Dealer, string? SiteName, string City, string PinCode,
    DateOnly? CommissioningDate, DateOnly? WarrantyStart, DateOnly? WarrantyEnd, DateOnly? AmcEnd, Coverage Coverage, int ServiceIntervalMonths,
    DateOnly? LastServiceDate, DateOnly? NextServiceDate, int? EngineerUserId, string? Engineer, int? SourceOpportunityId, bool IsActive,
    DateTime CreatedAt, List<AssetEventItem> Timeline, List<AmcSummary> Amc, List<CommissioningSummary> Commissionings, List<JobSummary> Jobs,
    AssetActions? Actions);

public sealed class AssetInput
{
    [Required]
    public int? CustomerId { get; set; }

    [Required]
    public int? ProductRangeId { get; set; }

    [Required]
    public int? ProductModelId { get; set; }

    [Required, StringLength(100, MinimumLength = 2)]
    public string SerialNumber { get; set; } = "";

    [StringLength(300)]
    public string? Description { get; set; }

    [StringLength(200)]
    public string? SiteName { get; set; }

    [Required, StringLength(100)]
    public string City { get; set; } = "";

    [Required, RegularExpression("^[1-9][0-9]{5}$", ErrorMessage = "Enter a 6-digit PIN code.")]
    public string PinCode { get; set; } = "";

    [Range(1, 24)]
    public int ServiceIntervalMonths { get; set; } = 6;

    public int? EngineerUserId { get; set; }

    /// <summary>The won opportunity that sold this unit.</summary>
    public int? SourceOpportunityId { get; set; }

    /// <summary>For units already installed: filled in here instead of through commissioning.</summary>
    public DateOnly? CommissioningDate { get; set; }

    public DateOnly? WarrantyStart { get; set; }
    public DateOnly? WarrantyEnd { get; set; }
    public DateOnly? LastServiceDate { get; set; }
    public DateOnly? NextServiceDate { get; set; }
}

[Route("api/assets")]
public sealed class AssetsController(AppDbContext db, ICurrentUser currentUser) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.AssetsView)]
    public async Task<PagedResult<AssetListItem>> List([FromQuery] AssetQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var ending = today.AddDays(ServiceRules.EndingDays);
        var query = db.Assets.AsNoTracking().InScope(user);
        query = q.Status switch { "inactive" => query.Where(a => !a.IsActive), "all" => query, _ => query.Where(a => a.IsActive) };
        if (Clean(q.Search) is string s)
            query = query.Where(a => a.SerialNumber.Contains(s) || a.Customer!.Name.Contains(s) || a.ProductModel!.Name.Contains(s) || a.City.Contains(s));
        if (q.CustomerId is int customerId) query = query.Where(a => a.CustomerId == customerId);
        if (q.ServiceDue) query = query.Where(a => a.NextServiceDate != null && a.NextServiceDate <= today.AddDays(30));

        // Coverage is worked out from the latest active AMC and the warranty end date, the same way as CoverageOf.
        var withAmc = query.Select(a => new
        {
            Asset = a,
            AmcEnd = db.AmcContracts.Where(c => c.AssetId == a.Id && c.IsActive && c.StartDate <= today).Max(c => (DateOnly?)c.EndDate),
        });
        withAmc = q.Coverage switch
        {
            "amc" => withAmc.Where(x => x.AmcEnd >= today),
            "warranty" => withAmc.Where(x => !(x.AmcEnd >= today) && x.Asset.WarrantyEnd >= today),
            "ending" => withAmc.Where(x => (x.AmcEnd >= today && x.AmcEnd <= ending)
                || (!(x.AmcEnd >= today) && x.Asset.WarrantyEnd >= today && x.Asset.WarrantyEnd <= ending)),
            "expired" => withAmc.Where(x => !(x.AmcEnd >= today) && !(x.Asset.WarrantyEnd >= today)
                && (x.AmcEnd != null || x.Asset.WarrantyEnd != null)),
            "none" => withAmc.Where(x => x.AmcEnd == null && x.Asset.WarrantyEnd == null),
            _ => withAmc,
        };

        var total = await withAmc.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await withAmc
            .OrderBy(x => x.Asset.Customer!.Name).ThenBy(x => x.Asset.SerialNumber)
            .Skip((page - 1) * size).Take(size)
            .Select(x => new AssetListItem(x.Asset.Id, x.Asset.SerialNumber, x.Asset.ProductModel != null ? x.Asset.ProductModel.Name : null,
                x.Asset.ProductRange != null ? x.Asset.ProductRange.Name : null, x.Asset.CustomerId, x.Asset.Customer!.Name,
                x.Asset.Customer.Dealer!.Name, x.Asset.City, x.Asset.CommissioningDate, x.Asset.WarrantyEnd, x.AmcEnd,
                ServiceRules.CoverageOf(x.Asset.WarrantyEnd, x.AmcEnd, today), x.Asset.NextServiceDate,
                x.Asset.Engineer != null ? (x.Asset.Engineer.FirstName + " " + x.Asset.Engineer.LastName).Trim() : null, x.Asset.IsActive))
            .ToListAsync(ct);
        return new PagedResult<AssetListItem>(items, total, page, size);
    }

    [HttpGet("{id:int}")]
    [HasPermission(Permissions.AssetsView)]
    public async Task<ActionResult<AssetDetail>> Get(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var a = await db.Assets.AsNoTracking().InScope(user).Where(x => x.Id == id)
            .Select(x => new AssetDetail(x.Id, x.SerialNumber, x.ProductRangeId, x.ProductRange != null ? x.ProductRange.Name : null,
                x.ProductModelId, x.ProductModel != null ? x.ProductModel.Name : null, x.Description, x.CustomerId, x.Customer!.Name,
                x.Customer.DealerId, x.Customer.Dealer!.Name, x.SiteName, x.City, x.PinCode, x.CommissioningDate, x.WarrantyStart, x.WarrantyEnd,
                db.AmcContracts.Where(c => c.AssetId == x.Id && c.IsActive && c.StartDate <= today).Max(c => (DateOnly?)c.EndDate),
                Coverage.None, x.ServiceIntervalMonths, x.LastServiceDate, x.NextServiceDate, x.EngineerUserId,
                x.Engineer != null ? (x.Engineer.FirstName + " " + x.Engineer.LastName).Trim() : null, x.SourceOpportunityId, x.IsActive,
                x.CreatedAt,
                db.AssetEvents.Where(e => e.AssetId == x.Id).OrderByDescending(e => e.At).ThenByDescending(e => e.Id).Take(100)
                    .Select(e => new AssetEventItem(e.Id, e.At, e.Kind, e.Text, e.Link,
                        db.Users.Where(u => u.Id == e.UserId).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefault()))
                    .ToList(),
                db.AmcContracts.Where(c => c.AssetId == x.Id).OrderByDescending(c => c.StartDate)
                    .Select(c => new AmcSummary(c.Id, c.AmcType != null ? c.AmcType.Name : null, c.StartDate, c.EndDate, c.VisitsPerYear, c.Value,
                        c.IsActive)).ToList(),
                db.Commissionings.Where(c => c.AssetId == x.Id).OrderByDescending(c => c.PlannedDate)
                    .Select(c => new CommissioningSummary(c.Id, c.PlannedDate, c.Status, c.CompletedDate,
                        c.Engineer != null ? (c.Engineer.FirstName + " " + c.Engineer.LastName).Trim() : null)).ToList(),
                db.ServiceJobs.Where(j => j.AssetId == x.Id).OrderByDescending(j => j.Id).Take(20)
                    .Select(j => new JobSummary(j.Id, j.Number, j.Problem, j.Status, j.Priority, j.CreatedAt)).ToList(),
                null))
            .FirstOrDefaultAsync(ct);
        if (a is null) return NotFound();
        return a with
        {
            Coverage = ServiceRules.CoverageOf(a.WarrantyEnd, a.AmcEnd, today),
            Actions = new AssetActions(
                Edit: user.Has(Permissions.AssetsEdit),
                RaiseJob: a.IsActive && user.Has(Permissions.JobsCreate),
                AddAmc: a.IsActive && user.Has(Permissions.AmcEdit),
                Commission: a.IsActive && a.CommissioningDate is null && user.Has(Permissions.CommissioningEdit)
                    && !a.Commissionings.Any(c => c.Status != CommissioningStatus.Completed)),
        };
    }

    [HttpPost]
    [HasPermission(Permissions.AssetsCreate)]
    public async Task<ActionResult<AssetDetail>> Create(AssetInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var customer = await db.Customers.InScope(user).FirstOrDefaultAsync(c => c.Id == input.CustomerId && c.IsActive, ct);
        if (customer is null) return Invalid("customerId", "Choose an active customer you have access to.");
        if (await ValidateAsync(input, customer, null, ct) is ActionResult problem) return problem;

        var asset = new Asset { CustomerId = customer.Id };
        Apply(asset, input);
        db.Assets.Add(asset);
        await db.SaveChangesAsync(ct);
        db.LogAsset(asset.Id, "Created", input.SourceOpportunityId is int o ? $"Registered from opportunity {o}" : "Registered",
            input.SourceOpportunityId is int op ? $"/opportunities/{op}" : null, user.UserId);
        if (asset.CommissioningDate is DateOnly d) db.LogAsset(asset.Id, "Commissioned", $"Commissioned on {d:dd MMM yyyy} (installed base)", null, user.UserId);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = asset.Id }, (await Get(asset.Id, ct)).Value);
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.AssetsEdit)]
    public async Task<ActionResult<AssetDetail>> Update(int id, AssetInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var asset = await db.Assets.InScope(user).Include(a => a.Customer).FirstOrDefaultAsync(a => a.Id == id, ct);
        if (asset is null) return NotFound();
        if (input.CustomerId != asset.CustomerId) return Invalid("customerId", "An asset cannot move to another customer.");
        if (await ValidateAsync(input, asset.Customer!, asset, ct) is ActionResult problem) return problem;

        var warrantyEnd = asset.WarrantyEnd;
        Apply(asset, input);
        if (asset.WarrantyEnd != warrantyEnd)
        {
            asset.WarrantyAlert60Sent = false;
            asset.WarrantyAlert30Sent = false;
            db.LogAsset(asset.Id, "Warranty", $"Warranty end changed to {asset.WarrantyEnd:dd MMM yyyy}", null, user.UserId);
        }
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/deactivate")]
    [HasPermission(Permissions.AssetsEdit)]
    public Task<ActionResult<AssetDetail>> Deactivate(int id, CancellationToken ct) => SetActive(id, false, ct);

    [HttpPost("{id:int}/activate")]
    [HasPermission(Permissions.AssetsEdit)]
    public Task<ActionResult<AssetDetail>> Activate(int id, CancellationToken ct) => SetActive(id, true, ct);

    private async Task<ActionResult<AssetDetail>> SetActive(int id, bool active, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var asset = await db.Assets.InScope(user).FirstOrDefaultAsync(a => a.Id == id, ct);
        if (asset is null) return NotFound();
        if (asset.IsActive == active) return StateConflict(active ? "The asset is already active." : "The asset is already inactive.");
        asset.IsActive = active;
        db.LogAsset(asset.Id, "Status", active ? "Reactivated" : "Deactivated (scrapped or removed)", null, user.UserId);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    private async Task<ActionResult?> ValidateAsync(AssetInput input, Customer customer, Asset? existing, CancellationToken ct)
    {
        var keepModel = existing?.ProductModelId;
        if (!await db.ProductModels.AnyAsync(m => m.Id == input.ProductModelId && m.ProductRangeId == input.ProductRangeId
                && (m.IsActive || m.Id == keepModel), ct))
            ModelState.AddModelError("productModelId", "Choose a model from the selected product range.");
        var serial = input.SerialNumber.Trim();
        if (await db.Assets.AnyAsync(a => a.SerialNumber == serial && a.ProductModelId == input.ProductModelId
                && a.Id != (existing == null ? 0 : existing.Id), ct))
            ModelState.AddModelError("serialNumber", "This serial number is already registered for this model.");
        if (input.EngineerUserId is int engineer && engineer != existing?.EngineerUserId && !await db.CanServeAsync(engineer, customer.DealerId, ct))
            ModelState.AddModelError("engineerUserId", "Choose an Edwards engineer or an engineer of the customer's dealer.");
        if (input.SourceOpportunityId is int o && !await db.Opportunities.AnyAsync(x => x.Id == o && x.CustomerId == customer.Id
                && x.Stage == OpportunityStage.Won, ct))
            ModelState.AddModelError("sourceOpportunityId", "Choose a won opportunity of this customer.");
        var today = DateOnly.FromDateTime(DateTime.Today);
        if (input.CommissioningDate > today) ModelState.AddModelError("commissioningDate", "The commissioning date cannot be in the future.");
        if (input.LastServiceDate > today) ModelState.AddModelError("lastServiceDate", "The last service date cannot be in the future.");
        if (input.WarrantyStart is DateOnly ws && input.WarrantyEnd is DateOnly we && we < ws)
            ModelState.AddModelError("warrantyEnd", "Warranty must end after it starts.");
        if (input.WarrantyEnd is not null && input.WarrantyStart is null && input.CommissioningDate is null)
            ModelState.AddModelError("warrantyStart", "Enter when the warranty starts.");
        return ModelState.IsValid ? null : ValidationProblem(ModelState);
    }

    private static void Apply(Asset a, AssetInput input)
    {
        a.ProductRangeId = input.ProductRangeId;
        a.ProductModelId = input.ProductModelId;
        a.SerialNumber = input.SerialNumber.Trim();
        a.Description = Clean(input.Description);
        a.SiteName = Clean(input.SiteName);
        a.City = input.City.Trim();
        a.PinCode = input.PinCode.Trim();
        a.ServiceIntervalMonths = input.ServiceIntervalMonths;
        a.EngineerUserId = input.EngineerUserId;
        a.SourceOpportunityId = input.SourceOpportunityId;
        a.CommissioningDate = input.CommissioningDate;
        // An installed unit without explicit dates gets the standard 12-month warranty from commissioning.
        a.WarrantyStart = input.WarrantyStart ?? input.CommissioningDate;
        a.WarrantyEnd = input.WarrantyEnd ?? a.WarrantyStart?.AddMonths(12).AddDays(-1);
        a.LastServiceDate = input.LastServiceDate;
        a.NextServiceDate = input.NextServiceDate ?? (input.LastServiceDate ?? input.CommissioningDate)?.AddMonths(input.ServiceIntervalMonths);
    }
}
