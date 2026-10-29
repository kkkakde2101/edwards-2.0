namespace Edwards.Api.Domain;

/// <summary>One installed Edwards unit at a customer site. Commissioning, warranty, AMC, jobs and reminders hang off it.</summary>
public class Asset : AuditableEntity
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public int? ProductRangeId { get; set; }
    public ProductRange? ProductRange { get; set; }
    public int? ProductModelId { get; set; }
    public ProductModel? ProductModel { get; set; }
    public string SerialNumber { get; set; } = "";
    public string? Description { get; set; }
    public string? SiteName { get; set; }
    public string City { get; set; } = "";
    public string PinCode { get; set; } = "";
    public DateOnly? CommissioningDate { get; set; }
    public DateOnly? WarrantyStart { get; set; }
    public DateOnly? WarrantyEnd { get; set; }
    public int ServiceIntervalMonths { get; set; } = 6;
    public DateOnly? LastServiceDate { get; set; }
    public DateOnly? NextServiceDate { get; set; }
    public int? EngineerUserId { get; set; }
    public User? Engineer { get; set; }
    public int? SourceOpportunityId { get; set; }
    public bool WarrantyAlert60Sent { get; set; }
    public bool WarrantyAlert30Sent { get; set; }
}

/// <summary>A line on the asset's history timeline, written by every module that touches the asset.</summary>
public class AssetEvent
{
    public long Id { get; set; }
    public int AssetId { get; set; }
    public DateTime At { get; set; }
    public string Kind { get; set; } = "";
    public string Text { get; set; } = "";
    public string? Link { get; set; }
    public int? UserId { get; set; }
}

public class AmcContract : AuditableEntity
{
    public int Id { get; set; }
    public int AssetId { get; set; }
    public Asset? Asset { get; set; }
    public int? AmcTypeId { get; set; }
    public AmcType? AmcType { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public int VisitsPerYear { get; set; }
    public decimal? Value { get; set; }
    public string? Remark { get; set; }
    public bool Alert60Sent { get; set; }
    public bool Alert30Sent { get; set; }
}

public enum CommissioningStatus { Planned = 0, InProgress = 1, Completed = 2, OnHold = 3 }

public class Commissioning : AuditableEntity
{
    public int Id { get; set; }
    public int AssetId { get; set; }
    public Asset? Asset { get; set; }
    public DateOnly PlannedDate { get; set; }
    public int? EngineerUserId { get; set; }
    public User? Engineer { get; set; }
    public CommissioningStatus Status { get; set; }
    public DateOnly? CompletedDate { get; set; }
    public int WarrantyMonths { get; set; } = 12;
    public string? Remark { get; set; }
}

public enum JobPriority { Low = 0, Medium = 1, High = 2 }

public enum JobStatus { Open = 0, Assigned = 1, InProgress = 2, OnHold = 3, Completed = 4, Closed = 5 }

public enum JobSource { Breakdown = 0, Reminder = 1, Opportunity = 2, Manual = 3 }

public class ServiceJob : AuditableEntity
{
    public int Id { get; set; }
    public string Number { get; set; } = "";
    public int AssetId { get; set; }
    public Asset? Asset { get; set; }
    public string Problem { get; set; } = "";
    public JobPriority Priority { get; set; }
    public JobStatus Status { get; set; }
    public JobSource Source { get; set; }
    public int? EngineerUserId { get; set; }
    public User? Engineer { get; set; }
    public DateOnly? PlannedDate { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? CompletionReport { get; set; }
    public int? ReminderId { get; set; }
    public int? OpportunityId { get; set; }
    public List<JobNote> Notes { get; set; } = [];
}

public class JobNote
{
    public int Id { get; set; }
    public int ServiceJobId { get; set; }
    public DateTime At { get; set; }
    public int? UserId { get; set; }
    public User? User { get; set; }
    public string Text { get; set; } = "";
    public JobStatus? StatusChangedTo { get; set; }
}

public enum ServiceVisitType { Commissioning = 0, Installation = 1, PreventiveMaintenance = 2, Breakdown = 3, Amc = 4, Other = 5 }

public class ServiceVisit : AuditableEntity
{
    public int Id { get; set; }
    public int AssetId { get; set; }
    public Asset? Asset { get; set; }
    public int? ServiceJobId { get; set; }
    public ServiceJob? ServiceJob { get; set; }
    public ServiceVisitType Type { get; set; }
    public int? EngineerUserId { get; set; }
    public User? Engineer { get; set; }
    public DateOnly VisitDate { get; set; }
    public DateOnly? CompletionDate { get; set; }
    public bool Completed { get; set; }
    public string? Remarks { get; set; }
}

public enum ReminderStatus { Pending = 0, Contacted = 1, Converted = 2, Dismissed = 3 }

public class ServiceReminder : AuditableEntity
{
    public int Id { get; set; }
    public int AssetId { get; set; }
    public Asset? Asset { get; set; }
    public DateOnly DueDate { get; set; }
    public ReminderStatus Status { get; set; }
    public string? Notes { get; set; }
    public string? DismissReason { get; set; }
    public int? OpportunityId { get; set; }
    public int? ServiceJobId { get; set; }
    public bool UpcomingAlertSent { get; set; }
}
