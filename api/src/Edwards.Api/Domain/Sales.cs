namespace Edwards.Api.Domain;

/// <summary>A sales visit or call by a dealer engineer. Replaces today's Visits and VisitDetails tables.</summary>
public class Visit : AuditableEntity
{
    public int Id { get; set; }
    public DateOnly VisitDate { get; set; }
    public int VisitTypeId { get; set; }
    public VisitType? VisitType { get; set; }
    public int CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public int DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    /// <summary>Required for new visits; empty only on history whose engineer no longer exists (8 visits in today's data).</summary>
    public int? DealerUserId { get; set; }
    public User? DealerUser { get; set; }
    public int? ApplicationId { get; set; }
    public ApplicationArea? Application { get; set; }

    /// <summary>What the customer makes ("Customer's end product" in today's app).</summary>
    public string? CustomerProduct { get; set; }

    public bool HasPotential { get; set; }
    public int? LeadTypeId { get; set; }
    public LeadType? LeadType { get; set; }
    public int? ProductRangeId { get; set; }
    public ProductRange? ProductRange { get; set; }
    public int? ProductModelId { get; set; }
    public ProductModel? ProductModel { get; set; }
    public string? Remark { get; set; }

    /// <summary>The lead this visit created or followed up.</summary>
    public int? LeadId { get; set; }
    public Lead? Lead { get; set; }

    public List<VisitCompetitor> Competitors { get; set; } = [];
}

/// <summary>Competitor pumps seen at the customer during a visit.</summary>
public class VisitCompetitor
{
    public int Id { get; set; }
    public int VisitId { get; set; }
    public int? CompetitionMakeId { get; set; }
    public CompetitionMake? CompetitionMake { get; set; }
    public string? Model { get; set; }
    public int? Quantity { get; set; }
    public int? Working { get; set; }
    public int? Standby { get; set; }
    public int? PumpTechnologyId { get; set; }
    public PumpTechnology? PumpTechnology { get; set; }
}

public enum LeadStatus { New = 0, Qualified = 1, Converted = 2, Disqualified = 3 }

public enum LeadSource { Visit = 0, Manual = 1, Reminder = 2, Upload = 3, Enquiry = 4 }

public class Lead : AuditableEntity
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public LeadSource Source { get; set; }
    public LeadStatus Status { get; set; }
    public int? VisitId { get; set; }
    public int? DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public int? DealerUserId { get; set; }
    public User? DealerUser { get; set; }
    public int? OwnerUserId { get; set; }
    public User? Owner { get; set; }
    public int? ProductRangeId { get; set; }
    public ProductRange? ProductRange { get; set; }
    public int? ProductModelId { get; set; }
    public ProductModel? ProductModel { get; set; }
    public string? Remark { get; set; }
    public string? DisqualifyReason { get; set; }
    public int? OpportunityId { get; set; }
}

public enum OpportunityType { Equipment = 0, Spare = 1, Service = 2 }

/// <summary>Fixed workflow states. Replaces today's editable status list, because the rules (PO for won, reason for lost) depend on them.</summary>
public enum OpportunityStage { Open = 0, Won = 1, Lost = 2, Postponed = 3, Dropped = 4 }

public enum OpportunitySource { Lead = 0, Manual = 1, Reminder = 2 }

