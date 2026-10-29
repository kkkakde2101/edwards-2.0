using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Sales;

public sealed class LeadQuery : ListQuery
{
    public LeadStatus? Status { get; set; }
    public LeadSource? Source { get; set; }
    public int? DealerId { get; set; }
    public int? CustomerId { get; set; }
}

public sealed record LeadListItem(int Id, string Name, int CustomerId, string Customer, LeadSource Source, LeadStatus Status, string? Dealer,
    string? DealerUser, string? Owner, string? ProductRange, int? OpportunityId, DateTime CreatedAt);

public sealed record LeadDetail(int Id, string Name, int CustomerId, string Customer, LeadSource Source, LeadStatus Status, int? VisitId,
    int? DealerId, string? Dealer, int? DealerUserId, string? DealerUser, int? OwnerUserId, string? Owner, int? ProductRangeId,
    string? ProductRange, int? ProductModelId, string? ProductModel, string? Remark, string? DisqualifyReason, int? OpportunityId,
    DateTime CreatedAt, DateTime? UpdatedAt);

public sealed class LeadInput
{
    [Required, StringLength(200, MinimumLength = 3)]
    public string Name { get; set; } = "";

    [Required]
    public int? CustomerId { get; set; }

    public int? DealerUserId { get; set; }
    public int? OwnerUserId { get; set; }
    public int? ProductRangeId { get; set; }
    public int? ProductModelId { get; set; }

    [StringLength(2000)]
    public string? Remark { get; set; }
}

public sealed class DisqualifyInput
{
    [Required, StringLength(300, MinimumLength = 3)]
    public string Reason { get; set; } = "";
}

public sealed class AssignInput
{
    public int? DealerId { get; set; }
    public int? DealerUserId { get; set; }
    public int? OwnerUserId { get; set; }
}

public sealed class ConvertInput
{
    public OpportunityType Type { get; set; }

    [StringLength(250)]
    public string? Name { get; set; }

    public int? AssetId { get; set; }
    public DateOnly? ExpectedCloseDate { get; set; }
}

