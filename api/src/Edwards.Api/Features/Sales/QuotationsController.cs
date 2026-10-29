using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Sales;

public sealed record QuotationLineItem(int Id, LineType Type, int? ProductRangeId, string? ProductRange, int? ProductModelId, string? ProductModel,
    string? Description, int Quantity, decimal UnitPrice, decimal LineTotal);

public sealed record QuotationItem(int Id, int OpportunityId, int Revision, string Number, DateOnly QuoteDate, QuotationStatus Status, decimal Total,
    string? Remark, DateTime? SubmittedAt, string? SubmittedBy, DateTime? DecidedAt, string? DecidedBy, string? DecisionRemark,
    List<QuotationLineItem> Lines);

public sealed class QuotationLineInput
{
    public LineType Type { get; set; }
    public int? ProductRangeId { get; set; }
    public int? ProductModelId { get; set; }

    [StringLength(300)]
    public string? Description { get; set; }

    [Range(1, 100_000)]
    public int Quantity { get; set; } = 1;

    [Range(0, 100_000_000_000)]
    public decimal UnitPrice { get; set; }
}

public sealed class QuotationInput
{
    [Required]
    public DateOnly? QuoteDate { get; set; }

    [StringLength(2000)]
    public string? Remark { get; set; }

    [MinLength(1, ErrorMessage = "Add at least one line.")]
    public List<QuotationLineInput> Lines { get; set; } = [];
}

public sealed class DecisionInput
{
    [StringLength(500)]
    public string? Remark { get; set; }
}

/// <summary>
/// Quotations are revisions under an opportunity. A dealer prepares a draft and submits it; Edwards sales accepts or rejects it.
/// Revising copies the latest revision into a new draft. The opportunity's value follows the latest revision that was not rejected.
/// </summary>
[Route("api")]
public sealed class QuotationsController(AppDbContext db, ICurrentUser currentUser, AlertService alerts, Recipients recipients) : ApiBase
{
    [HttpGet("opportunities/{opportunityId:int}/quotations")]
    [HasPermission(Permissions.QuotationsView)]
    public async Task<ActionResult<List<QuotationItem>>> List(int opportunityId, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        if (!await db.Opportunities.InScope(user).AnyAsync(o => o.Id == opportunityId, ct)) return NotFound();
        return await Items(db.Quotations.AsNoTracking().Where(q => q.OpportunityId == opportunityId).OrderByDescending(q => q.Revision))
            .ToListAsync(ct);
    }

    [HttpPost("opportunities/{opportunityId:int}/quotations")]
    [HasPermission(Permissions.QuotationsEdit)]
    public async Task<ActionResult<QuotationItem>> Create(int opportunityId, QuotationInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var o = await db.Opportunities.InScope(user).Include(x => x.Quotations).FirstOrDefaultAsync(x => x.Id == opportunityId, ct);
        if (o is null) return NotFound();
        if (!OpportunitiesController.IsOpen(o.Stage)) return StateConflict("Quotations can only be added to open opportunities.");
        if (o.Quotations.Any(q => q.Status == QuotationStatus.Draft)) return StateConflict("This opportunity already has a draft quotation. Edit it instead.");
        if (await ValidateAsync(input, ct) is ActionResult problem) return problem;

        var q = NewRevision(o);
        Apply(q, input);
        o.Quotations.Add(q);
        Recalculate(o);
        await db.SaveChangesAsync(ct);
        return await GetAsync(q.Id, ct);
    }

