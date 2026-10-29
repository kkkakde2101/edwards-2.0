using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Sales;

public sealed class TransferQuery : ListQuery
{
    public TransferStatus? Status { get; set; }
    public int? CustomerId { get; set; }
}

public sealed record TransferItem(int Id, int CustomerId, string Customer, int FromDealerId, string FromDealer, int ToDealerId, string ToDealer,
    string? ToDealerUser, string Reason, DateOnly EffectiveDate, TransferStatus Status, string? RequestedBy, DateTime RequestedAt,
    string? DecidedBy, DateTime? DecidedAt, string? DecisionRemark, DateTime? AppliedAt);

public sealed class TransferInput
{
    [Required]
    public int? CustomerId { get; set; }

    [Required]
    public int? ToDealerId { get; set; }

    public int? ToDealerUserId { get; set; }

    [Required, StringLength(500, MinimumLength = 5)]
    public string Reason { get; set; } = "";

    [Required]
    public DateOnly? EffectiveDate { get; set; }
}

/// <summary>
/// Moving a customer to another dealer. Sales requests it, an approver decides, and on the effective date the customer,
/// its open leads and its open opportunities move. Visits, closed opportunities and quotations stay with the old dealer.
/// </summary>
[Route("api/transfers")]
public sealed class TransfersController(AppDbContext db, ICurrentUser currentUser, AlertService alerts, Recipients recipients) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.TransfersView)]
    public async Task<PagedResult<TransferItem>> List([FromQuery] TransferQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = db.CustomerTransfers.AsNoTracking().InScope(user);
        if (Clean(q.Search) is string s) query = query.Where(t => t.Customer!.Name.Contains(s));
        if (q.Status is TransferStatus status) query = query.Where(t => t.Status == status);
        if (q.CustomerId is int customerId) query = query.Where(t => t.CustomerId == customerId);

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await Items(query.OrderBy(t => t.Status != TransferStatus.Pending).ThenByDescending(t => t.Id)
            .Skip((page - 1) * size).Take(size)).ToListAsync(ct);
        return new PagedResult<TransferItem>(items, total, page, size);
    }

    [HttpPost]
    [HasPermission(Permissions.TransfersRequest)]
    public async Task<ActionResult<TransferItem>> Create(TransferInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var customer = await db.Customers.InScope(user).Include(c => c.Dealer)
            .FirstOrDefaultAsync(c => c.Id == input.CustomerId && c.IsActive, ct);
        if (customer is null) return Invalid("customerId", "Choose an active customer you have access to.");
        if (customer.DealerId == input.ToDealerId) return Invalid("toDealerId", "The customer already belongs to this dealer.");
        var toDealer = await db.Dealers.FirstOrDefaultAsync(d => d.Id == input.ToDealerId && d.IsActive, ct);
        if (toDealer is null) return Invalid("toDealerId", "Choose an active dealer.");
        if (input.ToDealerUserId is int du && !await db.Users.AnyAsync(u => u.Id == du && u.DealerId == toDealer.Id
                && u.UserType == UserType.DealerUser && u.IsActive, ct))
            return Invalid("toDealerUserId", "Choose an engineer of the new dealer.");
        if (input.EffectiveDate < DateOnly.FromDateTime(DateTime.Today)) return Invalid("effectiveDate", "The effective date cannot be in the past.");
        if (await db.CustomerTransfers.AnyAsync(t => t.CustomerId == customer.Id
                && (t.Status == TransferStatus.Pending || (t.Status == TransferStatus.Approved && t.AppliedAt == null)), ct))
            return StateConflict("This customer already has a transfer waiting for approval or for its effective date.");

        var t = new CustomerTransfer
        {
            CustomerId = customer.Id,
            FromDealerId = customer.DealerId,
            ToDealerId = toDealer.Id,
            ToDealerUserId = input.ToDealerUserId,
            Reason = input.Reason.Trim(),
            EffectiveDate = input.EffectiveDate!.Value,
            Status = TransferStatus.Pending,
            RequestedBy = user.UserId,
            RequestedAt = DateTime.UtcNow,
        };
        db.CustomerTransfers.Add(t);
        var approvers = (await recipients.WithPermissionAsync(Permissions.TransfersApprove, customer.DealerId, ct)).Cast<int?>();
        await alerts.RaiseAsync(AlertType.TransferRequested, approvers.Where(x => x != user.UserId), $"Transfer requested: {customer.Name}",
            $"From {customer.Dealer!.Name} to {toDealer.Name}, effective {t.EffectiveDate:dd MMM yyyy}.\nReason: {t.Reason}\nRequested by {user.DisplayName}.",
            "/transfers", ct);
        await db.SaveChangesAsync(ct);
        return await GetAsync(t.Id, ct);
    }

    [HttpPost("{id:int}/approve")]
    [HasPermission(Permissions.TransfersApprove)]
    public Task<ActionResult<TransferItem>> Approve(int id, DecisionInput input, CancellationToken ct) => DecideAsync(id, true, input, ct);

    [HttpPost("{id:int}/reject")]
    [HasPermission(Permissions.TransfersApprove)]
    public Task<ActionResult<TransferItem>> Reject(int id, DecisionInput input, CancellationToken ct) => DecideAsync(id, false, input, ct);

    private async Task<ActionResult<TransferItem>> DecideAsync(int id, bool approve, DecisionInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var t = await db.CustomerTransfers.InScope(user).Include(x => x.Customer).Include(x => x.ToDealer)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return NotFound();
        if (t.Status != TransferStatus.Pending) return StateConflict("This transfer has already been decided.");
        if (!approve && Clean(input.Remark) is null) return Invalid("remark", "Explain why the transfer is rejected.");
        if (approve && t.Customer!.DealerId != t.FromDealerId)
            return StateConflict("The customer has moved to another dealer since this request. Reject it and raise a new one.");
        if (approve && !t.ToDealer!.IsActive) return StateConflict("The new dealer has been deactivated. Reject the request.");

        t.Status = approve ? TransferStatus.Approved : TransferStatus.Rejected;
        t.DecidedBy = user.UserId;
        t.DecidedAt = DateTime.UtcNow;
        t.DecisionRemark = Clean(input.Remark);
        var applied = approve && t.EffectiveDate <= DateOnly.FromDateTime(DateTime.Today);
        if (applied) await CustomerTransfers.ApplyAsync(db, t, ct);

        var to = new List<int?> { t.RequestedBy };
        if (approve)
        {
            to.AddRange((await recipients.DealerPrincipalsAsync(t.FromDealerId, ct)).Cast<int?>());
            to.AddRange((await recipients.DealerPrincipalsAsync(t.ToDealerId, ct)).Cast<int?>());
            to.Add(t.ToDealerUserId);
        }
        await alerts.RaiseAsync(AlertType.TransferDecided, to.Where(x => x != user.UserId),
            $"Transfer {(approve ? "approved" : "rejected")}: {t.Customer!.Name}",
            (approve
                ? applied ? $"The customer now belongs to {t.ToDealer!.Name}." : $"The customer moves to {t.ToDealer!.Name} on {t.EffectiveDate:dd MMM yyyy}."
                : "The customer stays with its current dealer.")
            + (t.DecisionRemark is null ? "" : $"\nRemark: {t.DecisionRemark}"),
            "/transfers", ct);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    private async Task<ActionResult<TransferItem>> GetAsync(int id, CancellationToken ct) =>
        await Items(db.CustomerTransfers.AsNoTracking().Where(t => t.Id == id)).FirstAsync(ct);

    private IQueryable<TransferItem> Items(IQueryable<CustomerTransfer> q) =>
        q.Select(t => new TransferItem(t.Id, t.CustomerId, t.Customer!.Name, t.FromDealerId, t.FromDealer!.Name, t.ToDealerId, t.ToDealer!.Name,
            t.ToDealerUser != null ? (t.ToDealerUser.FirstName + " " + t.ToDealerUser.LastName).Trim() : null, t.Reason, t.EffectiveDate,
            t.Status, db.Users.Where(u => u.Id == t.RequestedBy).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefault(),
            t.RequestedAt, db.Users.Where(u => u.Id == t.DecidedBy).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefault(),
            t.DecidedAt, t.DecisionRemark, t.AppliedAt));
}