[Route("api/leads")]
public sealed class LeadsController(AppDbContext db, ICurrentUser currentUser, AlertService alerts, Recipients recipients) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.LeadsView)]
    public async Task<PagedResult<LeadListItem>> List([FromQuery] LeadQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = db.Leads.AsNoTracking().InScope(user).Where(l => l.IsActive);
        if (Clean(q.Search) is string s) query = query.Where(l => l.Name.Contains(s) || l.Customer!.Name.Contains(s));
        if (q.Status is LeadStatus status) query = query.Where(l => l.Status == status);
        if (q.Source is LeadSource source) query = query.Where(l => l.Source == source);
        if (q.DealerId is int dealerId) query = query.Where(l => l.DealerId == dealerId);
        if (q.CustomerId is int customerId) query = query.Where(l => l.CustomerId == customerId);

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await query
            .OrderByDescending(l => l.CreatedAt).ThenByDescending(l => l.Id)
            .Skip((page - 1) * size).Take(size)
            .Select(l => new LeadListItem(l.Id, l.Name, l.CustomerId, l.Customer!.Name, l.Source, l.Status,
                l.Dealer != null ? l.Dealer.Name : null,
                l.DealerUser != null ? (l.DealerUser.FirstName + " " + l.DealerUser.LastName).Trim() : null,
                l.Owner != null ? (l.Owner.FirstName + " " + l.Owner.LastName).Trim() : null,
                l.ProductRange != null ? l.ProductRange.Name : null, l.OpportunityId, l.CreatedAt))
            .ToListAsync(ct);
        return new PagedResult<LeadListItem>(items, total, page, size);
    }

    [HttpGet("{id:int}")]
    [HasPermission(Permissions.LeadsView)]
    public async Task<ActionResult<LeadDetail>> Get(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var l = await Detail(db.Leads.AsNoTracking().InScope(user).Where(x => x.Id == id)).FirstOrDefaultAsync(ct);
        return l is null ? NotFound() : l;
    }

    [HttpPost]
    [HasPermission(Permissions.LeadsCreate)]
    public async Task<ActionResult<LeadDetail>> Create(LeadInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var customer = await db.Customers.InScope(user).FirstOrDefaultAsync(c => c.Id == input.CustomerId && c.IsActive, ct);
        if (customer is null) return Invalid("customerId", "Choose an active customer you have access to.");
        if (await ValidateAsync(input, customer, ct) is ActionResult problem) return problem;

        var lead = new Lead
        {
            Source = LeadSource.Manual,
            Status = LeadStatus.New,
            CustomerId = customer.Id,
            DealerId = customer.DealerId,
        };
        Apply(lead, input, user, customer);
        db.Leads.Add(lead);
        await db.SaveChangesAsync(ct);
        await NotifyAssignedAsync(lead, customer.Name, ct);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = lead.Id }, (await Get(lead.Id, ct)).Value);
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.LeadsEdit)]
    public async Task<ActionResult<LeadDetail>> Update(int id, LeadInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var lead = await db.Leads.InScope(user).FirstOrDefaultAsync(l => l.Id == id, ct);
        if (lead is null) return NotFound();
        if (lead.Status is LeadStatus.Converted or LeadStatus.Disqualified) return StateConflict("Converted and disqualified leads cannot be edited.");
        var customer = await db.Customers.InScope(user).FirstOrDefaultAsync(c => c.Id == input.CustomerId, ct);
        if (customer is null) return Invalid("customerId", "Choose a customer you have access to.");
        if (await ValidateAsync(input, customer, ct) is ActionResult problem) return problem;

        lead.CustomerId = customer.Id;
        Apply(lead, input, user, customer);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/qualify")]
    [HasPermission(Permissions.LeadsEdit)]
    public async Task<ActionResult<LeadDetail>> Qualify(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var lead = await db.Leads.InScope(user).FirstOrDefaultAsync(l => l.Id == id, ct);
        if (lead is null) return NotFound();
        if (lead.Status != LeadStatus.New) return StateConflict("Only new leads can be qualified.");
        lead.Status = LeadStatus.Qualified;
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/disqualify")]
    [HasPermission(Permissions.LeadsEdit)]
    public async Task<ActionResult<LeadDetail>> Disqualify(int id, DisqualifyInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var lead = await db.Leads.InScope(user).FirstOrDefaultAsync(l => l.Id == id, ct);
        if (lead is null) return NotFound();
        if (lead.Status is LeadStatus.Converted or LeadStatus.Disqualified) return StateConflict("This lead is already closed.");
        lead.Status = LeadStatus.Disqualified;
        lead.DisqualifyReason = input.Reason.Trim();
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/reopen")]
    [HasPermission(Permissions.LeadsEdit)]
    public async Task<ActionResult<LeadDetail>> Reopen(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var lead = await db.Leads.InScope(user).FirstOrDefaultAsync(l => l.Id == id, ct);
        if (lead is null) return NotFound();
        if (lead.Status != LeadStatus.Disqualified) return StateConflict("Only disqualified leads can be reopened.");
        lead.Status = LeadStatus.New;
        lead.DisqualifyReason = null;
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/assign")]
    [HasPermission(Permissions.LeadsEdit)]
    public async Task<ActionResult<LeadDetail>> Assign(int id, AssignInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var lead = await db.Leads.InScope(user).Include(l => l.Customer).FirstOrDefaultAsync(l => l.Id == id, ct);
        if (lead is null) return NotFound();
        if (lead.Status is LeadStatus.Converted or LeadStatus.Disqualified) return StateConflict("This lead is already closed.");

        var dealerId = input.DealerId ?? lead.DealerId ?? lead.Customer!.DealerId;
        if (!await db.Dealers.InScope(user).AnyAsync(d => d.Id == dealerId && d.IsActive, ct))
            return Invalid("dealerId", "Choose an active dealer you have access to.");
        if (input.DealerUserId is int du && !await db.Users.AnyAsync(u => u.Id == du && u.DealerId == dealerId && u.IsActive, ct))
            return Invalid("dealerUserId", "Choose an engineer of the selected dealer.");
        if (input.OwnerUserId is int owner && !await db.Users.AnyAsync(u => u.Id == owner && u.UserType == UserType.Edwards && u.IsActive, ct))
            return Invalid("ownerUserId", "Choose an Edwards user as owner.");

        lead.DealerId = dealerId;
        lead.DealerUserId = user.Scope == DataScope.Own ? user.UserId : input.DealerUserId;
        lead.OwnerUserId = input.OwnerUserId ?? lead.OwnerUserId;
        await NotifyAssignedAsync(lead, lead.Customer!.Name, ct);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    /// <summary>Turns a lead into an opportunity (comment 1 of the MoM: the flow starts with the lead).</summary>
    [HttpPost("{id:int}/convert")]
    [HasPermission(Permissions.LeadsEdit)]
    public async Task<ActionResult<object>> Convert(int id, ConvertInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var lead = await db.Leads.InScope(user).Include(l => l.Customer).FirstOrDefaultAsync(l => l.Id == id, ct);
        if (lead is null) return NotFound();
        if (lead.Status is LeadStatus.Converted or LeadStatus.Disqualified) return StateConflict("This lead is already closed.");
        if (input.Type != OpportunityType.Equipment && input.AssetId is null)
            return Invalid("assetId", "Spare and service opportunities must name the asset.");
        if (input.AssetId is int assetId && !await db.Assets.AnyAsync(a => a.Id == assetId && a.CustomerId == lead.CustomerId, ct))
            return Invalid("assetId", "Choose an asset of this customer.");

        var opportunity = new Opportunity
        {
            Name = Clean(input.Name) ?? lead.Name,
            Type = input.Type,
            Source = OpportunitySource.Lead,
            Stage = OpportunityStage.Open,
            CustomerId = lead.CustomerId,
            LeadId = lead.Id,
            AssetId = input.AssetId,
            DealerId = lead.DealerId ?? lead.Customer!.DealerId,
            DealerUserId = lead.DealerUserId ?? lead.Customer!.DealerUserId,
            OwnerUserId = lead.OwnerUserId ?? (user.UserType == UserType.Edwards ? user.UserId : null),
            DealerAccepted = user.UserType != UserType.Edwards,
            ExpectedCloseDate = input.ExpectedCloseDate,
        };
        db.Opportunities.Add(opportunity);
        await db.SaveChangesAsync(ct);
        lead.Status = LeadStatus.Converted;
        lead.OpportunityId = opportunity.Id;
        if (!opportunity.DealerAccepted)
        {
            var to = (await recipients.DealerPrincipalsAsync(opportunity.DealerId, ct)).Cast<int?>().Append(opportunity.DealerUserId);
            await alerts.RaiseAsync(AlertType.OpportunityAssigned, to, "Opportunity assigned to you",
                $"{lead.Customer!.Name}: {opportunity.Name}\nPlease accept it and plan the first follow-up.", $"/opportunities/{opportunity.Id}", ct);
        }
        await db.SaveChangesAsync(ct);
        return new { opportunityId = opportunity.Id };
    }

    private async Task<ActionResult?> ValidateAsync(LeadInput input, Customer customer, CancellationToken ct)
    {
        if (input.DealerUserId is int du && !await db.Users.AnyAsync(u => u.Id == du && u.DealerId == customer.DealerId && u.IsActive, ct))
            ModelState.AddModelError("dealerUserId", "Choose an engineer of the customer's dealer.");
        if (input.OwnerUserId is int owner && !await db.Users.AnyAsync(u => u.Id == owner && u.UserType == UserType.Edwards && u.IsActive, ct))
            ModelState.AddModelError("ownerUserId", "Choose an Edwards user as owner.");
        if (input.ProductModelId is int modelId && !await db.ProductModels.AnyAsync(m => m.Id == modelId && m.ProductRangeId == input.ProductRangeId, ct))
            ModelState.AddModelError("productModelId", "Choose a model from the selected product range.");
        return ModelState.IsValid ? null : ValidationProblem(ModelState);
    }

    private static void Apply(Lead lead, LeadInput input, UserContext user, Customer customer)
    {
        lead.Name = input.Name.Trim();
        lead.DealerId ??= customer.DealerId;
        lead.DealerUserId = user.Scope == DataScope.Own ? user.UserId : input.DealerUserId ?? customer.DealerUserId;
        lead.OwnerUserId = input.OwnerUserId ?? lead.OwnerUserId ?? (user.UserType == UserType.Edwards ? user.UserId : null);
        lead.ProductRangeId = input.ProductRangeId;
        lead.ProductModelId = input.ProductModelId;
        lead.Remark = Clean(input.Remark);
    }

    private async Task NotifyAssignedAsync(Lead lead, string customerName, CancellationToken ct)
    {
        var me = currentUser.UserId;
        var to = new[] { lead.OwnerUserId, lead.DealerUserId }.Where(x => x != me);
        await alerts.RaiseAsync(AlertType.LeadAssigned, to, "Lead assigned to you", $"{customerName}: {lead.Name}", $"/leads/{lead.Id}", ct);
    }

    private static IQueryable<LeadDetail> Detail(IQueryable<Lead> q) =>
        q.Select(l => new LeadDetail(l.Id, l.Name, l.CustomerId, l.Customer!.Name, l.Source, l.Status, l.VisitId, l.DealerId,
            l.Dealer != null ? l.Dealer.Name : null, l.DealerUserId,
            l.DealerUser != null ? (l.DealerUser.FirstName + " " + l.DealerUser.LastName).Trim() : null, l.OwnerUserId,
            l.Owner != null ? (l.Owner.FirstName + " " + l.Owner.LastName).Trim() : null, l.ProductRangeId,
            l.ProductRange != null ? l.ProductRange.Name : null, l.ProductModelId, l.ProductModel != null ? l.ProductModel.Name : null,
            l.Remark, l.DisqualifyReason, l.OpportunityId, l.CreatedAt, l.UpdatedAt));
}
