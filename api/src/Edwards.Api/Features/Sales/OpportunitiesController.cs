using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Sales;

public sealed class OpportunityQuery : ListQuery
{
    /// <summary>A stage, or "open" for open and postponed together.</summary>
    public string? Stage { get; set; }

    public OpportunityType? Type { get; set; }
    public int? DealerId { get; set; }
    public int? OwnerUserId { get; set; }
    public int? CustomerId { get; set; }
    public DateOnly? ClosingFrom { get; set; }
    public DateOnly? ClosingTo { get; set; }
    public bool Overdue { get; set; }
    public string Sort { get; set; } = "closing";
}

public sealed record OpportunityListItem(int Id, string Name, OpportunityType Type, OpportunityStage Stage, int CustomerId, string Customer,
    string Dealer, string? DealerUser, string? Owner, decimal Value, DateOnly? ExpectedCloseDate, string? SalesPhase, int? Chance,
    DateOnly? NextFollowUpDate, bool DealerAccepted);

public sealed record FollowUpItem(int Id, DateOnly Date, FollowUpMode Mode, string Remark, DateOnly? NextDate, string? By, DateTime CreatedAt);

public sealed record OpportunityActions(bool Edit, bool Assign, bool Accept, bool ChangeStatus, bool Reopen, bool Quote, bool ApproveQuote);

public sealed record OpportunityDetail(int Id, string Name, OpportunityType Type, OpportunitySource Source, OpportunityStage Stage,
    int CustomerId, string Customer, int? LeadId, int? AssetId, string? Asset, int DealerId, string Dealer, int? DealerUserId, string? DealerUser,
    int? OwnerUserId, string? Owner, bool DealerAccepted, DateTime? AcceptedAt, int? SalesPhaseId, string? SalesPhase,
    int? WinningChanceId, string? WinningChance, int? OpportunityModeId, string? OpportunityMode, DateOnly? ExpectedCloseDate, decimal Value,
    decimal? CompetitionPrice, int? WinningReasonId, string? WinningReason, int? LosingReasonId, string? LosingReason, string? PoNumber,
    DateOnly? PoDate, DateOnly? ClosedDate, string? CloseRemark, DateOnly? NextFollowUpDate, string? Remark, DateTime CreatedAt,
    DateTime? UpdatedAt, List<FollowUpItem> FollowUps, OpportunityActions? Actions);

public sealed class OpportunityInput
{
    [Required, StringLength(250, MinimumLength = 3)]
    public string Name { get; set; } = "";

    public OpportunityType Type { get; set; }

    [Required]
    public int? CustomerId { get; set; }

    public int? AssetId { get; set; }
    public int? DealerUserId { get; set; }
    public int? OwnerUserId { get; set; }
    public int? SalesPhaseId { get; set; }
    public int? WinningChanceId { get; set; }
    public int? OpportunityModeId { get; set; }
    public DateOnly? ExpectedCloseDate { get; set; }

    [Range(0, 100_000_000_000)]
    public decimal? CompetitionPrice { get; set; }

    [StringLength(2000)]
    public string? Remark { get; set; }
}

public sealed class FollowUpInput
{
    [Required]
    public DateOnly? Date { get; set; }

    public FollowUpMode Mode { get; set; }

    [Required, StringLength(1000, MinimumLength = 3)]
    public string Remark { get; set; } = "";

    public DateOnly? NextDate { get; set; }
}

public sealed class StatusInput
{
    [Required]
    public OpportunityStage? Stage { get; set; }

    public int? WinningReasonId { get; set; }
    public int? LosingReasonId { get; set; }

    [StringLength(100)]
    public string? PoNumber { get; set; }

    public DateOnly? PoDate { get; set; }
    public DateOnly? ClosedDate { get; set; }

    [StringLength(1000)]
    public string? Remark { get; set; }
}

