namespace Edwards.Api.Domain;

/// <summary>Every alert the system can send. Admins switch each one on or off, and choose whether it is also emailed.</summary>
public enum AlertType
{
    OpportunityStatus = 0,
    PasswordReset = 1,
    Manual = 2,
    Welcome = 3,
    LeadAssigned = 4,
    OpportunityAssigned = 5,
    FollowUpOverdue = 6,
    QuotationSubmitted = 7,
    QuotationDecided = 8,
    TransferRequested = 9,
    TransferDecided = 10,
    ServiceReminder = 11,
    UpcomingService = 12,
    PostCommissioning = 13,
    WarrantyExpiring = 14,
    AmcExpiring = 15,
    JobAssigned = 16,
    JobCompleted = 17,
    UploadResult = 18,
}

public class AlertSetting
{
    public AlertType Type { get; set; }
    public bool Enabled { get; set; } = true;
    public bool SendEmail { get; set; } = true;
}

/// <summary>An in-app notification shown under the bell in the header.</summary>
public class Notification
{
    public long Id { get; set; }
    public int UserId { get; set; }
    public AlertType Type { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string? Link { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ReadAt { get; set; }
}

public enum EmailStatus { Pending = 0, Sent = 1, Failed = 2 }

/// <summary>Email outbox. A background sender delivers each message, retries failures and keeps the result.</summary>
public class EmailMessage
{
    public long Id { get; set; }
    public string To { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public AlertType Type { get; set; }
    public EmailStatus Status { get; set; }
    public int Attempts { get; set; }
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? NextAttemptAt { get; set; }
    public DateTime? SentAt { get; set; }
}

public enum DocumentOwner { Customer = 0, Asset = 1, Opportunity = 2, Quotation = 3, Commissioning = 4, ServiceJob = 5 }

public class Document : AuditableEntity
{
    public int Id { get; set; }
    public DocumentOwner OwnerType { get; set; }
    public int OwnerId { get; set; }

    /// <summary>The customer the document belongs to, used to apply the viewer's data scope.</summary>
    public int CustomerId { get; set; }
    public Customer? Customer { get; set; }

    public int? DocumentTypeId { get; set; }
    public DocumentType? DocumentType { get; set; }
    public string Title { get; set; } = "";
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Size { get; set; }
    public string StorageKey { get; set; } = "";
}

/// <summary>Every view, download and refused attempt on a document.</summary>
public class DocumentAccess
{
    public long Id { get; set; }
    public int DocumentId { get; set; }
    public int UserId { get; set; }
    public DateTime At { get; set; }
    public string Action { get; set; } = "";
}

public class UploadBatch
{
    public int Id { get; set; }
    public string Kind { get; set; } = "";
    public string FileName { get; set; } = "";
    public int UploadedBy { get; set; }
    public DateTime At { get; set; }
    public int Rows { get; set; }
    public int Saved { get; set; }
    public int Failed { get; set; }
    public string? Errors { get; set; }
}

public class PasswordResetToken
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
}
