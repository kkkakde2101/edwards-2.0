using Edwards.Api.Data;
using Edwards.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Edwards.Api.Auth;

/// <summary>Reads the signed-in user's id from the token. Kept separate from <see cref="ICurrentUser"/> so the DbContext can use it.</summary>
public interface IUserIdAccessor
{
    int? UserId { get; }
}

public sealed class HttpUserIdAccessor(IHttpContextAccessor http) : IUserIdAccessor
{
    public int? UserId =>
        int.TryParse(http.HttpContext?.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var id) ? id : null;
}

/// <summary>Everything a request needs to know about the signed-in user: role, data scope, dealer, zones and permissions.</summary>
public sealed record UserContext(
    int UserId,
    string LoginName,
    string DisplayName,
    UserType UserType,
    int RoleId,
    string RoleName,
    DataScope Scope,
    int? DealerId,
    string? DealerName,
    IReadOnlyList<int> ZoneIds,
    IReadOnlySet<string> Permissions,
    bool IsActive,
    bool MustChangePassword)
{
    public bool Has(string permission) => Permissions.Contains(permission);
}

public interface ICurrentUser
{
    int? UserId { get; }
    Task<UserContext?> GetAsync(CancellationToken ct = default);
    Task<UserContext> RequireAsync(CancellationToken ct = default);
}

/// <summary>
/// Loads the user's context from the database once per request. Active state, role and zones are read fresh,
/// so deactivating a user or changing a role takes effect on their next request, not when the token expires.
/// </summary>
public sealed class CurrentUser(IUserIdAccessor ids, AppDbContext db, PermissionCache permissions) : ICurrentUser
{
    private UserContext? _context;
    private bool _loaded;

    public int? UserId => ids.UserId;

    public async Task<UserContext?> GetAsync(CancellationToken ct = default)
    {
        if (_loaded) return _context;
        _loaded = true;
        if (ids.UserId is not int id) return null;

        var u = await db.Users.AsNoTracking()
            .Where(x => x.Id == id)
            .Select(x => new
            {
                x.Id,
                x.LoginName,
                x.FirstName,
                x.LastName,
                x.UserType,
                x.RoleId,
                RoleName = x.Role!.Name,
                x.Role.DataScope,
                RoleActive = x.Role.IsActive,
                x.DealerId,
                DealerName = x.Dealer != null ? x.Dealer.Name : null,
                x.IsActive,
                x.MustChangePassword,
                ZoneIds = x.Zones.Select(z => z.ZoneId).ToList(),
            })
            .FirstOrDefaultAsync(ct);
        if (u is null) return null;

        var granted = u.RoleActive ? await permissions.GetAsync(db, u.RoleId, ct) : new HashSet<string>();
        _context = new UserContext(
            u.Id, u.LoginName, $"{u.FirstName} {u.LastName}".Trim(), u.UserType, u.RoleId, u.RoleName, u.DataScope,
            u.DealerId, u.DealerName, u.ZoneIds, granted, u.IsActive, u.MustChangePassword);
        return _context;
    }

    public async Task<UserContext> RequireAsync(CancellationToken ct = default) =>
        await GetAsync(ct) ?? throw new UnauthorizedAccessException("No signed-in user.");
}

/// <summary>Caches each role's permission keys for two minutes; cleared immediately when a role is edited.</summary>
public sealed class PermissionCache(IMemoryCache cache)
{
    private static string Key(int roleId) => $"role-permissions:{roleId}";

    public async Task<IReadOnlySet<string>> GetAsync(AppDbContext db, int roleId, CancellationToken ct)
    {
        if (cache.TryGetValue(Key(roleId), out IReadOnlySet<string>? cached) && cached is not null) return cached;

        var keys = await db.RolePermissions.AsNoTracking()
            .Where(r => r.RoleId == roleId)
            .Select(r => r.PermissionKey)
            .ToListAsync(ct);
        IReadOnlySet<string> set = keys.ToHashSet();
        cache.Set(Key(roleId), set, TimeSpan.FromMinutes(2));
        return set;
    }

    public void Invalidate(int roleId) => cache.Remove(Key(roleId));
}