[Route("api/opportunities")]
public sealed class OpportunitiesController(AppDbContext db, ICurrentUser currentUser, AlertService alerts, Recipients recipients) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.OpportunitiesView)]
    public async Task<PagedResult<OpportunityListItem>> List([FromQuery] OpportunityQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var query = db.Opportunities.AsNoTracking().InScope(user).Where(o => o.IsActive);
        if (Clean(q.Search) is string s) query = query.Where(o => o.Name.Contains(s) || o.Customer!.Name.Contains(s));
        if (q.Stage == "open") query = query.Where(o => o.Stage == OpportunityStage.Open || o.Stage == OpportunityStage.Postponed);
        else if (Enum.TryParse<OpportunityStage>(q.Stage, true, out var stage)) query = query.Where(o => o.Stage == stage);
        if (q.Type is OpportunityType type) query = query.Where(o => o.Type == type);
        if (q.DealerId is int dealerId) query = query.Where(o => o.DealerId == dealerId);
        if (q.OwnerUserId is int ownerId) query = query.Where(o => o.OwnerUserId == ownerId);
        if (q.CustomerId is int customerId) query = query.Where(o => o.CustomerId == customerId);
        if (q.ClosingFrom is DateOnly from) query = query.Where(o => o.ExpectedCloseDate >= from);
        if (q.ClosingTo is DateOnly to) query = query.Where(o => o.ExpectedCloseDate <= to);
        if (q.Overdue) query = query.Where(o => (o.Stage == OpportunityStage.Open || o.Stage == OpportunityStage.Postponed) && o.ExpectedCloseDate < today);

        var total = await query.CountAsync(ct);
        query = q.Sort switch
        {
            "value" => query.OrderByDescending(o => o.Value),
            "created" => query.OrderByDescending(o => o.Id),
            _ => query.OrderBy(o => o.ExpectedCloseDate == null).ThenBy(o => o.ExpectedCloseDate).ThenByDescending(o => o.Id),
        };
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await query
            .Skip((page - 1) * size).Take(size)
            .Select(o => new OpportunityListItem(o.Id, o.Name, o.Type, o.Stage, o.CustomerId, o.Customer!.Name, o.Dealer!.Name,
                o.DealerUser != null ? (o.DealerUser.FirstName + " " + o.DealerUser.LastName).Trim() : null,
                o.Owner != null ? (o.Owner.FirstName + " " + o.Owner.LastName).Trim() : null, o.Value, o.ExpectedCloseDate,
                o.SalesPhase != null ? o.SalesPhase.Name : null, o.WinningChance != null ? o.WinningChance.Percentage : null,
                o.NextFollowUpDate, o.DealerAccepted))
            .ToListAsync(ct);
        return new PagedResult<OpportunityListItem>(items, total, page, size);
    }

    [HttpGet("{id:int}")]
    [HasPermission(Permissions.OpportunitiesView)]
    public async Task<ActionResult<OpportunityDetail>> Get(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var o = await Detail(db.Opportunities.AsNoTracking().InScope(user).Where(x => x.Id == id)).FirstOrDefaultAsync(ct);
        return o is null ? NotFound() : o with { Actions = ActionsFor(o, user) };
    }

    [HttpPost]
    [HasPermission(Permissions.OpportunitiesCreate)]
    public async Task<ActionResult<OpportunityDetail>> Create(OpportunityInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var customer = await db.Customers.InScope(user).FirstOrDefaultAsync(c => c.Id == input.CustomerId && c.IsActive, ct);
        if (customer is null) return Invalid("customerId", "Choose an active customer you have access to.");
        if (await ValidateAsync(input, customer, ct) is ActionResult problem) return problem;

        var o = new Opportunity
        {
            Source = OpportunitySource.Manual,
            Stage = OpportunityStage.Open,
            DealerId = customer.DealerId,
            DealerAccepted = user.UserType != UserType.Edwards,
        };
        Apply(o, input, user, customer);
        db.Opportunities.Add(o);
        await db.SaveChangesAsync(ct);
        if (!o.DealerAccepted) await NotifyDealerAsync(o, customer.Name, ct);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = o.Id }, (await Get(o.Id, ct)).Value);
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.OpportunitiesEdit)]
    public async Task<ActionResult<OpportunityDetail>> Update(int id, OpportunityInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var o = await db.Opportunities.InScope(user).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound();
        if (!IsOpen(o.Stage)) return StateConflict("Closed opportunities cannot be edited. Reopen it first.");
        var customer = await db.Customers.InScope(user).FirstOrDefaultAsync(c => c.Id == input.CustomerId, ct);
        if (customer is null || customer.Id != o.CustomerId) return Invalid("customerId", "The customer of an opportunity cannot change.");
        if (await ValidateAsync(input, customer, ct) is ActionResult problem) return problem;

        Apply(o, input, user, customer);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/assign")]
    [HasPermission(Permissions.OpportunitiesAssign)]
    public async Task<ActionResult<OpportunityDetail>> Assign(int id, AssignInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var o = await db.Opportunities.InScope(user).Include(x => x.Customer).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound();
        if (!IsOpen(o.Stage)) return StateConflict("Closed opportunities cannot be reassigned.");
        var dealerId = input.DealerId ?? o.DealerId;
        if (!await db.Dealers.InScope(user).AnyAsync(d => d.Id == dealerId && d.IsActive, ct))
            return Invalid("dealerId", "Choose an active dealer you have access to.");
        if (input.DealerUserId is int du && !await db.Users.AnyAsync(u => u.Id == du && u.DealerId == dealerId && u.IsActive, ct))
            return Invalid("dealerUserId", "Choose an engineer of the selected dealer.");
        if (input.OwnerUserId is int owner && !await db.Users.AnyAsync(u => u.Id == owner && u.UserType == UserType.Edwards && u.IsActive, ct))
            return Invalid("ownerUserId", "Choose an Edwards user as owner.");

        var changedDealer = dealerId != o.DealerId || input.DealerUserId != o.DealerUserId;
        o.DealerId = dealerId;
        o.DealerUserId = input.DealerUserId;
        o.OwnerUserId = input.OwnerUserId ?? o.OwnerUserId;
        if (changedDealer)
        {
            o.DealerAccepted = false;
            o.AcceptedAt = null;
            await NotifyDealerAsync(o, o.Customer!.Name, ct);
        }
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/accept")]
    [HasPermission(Permissions.OpportunitiesEdit)]
    public async Task<ActionResult<OpportunityDetail>> Accept(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var o = await db.Opportunities.InScope(user).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound();
        if (user.UserType == UserType.Edwards || user.DealerId != o.DealerId) return StateConflict("Only the assigned dealer can accept an opportunity.");
        if (o.DealerAccepted) return StateConflict("This opportunity is already accepted.");
        o.DealerAccepted = true;
        o.AcceptedAt = DateTime.UtcNow;
        o.DealerUserId ??= user.UserType == UserType.DealerUser ? user.UserId : null;
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/follow-ups")]
    [HasPermission(Permissions.OpportunitiesEdit)]
    public async Task<ActionResult<OpportunityDetail>> AddFollowUp(int id, FollowUpInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var o = await db.Opportunities.InScope(user).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound();
        if (!IsOpen(o.Stage)) return StateConflict("Follow-ups can only be logged on open opportunities.");
        var today = DateOnly.FromDateTime(DateTime.Today);
        if (input.Date > today) return Invalid("date", "A follow-up cannot be in the future.");
        if (input.NextDate is DateOnly next && next < input.Date) return Invalid("nextDate", "The next follow-up must be on or after this one.");

        db.FollowUps.Add(new FollowUp
        {
            OpportunityId = o.Id,
            Date = input.Date!.Value,
            Mode = input.Mode,
            Remark = input.Remark.Trim(),
            NextDate = input.NextDate,
            UserId = user.UserId,
            CreatedAt = DateTime.UtcNow,
        });
        o.NextFollowUpDate = input.NextDate;
        o.FollowUpOverdueAlerted = false;
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    /// <summary>Moves the opportunity through its workflow. Won needs a PO, lost needs a reason, reopening needs its own permission.</summary>
    [HttpPost("{id:int}/status")]
    [HasPermission(Permissions.OpportunitiesEdit)]
    public async Task<ActionResult<OpportunityDetail>> ChangeStatus(int id, StatusInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var o = await db.Opportunities.InScope(user).Include(x => x.Customer).Include(x => x.Quotations)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound();
        var to = input.Stage!.Value;
        if (to == o.Stage) return StateConflict("The opportunity already has this status.");

        if (!IsOpen(o.Stage))
        {
            if (to != OpportunityStage.Open) return StateConflict("A closed opportunity can only be reopened.");
            if (!user.Has(Permissions.OpportunitiesReopen)) return StateConflict("Your role cannot reopen closed opportunities.");
        }

        var today = DateOnly.FromDateTime(DateTime.Today);
        switch (to)
        {
            case OpportunityStage.Won:
                if (Clean(input.PoNumber) is null) return Invalid("poNumber", "Enter the customer's PO number to mark the opportunity won.");
                if (input.WinningReasonId is int wr && !await db.Set<WinningReason>().AnyAsync(x => x.Id == wr, ct))
                    return Invalid("winningReasonId", "Choose a reason from the list.");
                o.PoNumber = Clean(input.PoNumber);
                o.PoDate = input.PoDate ?? today;
                o.WinningReasonId = input.WinningReasonId;
                o.LosingReasonId = null;
                o.ClosedDate = input.ClosedDate ?? today;
                // The quotation the customer ordered against counts as accepted.
                var latest = o.Quotations.Where(q => q.Status is QuotationStatus.Submitted or QuotationStatus.Accepted)
                    .OrderByDescending(q => q.Revision).FirstOrDefault();
                if (latest is not null && latest.Status == QuotationStatus.Submitted)
                {
                    latest.Status = QuotationStatus.Accepted;
                    latest.DecidedAt = DateTime.UtcNow;
                    latest.DecidedBy = user.UserId;
                    latest.DecisionRemark = "Accepted when the opportunity was won.";
                }
                break;
            case OpportunityStage.Lost:
                if (input.LosingReasonId is not int lr || !await db.Set<LosingReason>().AnyAsync(x => x.Id == lr, ct))
                    return Invalid("losingReasonId", "Choose the reason the opportunity was lost.");
                o.LosingReasonId = lr;
                o.WinningReasonId = null;
                o.ClosedDate = input.ClosedDate ?? today;
                break;
            case OpportunityStage.Dropped:
                if (Clean(input.Remark) is null) return Invalid("remark", "Explain why the project was dropped.");
                o.ClosedDate = input.ClosedDate ?? today;
                break;
            case OpportunityStage.Postponed:
            case OpportunityStage.Open:
                o.ClosedDate = null;
                break;
        }
        o.CloseRemark = Clean(input.Remark);
        var from = o.Stage;
        o.Stage = to;

        var dealerSide = (await recipients.DealerPrincipalsAsync(o.DealerId, ct)).Cast<int?>();
        var sales = (await recipients.RoleForDealerZoneAsync(RoleDefaults.Sales, o.DealerId, ct)).Cast<int?>();
        var reason = to == OpportunityStage.Lost
            ? await db.Set<LosingReason>().Where(x => x.Id == o.LosingReasonId).Select(x => x.Name).FirstOrDefaultAsync(ct)
            : null;
        await alerts.RaiseAsync(AlertType.OpportunityStatus,
            sales.Concat(dealerSide).Append(o.DealerUserId).Append(o.OwnerUserId).Where(x => x != user.UserId),
            $"Opportunity {Label(to).ToLowerInvariant()}: {o.Name}",
            $"Customer: {o.Customer!.Name}\nStatus: {Label(from)} → {Label(to)}\nValue: ₹{o.Value:N0}"
                + (reason is null ? "" : $"\nReason: {reason}") + (o.CloseRemark is null ? "" : $"\nRemark: {o.CloseRemark}"),
            $"/opportunities/{o.Id}", ct);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    // ---- helpers ------------------------------------------------------------------------------

    private async Task<ActionResult?> ValidateAsync(OpportunityInput input, Customer customer, CancellationToken ct)
    {
        if (input.Type != OpportunityType.Equipment && input.AssetId is null)
            ModelState.AddModelError("assetId", "Spare and service opportunities must name the asset.");
        if (input.AssetId is int assetId && !await db.Assets.AnyAsync(a => a.Id == assetId && a.CustomerId == customer.Id, ct))
            ModelState.AddModelError("assetId", "Choose an asset of this customer.");
        if (input.DealerUserId is int du && !await db.Users.AnyAsync(u => u.Id == du && u.DealerId == customer.DealerId && u.IsActive, ct))
            ModelState.AddModelError("dealerUserId", "Choose an engineer of the customer's dealer.");
        if (input.OwnerUserId is int owner && !await db.Users.AnyAsync(u => u.Id == owner && u.UserType == UserType.Edwards && u.IsActive, ct))
            ModelState.AddModelError("ownerUserId", "Choose an Edwards user as owner.");
        if (input.ExpectedCloseDate is DateOnly close && close < DateOnly.FromDateTime(DateTime.Today).AddYears(-1))
            ModelState.AddModelError("expectedCloseDate", "The expected close date is too far in the past.");
        return ModelState.IsValid ? null : ValidationProblem(ModelState);
    }

    private static void Apply(Opportunity o, OpportunityInput input, UserContext user, Customer customer)
    {
        o.Name = input.Name.Trim();
        o.Type = input.Type;
        o.CustomerId = customer.Id;
        o.AssetId = input.AssetId;
        o.DealerUserId = user.Scope == DataScope.Own ? user.UserId : input.DealerUserId ?? o.DealerUserId ?? customer.DealerUserId;
        o.OwnerUserId = input.OwnerUserId ?? o.OwnerUserId ?? (user.UserType == UserType.Edwards ? user.UserId : null);
        o.SalesPhaseId = input.SalesPhaseId;
        o.WinningChanceId = input.WinningChanceId;
        o.OpportunityModeId = input.OpportunityModeId;
        o.ExpectedCloseDate = input.ExpectedCloseDate;
        o.CompetitionPrice = input.CompetitionPrice;
        o.Remark = Clean(input.Remark);
    }

    private async Task NotifyDealerAsync(Opportunity o, string customer, CancellationToken ct)
    {
        var to = (await recipients.DealerPrincipalsAsync(o.DealerId, ct)).Cast<int?>().Append(o.DealerUserId);
        await alerts.RaiseAsync(AlertType.OpportunityAssigned, to, "Opportunity assigned to you",
            $"{customer}: {o.Name}\nPlease accept it and plan the first follow-up.", $"/opportunities/{o.Id}", ct);
    }

    internal static bool IsOpen(OpportunityStage stage) => stage is OpportunityStage.Open or OpportunityStage.Postponed;

    internal static string Label(OpportunityStage stage) => stage switch
    {
        OpportunityStage.Open => "Open",
        OpportunityStage.Won => "Won",
        OpportunityStage.Lost => "Lost",
        OpportunityStage.Postponed => "Postponed",
        _ => "Dropped",
    };

    private static OpportunityActions ActionsFor(OpportunityDetail o, UserContext user)
    {
        var open = IsOpen(o.Stage);
        return new OpportunityActions(
            Edit: open && user.Has(Permissions.OpportunitiesEdit),
            Assign: open && user.Has(Permissions.OpportunitiesAssign),
            Accept: open && !o.DealerAccepted && user.UserType != UserType.Edwards && user.DealerId == o.DealerId,
            ChangeStatus: user.Has(Permissions.OpportunitiesEdit) && (open || user.Has(Permissions.OpportunitiesReopen)),
            Reopen: !open && user.Has(Permissions.OpportunitiesReopen),
            Quote: open && user.Has(Permissions.QuotationsEdit),
            ApproveQuote: user.Has(Permissions.QuotationsApprove));
    }

    private static IQueryable<OpportunityDetail> Detail(IQueryable<Opportunity> q) =>
        q.Select(o => new OpportunityDetail(o.Id, o.Name, o.Type, o.Source, o.Stage, o.CustomerId, o.Customer!.Name, o.LeadId, o.AssetId,
            o.Asset != null ? o.Asset.SerialNumber : null, o.DealerId, o.Dealer!.Name, o.DealerUserId,
            o.DealerUser != null ? (o.DealerUser.FirstName + " " + o.DealerUser.LastName).Trim() : null, o.OwnerUserId,
            o.Owner != null ? (o.Owner.FirstName + " " + o.Owner.LastName).Trim() : null, o.DealerAccepted, o.AcceptedAt,
            o.SalesPhaseId, o.SalesPhase != null ? o.SalesPhase.Name : null, o.WinningChanceId,
            o.WinningChance != null ? o.WinningChance.Name : null, o.OpportunityModeId,
            o.OpportunityMode != null ? o.OpportunityMode.Name : null, o.ExpectedCloseDate, o.Value, o.CompetitionPrice,
            o.WinningReasonId, o.WinningReason != null ? o.WinningReason.Name : null, o.LosingReasonId,
            o.LosingReason != null ? o.LosingReason.Name : null, o.PoNumber, o.PoDate, o.ClosedDate, o.CloseRemark,
            o.NextFollowUpDate, o.Remark, o.CreatedAt, o.UpdatedAt,
            o.FollowUps.OrderByDescending(f => f.Date).ThenByDescending(f => f.Id)
                .Select(f => new FollowUpItem(f.Id, f.Date, f.Mode, f.Remark, f.NextDate,
                    f.User != null ? (f.User.FirstName + " " + f.User.LastName).Trim() : null, f.CreatedAt)).ToList(),
            null));
}
