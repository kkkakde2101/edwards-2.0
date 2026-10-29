using Edwards.Api.Auth;
using Edwards.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Data;

public static class DbSeeder
{
    /// <summary>Runs at every startup. Safe to repeat: it only adds what is missing.</summary>
    public static async Task SeedAsync(AppDbContext db, CancellationToken ct = default)
    {
        var added = await SyncPermissionsAsync(db, ct);
        await SeedRolesAsync(db, added, ct);
        await SeedAlertSettingsAsync(db, ct);
    }

    /// <summary>Brings the Permissions table in line with the code catalog and returns the keys that are new.</summary>
    private static async Task<HashSet<string>> SyncPermissionsAsync(AppDbContext db, CancellationToken ct)
    {
        var existing = await db.Permissions.ToDictionaryAsync(p => p.Key, ct);
        var added = new HashSet<string>();
        foreach (var def in Permissions.All)
        {
            if (!existing.TryGetValue(def.Key, out var permission))
            {
                permission = new Permission { Key = def.Key };
                db.Permissions.Add(permission);
                added.Add(def.Key);
            }
            permission.Module = def.Module;
            permission.ModuleLabel = def.ModuleLabel;
            permission.Action = def.Action;
            permission.Label = def.Label;
            permission.SortOrder = def.SortOrder;
        }

        db.Permissions.RemoveRange(existing.Values.Where(p => !Permissions.Exists(p.Key)));
        await db.SaveChangesAsync(ct);
        return added;
    }

    private static async Task SeedRolesAsync(AppDbContext db, HashSet<string> addedPermissions, CancellationToken ct)
    {
        var roles = await db.Roles.Include(r => r.Permissions).ToListAsync(ct);
        if (roles.Count == 0)
        {
            foreach (var def in RoleDefaults.All)
            {
                db.Roles.Add(new Role
                {
                    Code = def.Code,
                    Name = def.Name,
                    Description = def.Description,
                    DataScope = def.Scope,
                    Permissions = def.Permissions.Select(k => new RolePermission { PermissionKey = k }).ToList(),
                });
            }
            await db.SaveChangesAsync(ct);
            return;
        }

        // A release that adds permissions grants them to the system roles that have them by default.
        // Permissions an admin removed earlier are not brought back. Business / Admin always holds everything.
        foreach (var role in roles.Where(r => r.Code is not null))
        {
            var defaults = RoleDefaults.All.FirstOrDefault(d => d.Code == role.Code)?.Permissions ?? [];
            var grant = role.Code == RoleDefaults.Admin
                ? Permissions.All.Select(p => p.Key)
                : defaults.Where(addedPermissions.Contains);
            foreach (var key in grant.Except(role.Permissions.Select(p => p.PermissionKey)).ToList())
                role.Permissions.Add(new RolePermission { PermissionKey = key });
        }
        await db.SaveChangesAsync(ct);
    }

    private static async Task SeedAlertSettingsAsync(AppDbContext db, CancellationToken ct)
    {
        var existing = await db.AlertSettings.Select(s => s.Type).ToListAsync(ct);
        foreach (var type in Enum.GetValues<AlertType>().Except(existing))
            db.AlertSettings.Add(new AlertSetting { Type = type, Enabled = true, SendEmail = true });
        await db.SaveChangesAsync(ct);
    }
}
