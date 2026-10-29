namespace Edwards.Api.Domain;

/// <summary>Base for records that are never hard-deleted and carry who/when audit columns.</summary>
public abstract class AuditableEntity
{
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public int? UpdatedBy { get; set; }
}

/// <summary>A simple lookup list (zones, segments, reasons...) managed from the Masters screen.</summary>
public abstract class MasterEntity : AuditableEntity
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int SortOrder { get; set; }
}