public class Opportunity : AuditableEntity
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public OpportunityType Type { get; set; }
    public OpportunitySource Source { get; set; }
    public OpportunityStage Stage { get; set; }
    public int CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public int? LeadId { get; set; }
    public Lead? Lead { get; set; }
    public int? AssetId { get; set; }
    public Asset? Asset { get; set; }
    public int? ReminderId { get; set; }
    public int DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public int? DealerUserId { get; set; }
    public User? DealerUser { get; set; }

    /// <summary>The Edwards sales person who owns the opportunity.</summary>
    public int? OwnerUserId { get; set; }
    public User? Owner { get; set; }

    public bool DealerAccepted { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public int? SalesPhaseId { get; set; }
    public SalesPhase? SalesPhase { get; set; }
    public int? WinningChanceId { get; set; }
    public WinningChance? WinningChance { get; set; }
    public int? OpportunityModeId { get; set; }
    public OpportunityMode? OpportunityMode { get; set; }
    public DateOnly? ExpectedCloseDate { get; set; }

    /// <summary>Total of the latest quotation that was not rejected.</summary>
    public decimal Value { get; set; }

    public decimal? CompetitionPrice { get; set; }
    public int? WinningReasonId { get; set; }
    public WinningReason? WinningReason { get; set; }
    public int? LosingReasonId { get; set; }
    public LosingReason? LosingReason { get; set; }
    public string? PoNumber { get; set; }
    public DateOnly? PoDate { get; set; }
    public DateOnly? ClosedDate { get; set; }
    public string? CloseRemark { get; set; }
    public DateOnly? NextFollowUpDate { get; set; }
    public bool FollowUpOverdueAlerted { get; set; }
    public string? Remark { get; set; }

    public List<FollowUp> FollowUps { get; set; } = [];
    public List<Quotation> Quotations { get; set; } = [];
}

public enum FollowUpMode { Visit = 0, Call = 1, Email = 2, Meeting = 3, Other = 4 }

public class FollowUp
{
    public int Id { get; set; }
    public int OpportunityId { get; set; }
    public DateOnly Date { get; set; }
    public FollowUpMode Mode { get; set; }
    public string Remark { get; set; } = "";
    public DateOnly? NextDate { get; set; }
    public int? UserId { get; set; }
    public User? User { get; set; }
    public DateTime CreatedAt { get; set; }
}

public enum QuotationStatus { Draft = 0, Submitted = 1, Revised = 2, Accepted = 3, Rejected = 4 }

public class Quotation : AuditableEntity
{
    public int Id { get; set; }
    public int OpportunityId { get; set; }
    public Opportunity? Opportunity { get; set; }
    public int Revision { get; set; }
    public string Number { get; set; } = "";
    public DateOnly QuoteDate { get; set; }
    public QuotationStatus Status { get; set; }
    public decimal Total { get; set; }
    public string? Remark { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public int? SubmittedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public int? DecidedBy { get; set; }
    public string? DecisionRemark { get; set; }
    public List<QuotationLine> Lines { get; set; } = [];
}

public enum LineType { Equipment = 0, Spare = 1, Service = 2 }

public class QuotationLine
{
    public int Id { get; set; }
    public int QuotationId { get; set; }
    public LineType Type { get; set; }
    public int? ProductRangeId { get; set; }
    public ProductRange? ProductRange { get; set; }
    public int? ProductModelId { get; set; }
    public ProductModel? ProductModel { get; set; }
    public string? Description { get; set; }
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal LineTotal { get; set; }
}

public enum TransferStatus { Pending = 0, Approved = 1, Rejected = 2 }

/// <summary>Moving a customer from one dealer to another. History stays; open work moves on the effective date.</summary>
public class CustomerTransfer
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public int FromDealerId { get; set; }
    public Dealer? FromDealer { get; set; }
    public int ToDealerId { get; set; }
    public Dealer? ToDealer { get; set; }
    public int? ToDealerUserId { get; set; }
    public User? ToDealerUser { get; set; }
    public string Reason { get; set; } = "";
    public DateOnly EffectiveDate { get; set; }
    public TransferStatus Status { get; set; }
    public int RequestedBy { get; set; }
    public DateTime RequestedAt { get; set; }
    public int? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionRemark { get; set; }
    public DateTime? AppliedAt { get; set; }
}

/// <summary>Value target for a dealer for one fiscal year (April to March, named by its starting year).</summary>
public class DealerTarget : AuditableEntity
{
    public int Id { get; set; }
    public int DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public int FiscalYear { get; set; }
    public decimal TargetValue { get; set; }
}

public class DealerQuantityTarget : AuditableEntity
{
    public int Id { get; set; }
    public int DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public int FiscalYear { get; set; }
    public int ProductRangeId { get; set; }
    public ProductRange? ProductRange { get; set; }
    public int TargetQuantity { get; set; }
    public decimal TargetValue { get; set; }
}