public static class CustomerTransfers
{
    /// <summary>Moves the customer and its open work to the new dealer. The caller saves.</summary>
    public static async Task ApplyAsync(AppDbContext db, CustomerTransfer t, CancellationToken ct)
    {
        var customer = await db.Customers.FirstAsync(c => c.Id == t.CustomerId, ct);
        var toDealer = await db.Dealers.Where(d => d.Id == t.ToDealerId).Select(d => d.Name).FirstAsync(ct);
        customer.DealerId = t.ToDealerId;
        customer.DealerUserId = t.ToDealerUserId;

        var leads = await db.Leads.Where(l => l.CustomerId == t.CustomerId && (l.Status == LeadStatus.New || l.Status == LeadStatus.Qualified))
            .ToListAsync(ct);
        foreach (var l in leads)
        {
            l.DealerId = t.ToDealerId;
            l.DealerUserId = t.ToDealerUserId;
        }

        // The new dealer accepts the opportunities it inherits, as with any assignment.
        var opportunities = await db.Opportunities
            .Where(o => o.CustomerId == t.CustomerId && (o.Stage == OpportunityStage.Open || o.Stage == OpportunityStage.Postponed))
            .ToListAsync(ct);
        foreach (var o in opportunities)
        {
            o.DealerId = t.ToDealerId;
            o.DealerUserId = t.ToDealerUserId;
            o.DealerAccepted = false;
            o.AcceptedAt = null;
        }

        var now = DateTime.UtcNow;
        foreach (var assetId in await db.Assets.Where(a => a.CustomerId == t.CustomerId).Select(a => a.Id).ToListAsync(ct))
            db.AssetEvents.Add(new AssetEvent { AssetId = assetId, At = now, Kind = "Transfer", Text = $"Customer moved to {toDealer}", UserId = t.DecidedBy });
        t.AppliedAt = now;
    }
}
