using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Roles;

public sealed record RoleSummary(int Id, string? Code, string Name, string? Description, DataScope Scope, bool IsActive, int Users, int Permissions);

public sealed record RoleDetail(int Id, string? Code, string Name, string? Description, DataScope Scope, bool IsActive, int Users, bool IsLocked, List<string> PermissionKeys);

public sealed record PermissionAction(string Key, string Action, string Label);

public sealed record PermissionModule(string Module, string Label, List<PermissionAction> Actions);

public sealed class RoleInput
{
    [Required, StringLength(50, MinimumLength = 2)]
    public string Name { get; set; } = "";

    [StringLength(200)]
    public string? Description { get; set; }

    [Required]
    public DataScope? Scope { get; set; }

    public bool IsActive { get; set; } = true;

    public List<string> PermissionKeys { get; set; } = [];
}

/// <summary>Roles and the permission matrix. Business / Admin is locked: it always holds every permission.</summary>
[ApiController]
[Route("api/roles")]
public sealed class RolesController(AppDbContext db, ICurrentUser currentUser, PermissionCache cache) : ControllerBase
{
    [HttpGet]
    [HasPermission(Permissions.RolesView)]
    public async Task<List<RoleSummary>> List(CancellationToken ct) =>
        await db.Roles.AsNoTracking()
            .OrderByDescending(r => r.Code != null).ThenBy(r => r.Id)
            .Select(r => new RoleSummary(r.Id, r.Code, r.Name, r.Description, r.DataScope, r.IsActive,
                db.Users.Count(u => u.RoleId == r.Id && u.IsActive), r.Permissions.Count))
            .ToListAsync(ct);

    [HttpGet("permissions")]
    [HasPermission(Permissions.RolesView)]
    public async Task<List<PermissionModule>> Catalog(CancellationToken ct)
    {
        var all = await db.Permissions.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync(ct);
        return all
            .GroupBy(p => (p.Module, p.ModuleLabel))
            .Select(g => new PermissionModule(g.Key.Module, g.Key.ModuleLabel,
                g.Select(p => new PermissionAction(p.Key, p.Action, p.Label)).ToList()))
            .ToList();
    }

    [HttpGet("{id:int}")]
    [HasPermission(Permissions.RolesView)]
    public async Task<ActionResult<RoleDetail>> Get(int id, CancellationToken ct)
    {
        var role = await db.Roles.AsNoTracking().Include(r => r.Permissions).FirstOrDefaultAsync(r => r.Id == id, ct);
        return role is null ? NotFound() : await ToDetailAsync(role, ct);
    }

    [HttpPost]
    [HasPermission(Permissions.RolesEdit)]
    public async Task<ActionResult<RoleDetail>> Create(RoleInput input, CancellationToken ct)
    {
        Validate(input);
        if (await db.Roles.AnyAsync(r => r.Name == input.Name.Trim(), ct))
            ModelState.AddModelError("name", "Another role already has this name.");
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var role = new Role
        {
            Name = input.Name.Trim(),
            Description = Clean(input.Description),
            DataScope = input.Scope!.Value,
            IsActive = input.IsActive,
            Permissions = input.PermissionKeys.Distinct().Select(k => new RolePermission { PermissionKey = k }).ToList(),
        };
        db.Roles.Add(role);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = role.Id }, await ToDetailAsync(role, ct));
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.RolesEdit)]
    public async Task<ActionResult<RoleDetail>> Update(int id, RoleInput input, CancellationToken ct)
    {
        var role = await db.Roles.Include(r => r.Permissions).FirstOrDefaultAsync(r => r.Id == id, ct);
        if (role is null) return NotFound();

        var me = await currentUser.RequireAsync(ct);
        var locked = role.Code == RoleDefaults.Admin;
        var wanted = locked ? Permissions.All.Select(p => p.Key).ToHashSet() : input.PermissionKeys.ToHashSet();

        Validate(input);
        if (await db.Roles.AnyAsync(r => r.Name == input.Name.Trim() && r.Id != id, ct))
            ModelState.AddModelError("name", "Another role already has this name.");
        if (role.Id == me.RoleId && !input.IsActive)
            ModelState.AddModelError("isActive", "You cannot deactivate your own role.");
        if (role.Id == me.RoleId && !(wanted.Contains(Permissions.RolesView) && wanted.Contains(Permissions.RolesEdit)))
            ModelState.AddModelError("permissionKeys", "You cannot remove role management from your own role.");
        if (locked && !input.IsActive)
            ModelState.AddModelError("isActive", "The Business / Admin role cannot be deactivated.");
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        role.Name = input.Name.Trim();
        role.Description = Clean(input.Description);
        role.IsActive = input.IsActive;
        if (!locked) role.DataScope = input.Scope!.Value;

        role.Permissions.RemoveAll(p => !wanted.Contains(p.PermissionKey));
        foreach (var key in wanted.Except(role.Permissions.Select(p => p.PermissionKey)))
            role.Permissions.Add(new RolePermission { RoleId = role.Id, PermissionKey = key });

        await db.SaveChangesAsync(ct);
        cache.Invalidate(role.Id);
        return await ToDetailAsync(role, ct);
    }

    private void Validate(RoleInput input)
    {
        var unknown = input.PermissionKeys.Where(k => !Permissions.Exists(k)).ToList();
        if (unknown.Count > 0)
            ModelState.AddModelError("permissionKeys", $"Unknown permissions: {string.Join(", ", unknown)}.");
    }

    private async Task<RoleDetail> ToDetailAsync(Role role, CancellationToken ct) =>
        new(role.Id, role.Code, role.Name, role.Description, role.DataScope, role.IsActive,
            await db.Users.CountAsync(u => u.RoleId == role.Id && u.IsActive, ct),
            role.Code == RoleDefaults.Admin,
            role.Permissions.Select(p => p.PermissionKey).Order().ToList());

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
