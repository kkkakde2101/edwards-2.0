namespace Edwards.Api.Domain;

public class Dealer : AuditableEntity
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int ZoneId { get; set; }
    public Zone? Zone { get; set; }
    public string? Address { get; set; }
    public string? Mobile { get; set; }
    public string? Pan { get; set; }
    public string? Email { get; set; }
    public string? Gstn { get; set; }
}

/// <summary>A customer company. Replaces today's Accounts table, where account name and company name were always equal.</summary>
public class Customer : AuditableEntity
{
    public int Id { get; set; }
    public DateOnly CustomerDate { get; set; }
    public string Name { get; set; } = "";
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? District { get; set; }
    public int? StateId { get; set; }
    public State? State { get; set; }
    public string PinCode { get; set; } = "";
    public string? Gst { get; set; }
    public int SegmentId { get; set; }
    public Segment? Segment { get; set; }
    public int AccountTypeId { get; set; }
    public AccountType? AccountType { get; set; }
    public int? BusinessLineId { get; set; }
    public BusinessLine? BusinessLine { get; set; }
    public int DealerId { get; set; }
    public Dealer? Dealer { get; set; }

    /// <summary>The dealer engineer responsible for this customer.</summary>
    public int? DealerUserId { get; set; }
    public User? DealerUser { get; set; }

    public List<Contact> Contacts { get; set; } = [];
}

public class Contact : AuditableEntity
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public string PersonName { get; set; } = "";
    public string? Designation { get; set; }
    public string Email { get; set; } = "";
    public string Mobile { get; set; } = "";
    public string? LandLine { get; set; }
    public string? ReportingTo { get; set; }
    public string? Department { get; set; }
}

/// <summary>Who changed what and when. Written automatically on every save of an audited record.</summary>
public class AuditLog
{
    public long Id { get; set; }
    public DateTime AtUtc { get; set; }
    public int? UserId { get; set; }
    public string Entity { get; set; } = "";
    public string EntityId { get; set; } = "";
    public string Action { get; set; } = "";
    public string? Changes { get; set; }
}
