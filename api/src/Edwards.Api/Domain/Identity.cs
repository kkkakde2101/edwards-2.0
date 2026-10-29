namespace Edwards.Api.Domain;

public enum UserType
{
    Edwards = 0,
    Dealer = 1,
    DealerUser = 2,
}

/// <summary>How a stored password hash was produced. Legacy hashes are upgraded on the next successful login.</summary>
public enum PasswordScheme
{
    LegacySha256 = 0,
    Pbkdf2 = 1,
}

/// <summary>Which records a role can see.</summary>
public enum DataScope
{
    All = 0,
    Zone = 1,
    Dealer = 2,
    Own = 3,
}

/// <summary>
/// One table for every login. Today's app keeps Edwards staff, dealer principals and dealer engineers
/// in three separate tables; <see cref="LegacySource"/> and <see cref="LegacyId"/> point back to them.
/// </summary>
public class User : AuditableEntity
{
    public int Id { get; set; }
    public string LoginName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public PasswordScheme PasswordScheme { get; set; }
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string Email { get; set; } = "";
    public string? Mobile { get; set; }
    public UserType UserType { get; set; }
    public int RoleId { get; set; }
    public Role? Role { get; set; }
    public int? DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public int? DesignationId { get; set; }
    public Designation? Designation { get; set; }
    public bool MustChangePassword { get; set; }
    public int FailedLoginCount { get; set; }
    public DateTime? LockoutEndUtc { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public string? LegacySource { get; set; }
    public int? LegacyId { get; set; }
    public List<UserZone> Zones { get; set; } = [];

    public string FullName => $"{FirstName} {LastName}".Trim();
}

public class UserZone
{
    public int UserId { get; set; }
    public int ZoneId { get; set; }
    public Zone? Zone { get; set; }
}

public class Role : AuditableEntity
{
    public int Id { get; set; }

    /// <summary>Fixed identifier for the roles the system creates; null for roles added by an admin.</summary>
    public string? Code { get; set; }

    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public DataScope DataScope { get; set; }
    public List<RolePermission> Permissions { get; set; } = [];
}

/// <summary>One action on one module, for example "customers.edit". Synced from the code catalog at startup.</summary>
public class Permission
{
    public string Key { get; set; } = "";
    public string Module { get; set; } = "";
    public string ModuleLabel { get; set; } = "";
    public string Action { get; set; } = "";
    public string Label { get; set; } = "";
    public int SortOrder { get; set; }
}

public class RolePermission
{
    public int RoleId { get; set; }
    public string PermissionKey { get; set; } = "";
}