    [HttpPut("quotations/{id:int}")]
    [HasPermission(Permissions.QuotationsEdit)]
    public async Task<ActionResult<QuotationItem>> Update(int id, QuotationInput input, CancellationToken ct)
    {
        var (q, o) = await LoadAsync(id, ct);
        if (q is null || o is null) return NotFound();
        if (q.Status != QuotationStatus.Draft) return StateConflict("Only draft quotations can be edited. Revise it instead.");
        if (await ValidateAsync(input, ct) is ActionResult problem) return problem;
        Apply(q, input);
        Recalculate(o);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    [HttpPost("quotations/{id:int}/submit")]
    [HasPermission(Permissions.QuotationsEdit)]
    public async Task<ActionResult<QuotationItem>> Submit(int id, CancellationToken ct)
    {
        var (q, o) = await LoadAsync(id, ct);
        if (q is null || o is null) return NotFound();
        if (q.Status != QuotationStatus.Draft) return StateConflict("Only drafts can be submitted.");
        if (q.Lines.Count == 0) return StateConflict("Add at least one line before submitting.");

        foreach (var earlier in o.Quotations.Where(x => x.Id != q.Id && x.Status is QuotationStatus.Submitted or QuotationStatus.Accepted))
            earlier.Status = QuotationStatus.Revised;
        q.Status = QuotationStatus.Submitted;
        q.SubmittedAt = DateTime.UtcNow;
        q.SubmittedBy = currentUser.UserId;
        Recalculate(o);

        var to = o.OwnerUserId is int owner
            ? new int?[] { owner }
            : (await recipients.RoleForDealerZoneAsync(RoleDefaults.Sales, o.DealerId, ct)).Cast<int?>();
        await alerts.RaiseAsync(AlertType.QuotationSubmitted, to, $"Quotation {q.Number} submitted",
            $"{o.Customer!.Name}: {o.Name}\nTotal: ₹{q.Total:N0}\nPlease review and accept or reject it.", $"/opportunities/{o.Id}", ct);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    [HttpPost("quotations/{id:int}/accept")]
    [HasPermission(Permissions.QuotationsApprove)]
    public Task<ActionResult<QuotationItem>> Accept(int id, DecisionInput input, CancellationToken ct) => DecideAsync(id, true, input, ct);

    [HttpPost("quotations/{id:int}/reject")]
    [HasPermission(Permissions.QuotationsApprove)]
    public Task<ActionResult<QuotationItem>> Reject(int id, DecisionInput input, CancellationToken ct) => DecideAsync(id, false, input, ct);

    [HttpPost("quotations/{id:int}/revise")]
    [HasPermission(Permissions.QuotationsEdit)]
    public async Task<ActionResult<QuotationItem>> Revise(int id, CancellationToken ct)
    {
        var (q, o) = await LoadAsync(id, ct);
        if (q is null || o is null) return NotFound();
        if (!OpportunitiesController.IsOpen(o.Stage)) return StateConflict("Closed opportunities cannot be requoted.");
        if (o.Quotations.Any(x => x.Status == QuotationStatus.Draft)) return StateConflict("A draft revision already exists.");

        var next = NewRevision(o);
        next.Remark = q.Remark;
        next.Lines = q.Lines.Select(l => new QuotationLine
        {
            Type = l.Type, ProductRangeId = l.ProductRangeId, ProductModelId = l.ProductModelId, Description = l.Description,
            Quantity = l.Quantity, UnitPrice = l.UnitPrice, LineTotal = l.LineTotal,
        }).ToList();
        next.Total = next.Lines.Sum(l => l.LineTotal);
        o.Quotations.Add(next);
        Recalculate(o);
        await db.SaveChangesAsync(ct);
        return await GetAsync(next.Id, ct);
    }

    private async Task<ActionResult<QuotationItem>> DecideAsync(int id, bool accept, DecisionInput input, CancellationToken ct)
    {
        var (q, o) = await LoadAsync(id, ct);
        if (q is null || o is null) return NotFound();
        if (q.Status != QuotationStatus.Submitted) return StateConflict("Only submitted quotations can be accepted or rejected.");
        if (!accept && Clean(input.Remark) is null) return Invalid("remark", "Explain why the quotation is rejected.");

        q.Status = accept ? QuotationStatus.Accepted : QuotationStatus.Rejected;
        q.DecidedAt = DateTime.UtcNow;
        q.DecidedBy = currentUser.UserId;
        q.DecisionRemark = Clean(input.Remark);
        Recalculate(o);

        var to = (await recipients.DealerPrincipalsAsync(o.DealerId, ct)).Cast<int?>().Append(o.DealerUserId);
        await alerts.RaiseAsync(AlertType.QuotationDecided, to, $"Quotation {q.Number} {(accept ? "accepted" : "rejected")}",
            $"{o.Customer!.Name}: {o.Name}" + (q.DecisionRemark is null ? "" : $"\nRemark: {q.DecisionRemark}"), $"/opportunities/{o.Id}", ct);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    private async Task<(Quotation? Quotation, Opportunity? Opportunity)> LoadAsync(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var opportunityId = await db.Quotations.Where(q => q.Id == id).Select(q => (int?)q.OpportunityId).FirstOrDefaultAsync(ct);
        if (opportunityId is null) return (null, null);
        var o = await db.Opportunities.InScope(user).Include(x => x.Customer).Include(x => x.Quotations).ThenInclude(q => q.Lines)
            .FirstOrDefaultAsync(x => x.Id == opportunityId, ct);
        return (o?.Quotations.First(q => q.Id == id), o);
    }

    private async Task<ActionResult?> ValidateAsync(QuotationInput input, CancellationToken ct)
    {
        for (var i = 0; i < input.Lines.Count; i++)
        {
            var line = input.Lines[i];
            if (line.Type == LineType.Equipment && (line.ProductRangeId is null || line.ProductModelId is null))
                ModelState.AddModelError($"lines[{i}]", $"Line {i + 1}: choose the product range and model.");
            else if (line.Type != LineType.Equipment && Clean(line.Description) is null)
                ModelState.AddModelError($"lines[{i}]", $"Line {i + 1}: describe the spare or service.");
            if (line.ProductModelId is int modelId && !await db.ProductModels.AnyAsync(m => m.Id == modelId && m.ProductRangeId == line.ProductRangeId, ct))
                ModelState.AddModelError($"lines[{i}]", $"Line {i + 1}: the model does not belong to the product range.");
        }
        return ModelState.IsValid ? null : ValidationProblem(ModelState);
    }

    private static Quotation NewRevision(Opportunity o)
    {
        var revision = o.Quotations.Count == 0 ? 1 : o.Quotations.Max(q => q.Revision) + 1;
        return new Quotation
        {
            Revision = revision,
            Number = $"Q{o.Id:D5}-R{revision}",
            QuoteDate = DateOnly.FromDateTime(DateTime.Today),
            Status = QuotationStatus.Draft,
        };
    }

    private static void Apply(Quotation q, QuotationInput input)
    {
        q.QuoteDate = input.QuoteDate!.Value;
        q.Remark = Clean(input.Remark);
        q.Lines.Clear();
        foreach (var l in input.Lines)
        {
            q.Lines.Add(new QuotationLine
            {
                Type = l.Type,
                ProductRangeId = l.ProductRangeId,
                ProductModelId = l.ProductModelId,
                Description = Clean(l.Description),
                Quantity = l.Quantity,
                UnitPrice = l.UnitPrice,
                LineTotal = Math.Round(l.Quantity * l.UnitPrice, 2),
            });
        }
        q.Total = q.Lines.Sum(l => l.LineTotal);
    }

    /// <summary>The opportunity's value is the latest revision that was sent and not rejected, or the draft if nothing was sent yet.</summary>
    private static void Recalculate(Opportunity o)
    {
        var current = o.Quotations.Where(q => q.Status is not QuotationStatus.Rejected and not QuotationStatus.Draft)
                          .OrderByDescending(q => q.Revision).FirstOrDefault()
                      ?? o.Quotations.Where(q => q.Status == QuotationStatus.Draft).OrderByDescending(q => q.Revision).FirstOrDefault();
        o.Value = current?.Total ?? 0;
    }

    private async Task<ActionResult<QuotationItem>> GetAsync(int id, CancellationToken ct) =>
        await Items(db.Quotations.AsNoTracking().Where(q => q.Id == id)).FirstAsync(ct);

    private IQueryable<QuotationItem> Items(IQueryable<Quotation> q) =>
        q.Select(x => new QuotationItem(x.Id, x.OpportunityId, x.Revision, x.Number, x.QuoteDate, x.Status, x.Total, x.Remark, x.SubmittedAt,
            db.Users.Where(u => u.Id == x.SubmittedBy).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefault(),
            x.DecidedAt,
            db.Users.Where(u => u.Id == x.DecidedBy).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefault(),
            x.DecisionRemark,
            x.Lines.OrderBy(l => l.Id).Select(l => new QuotationLineItem(l.Id, l.Type, l.ProductRangeId,
                l.ProductRange != null ? l.ProductRange.Name : null, l.ProductModelId, l.ProductModel != null ? l.ProductModel.Name : null,
                l.Description, l.Quantity, l.UnitPrice, l.LineTotal)).ToList()));
}
