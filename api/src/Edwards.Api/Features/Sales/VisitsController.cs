using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Sales;

public sealed class VisitQuery : ListQuery
{
    public int? DealerId { get; set; }
    public int? VisitTypeId { get; set; }
    public int? CustomerId { get; set; }
    public DateOnly? From { get; set; }
    public DateOnly? To { get; set; }
}

public sealed record VisitListItem(int Id, DateOnly VisitDate, string VisitType, int CustomerId, string Customer, string Dealer,
    string? DealerUser, string? Application, bool HasPotential, string? LeadType, string? ProductRange, int? LeadId, string? Lead, int Competitors);

public sealed record CompetitorItem(int? CompetitionMakeId, string? CompetitionMake, string? Model, int? Quantity, int? Working, int? Standby,
    int? PumpTechnologyId, string? PumpTechnology);

public sealed record VisitDetail(int Id, DateOnly VisitDate, int VisitTypeId, string VisitType, int CustomerId, string Customer, int DealerId,
    string Dealer, int? DealerUserId, string? DealerUser, int? ApplicationId, string? Application, string? CustomerProduct, bool HasPotential,
    int? LeadTypeId, string? LeadType, int? ProductRangeId, string? ProductRange, int? ProductModelId, string? ProductModel, string? Remark,
    int? LeadId, string? Lead, List<CompetitorItem> Competitors, DateTime CreatedAt);

public sealed class CompetitorInput
{
    public int? CompetitionMakeId { get; set; }

    [StringLength(100)]
    public string? Model { get; set; }

    [Range(0, 10_000)]
    public int? Quantity { get; set; }

    [Range(0, 10_000)]
    public int? Working { get; set; }

    [Range(0, 10_000)]
    public int? Standby { get; set; }

    public int? PumpTechnologyId { get; set; }
}

public sealed class VisitInput
{
    [Required]
    public DateOnly? VisitDate { get; set; }

    [Required]
    public int? VisitTypeId { get; set; }

    [Required]
    public int? CustomerId { get; set; }

    public int? DealerUserId { get; set; }

    [Required]
    public int? ApplicationId { get; set; }

    [StringLength(100)]
    public string? CustomerProduct { get; set; }

    public bool HasPotential { get; set; }

    [Required]
    public int? LeadTypeId { get; set; }

    public int? ProductRangeId { get; set; }
    public int? ProductModelId { get; set; }

    [StringLength(2000)]
    public string? Remark { get; set; }

    /// <summary>The existing lead a follow-up visit belongs to.</summary>
    public int? LeadId { get; set; }

    public List<CompetitorInput> Competitors { get; set; } = [];
}

[Route("api/visits")]
public sealed class VisitsController(AppDbContext db, ICurrentUser currentUser, AlertService alerts, Recipients recipients) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.VisitsView)]
    public async Task<PagedResult<VisitListItem>> List([FromQuery] VisitQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = db.Visits.AsNoTracking().InScope(user).Where(v => v.IsActive);
        if (Clean(q.Search) is string s) query = query.Where(v => v.Customer!.Name.Contains(s) || (v.Remark != null && v.Remark.Contains(s)));
        if (q.DealerId is int dealerId) query = query.Where(v => v.DealerId == dealerId);
        if (q.VisitTypeId is int typeId) query = query.Where(v => v.VisitTypeId == typeId);
        if (q.CustomerId is int customerId) query = query.Where(v => v.CustomerId == customerId);
        if (q.From is DateOnly from) query = query.Where(v => v.VisitDate >= from);
        if (q.To is DateOnly to) query = query.Where(v => v.VisitDate <= to);

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await query
            .OrderByDescending(v => v.VisitDate).ThenByDescending(v => v.Id)
            .Skip((page - 1) * size).Take(size)
            .Select(v => new VisitListItem(v.Id, v.VisitDate, v.VisitType!.Name, v.CustomerId, v.Customer!.Name, v.Dealer!.Name,
                v.DealerUser != null ? (v.DealerUser.FirstName + " " + v.DealerUser.LastName).Trim() : null,
                v.Application != null ? v.Application.Name : null, v.HasPotential, v.LeadType != null ? v.LeadType.Name : null,
                v.ProductRange != null ? v.ProductRange.Name : null, v.LeadId, v.Lead != null ? v.Lead.Name : null, v.Competitors.Count))
            .ToListAsync(ct);
        return new PagedResult<VisitListItem>(items, total, page, size);
    }

    [HttpGet("{id:int}")]
    [HasPermission(Permissions.VisitsView)]
    public async Task<ActionResult<VisitDetail>> Get(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var v = await db.Visits.AsNoTracking().InScope(user).Where(x => x.Id == id)
            .Select(x => new VisitDetail(x.Id, x.VisitDate, x.VisitTypeId, x.VisitType!.Name, x.CustomerId, x.Customer!.Name, x.DealerId,
                x.Dealer!.Name, x.DealerUserId, x.DealerUser != null ? (x.DealerUser.FirstName + " " + x.DealerUser.LastName).Trim() : null,
                x.ApplicationId, x.Application != null ? x.Application.Name : null, x.CustomerProduct, x.HasPotential,
                x.LeadTypeId, x.LeadType != null ? x.LeadType.Name : null, x.ProductRangeId, x.ProductRange != null ? x.ProductRange.Name : null,
                x.ProductModelId, x.ProductModel != null ? x.ProductModel.Name : null, x.Remark, x.LeadId, x.Lead != null ? x.Lead.Name : null,
                x.Competitors.Select(c => new CompetitorItem(c.CompetitionMakeId, c.CompetitionMake != null ? c.CompetitionMake.Name : null,
                    c.Model, c.Quantity, c.Working, c.Standby, c.PumpTechnologyId, c.PumpTechnology != null ? c.PumpTechnology.Name : null)).ToList(),
                x.CreatedAt))
            .FirstOrDefaultAsync(ct);
        return v is null ? NotFound() : v;
    }

    [HttpPost]
    [HasPermission(Permissions.VisitsCreate)]
    public async Task<ActionResult<VisitDetail>> Create(VisitInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var customer = await db.Customers.InScope(user).Include(c => c.Dealer).FirstOrDefaultAsync(c => c.Id == input.CustomerId && c.IsActive, ct);
        if (customer is null) return Invalid("customerId", "Choose an active customer you have access to.");
        if (await ValidateAsync(input, user, customer, null, ct) is ActionResult problem) return problem;

        var visit = new Visit { DealerId = customer.DealerId };
        Apply(visit, input, user, customer);
        db.Visits.Add(visit);
        await db.SaveChangesAsync(ct);

        if (await NeedsLeadAsync(visit, ct))
        {
            var range = visit.ProductRangeId is int r ? await db.Set<ProductRange>().Where(x => x.Id == r).Select(x => x.Name).FirstOrDefaultAsync(ct) : null;
            // Same pattern as today's app: Dealer_Customer_Range_00VisitId.
            var leadName = string.Join("_", new[] { customer.Dealer!.Name, customer.Name, range, $"00{visit.Id}" }.Where(p => !string.IsNullOrWhiteSpace(p)));
            var lead = new Lead
            {
                Name = leadName.Length > 200 ? leadName[..200] : leadName,
                CustomerId = customer.Id,
                Source = LeadSource.Visit,
                Status = LeadStatus.New,
                VisitId = visit.Id,
                DealerId = visit.DealerId,
                DealerUserId = visit.DealerUserId,
                ProductRangeId = visit.ProductRangeId,
                ProductModelId = visit.ProductModelId,
            };
            db.Leads.Add(lead);
            await db.SaveChangesAsync(ct);
            visit.LeadId = lead.Id;
            await alerts.RaiseAsync(AlertType.LeadAssigned, (await recipients.RoleForDealerZoneAsync(RoleDefaults.Sales, visit.DealerId, ct)).Cast<int?>(),
                "New lead from a visit", $"{customer.Name}: {lead.Name}\nVisit on {visit.VisitDate:dd MMM yyyy} found sales potential.", $"/leads/{lead.Id}", ct);
            await db.SaveChangesAsync(ct);
        }
        return CreatedAtAction(nameof(Get), new { id = visit.Id }, (await Get(visit.Id, ct)).Value);
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.VisitsEdit)]
    public async Task<ActionResult<VisitDetail>> Update(int id, VisitInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var visit = await db.Visits.InScope(user).Include(v => v.Competitors).FirstOrDefaultAsync(v => v.Id == id, ct);
        if (visit is null) return NotFound();
        var customer = await db.Customers.InScope(user).FirstOrDefaultAsync(c => c.Id == input.CustomerId, ct);
        if (customer is null) return Invalid("customerId", "Choose a customer you have access to.");
        if (await ValidateAsync(input, user, customer, visit, ct) is ActionResult problem) return problem;

        visit.DealerId = customer.DealerId;
        Apply(visit, input, user, customer);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    private async Task<ActionResult?> ValidateAsync(VisitInput input, UserContext user, Customer customer, Visit? existing, CancellationToken ct)
    {
        if (input.VisitDate > DateOnly.FromDateTime(DateTime.Today))
            ModelState.AddModelError("visitDate", "A visit cannot be in the future.");
        if (!await db.Set<VisitType>().AnyAsync(x => x.Id == input.VisitTypeId && x.IsActive, ct))
            ModelState.AddModelError("visitTypeId", "Choose a visit type.");
        if (!await db.Set<ApplicationArea>().AnyAsync(x => x.Id == input.ApplicationId && x.IsActive, ct))
            ModelState.AddModelError("applicationId", "Choose an application.");
        if (!await db.Set<LeadType>().AnyAsync(x => x.Id == input.LeadTypeId && x.IsActive, ct))
            ModelState.AddModelError("leadTypeId", "Choose a lead type.");
        if (input.ProductModelId is int modelId && !await db.ProductModels.AnyAsync(m => m.Id == modelId && m.ProductRangeId == input.ProductRangeId, ct))
            ModelState.AddModelError("productModelId", "Choose a model from the selected product range.");
        if (user.Scope != DataScope.Own)
        {
            var engineer = input.DealerUserId ?? customer.DealerUserId;
            var keep = existing?.DealerUserId;
            if (engineer is null || !await db.Users.AnyAsync(u => u.Id == engineer && u.DealerId == customer.DealerId
                    && u.UserType == UserType.DealerUser && (u.IsActive || u.Id == keep), ct))
                ModelState.AddModelError("dealerUserId", "Choose the dealer engineer who made the visit.");
        }
        if (input.LeadId is int leadId && !await db.Leads.AnyAsync(l => l.Id == leadId && l.CustomerId == customer.Id, ct))
            ModelState.AddModelError("leadId", "Choose a lead of this customer.");
        return ModelState.IsValid ? null : ValidationProblem(ModelState);
    }

    private static void Apply(Visit v, VisitInput input, UserContext user, Customer customer)
    {
        v.VisitDate = input.VisitDate!.Value;
        v.VisitTypeId = input.VisitTypeId!.Value;
        v.CustomerId = customer.Id;
        v.DealerUserId = user.Scope == DataScope.Own ? user.UserId : input.DealerUserId ?? customer.DealerUserId;
        v.ApplicationId = input.ApplicationId;
        v.CustomerProduct = Clean(input.CustomerProduct);
        v.HasPotential = input.HasPotential;
        v.LeadTypeId = input.LeadTypeId;
        v.ProductRangeId = input.ProductRangeId;
        v.ProductModelId = input.ProductModelId;
        v.Remark = Clean(input.Remark);
        if (input.LeadId is not null) v.LeadId = input.LeadId;
        v.Competitors.Clear();
        foreach (var c in input.Competitors.Where(c => c.CompetitionMakeId is not null || !string.IsNullOrWhiteSpace(c.Model)))
        {
            v.Competitors.Add(new VisitCompetitor
            {
                CompetitionMakeId = c.CompetitionMakeId,
                Model = Clean(c.Model),
                Quantity = c.Quantity,
                Working = c.Working,
                Standby = c.Standby,
                PumpTechnologyId = c.PumpTechnologyId,
            });
        }
    }

    /// <summary>Today's rule: a visit with potential creates a lead when it is a new lead, or a video call.</summary>
    private async Task<bool> NeedsLeadAsync(Visit visit, CancellationToken ct)
    {
        if (!visit.HasPotential || visit.LeadId is not null) return false;
        var leadType = await db.Set<LeadType>().Where(x => x.Id == visit.LeadTypeId).Select(x => x.Name).FirstOrDefaultAsync(ct) ?? "";
        var visitType = await db.Set<VisitType>().Where(x => x.Id == visit.VisitTypeId).Select(x => x.Name).FirstOrDefaultAsync(ct) ?? "";
        return leadType.Trim().Equals("New Lead", StringComparison.OrdinalIgnoreCase)
            || visitType.Contains("video", StringComparison.OrdinalIgnoreCase);
    }
}
