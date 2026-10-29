using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Users;

public sealed class UserQuery : ListQuery
{
    public int? RoleId { get; set; }
    public UserType? Type { get; set; }
    public int? DealerId { get; set; }
    public string Status { get; set; } = "active";
}

public sealed record UserListItem(int Id, string LoginName, string Name, string Email, string? Mobile, string Role, UserType Type,
    string? Dealer, string Zones, bool IsActive, DateTime? LastLoginAt);

public sealed record UserDetail(int Id, string LoginName, string FirstName, string LastName, string Email, string? Mobile, int RoleId,
    UserType Type, int? DealerId, int? DesignationId, List<int> ZoneIds, bool IsActive, bool MustChangePassword,
    DateTime? LastLoginAt, string? LegacySource, DateTime CreatedAt);

public sealed class UserInput
{
    [Required, StringLength(50, MinimumLength = 3), RegularExpression(@"^[A-Za-z0-9._@\- ]+$", ErrorMessage = "Use letters, digits, spaces and . _ @ - only.")]
    public string LoginName { get; set; } = "";

    [Required, StringLength(50)]
    public string FirstName { get; set; } = "";

    [StringLength(50)]
    public string? LastName { get; set; }

    [Required, EmailAddress, StringLength(100)]
    public string Email { get; set; } = "";

    [StringLength(50)]
    public string? Mobile { get; set; }

    [Required]
    public int? RoleId { get; set; }

    public UserType Type { get; set; }
    public int? DealerId { get; set; }
    public int? DesignationId { get; set; }
    public List<int> ZoneIds { get; set; } = [];
    public bool IsActive { get; set; } = true;
}

public sealed class SetPasswordInput
{
    /// <summary>Leave empty to email the user a link to choose their own password.</summary>
    public string? Password { get; set; }
}

[Route("api/users")]
public sealed class UsersController(AppDbContext db, ICurrentUser currentUser, PasswordService passwords, AlertService alerts) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.UsersView)]
    public async Task<PagedResult<UserListItem>> List([FromQuery] UserQuery q, CancellationToken ct)
    {
        var query = db.Users.AsNoTracking();
        if (Clean(q.Search) is string s)
            query = query.Where(u => u.LoginName.Contains(s) || u.FirstName.Contains(s) || u.LastName.Contains(s) || u.Email.Contains(s));
        if (q.RoleId is int roleId) query = query.Where(u => u.RoleId == roleId);
        if (q.Type is UserType type) query = query.Where(u => u.UserType == type);
        if (q.DealerId is int dealerId) query = query.Where(u => u.DealerId == dealerId);
        query = q.Status switch { "inactive" => query.Where(u => !u.IsActive), "all" => query, _ => query.Where(u => u.IsActive) };

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await query
            .OrderBy(u => u.FirstName).ThenBy(u => u.LastName)
            .Skip((page - 1) * size).Take(size)
            .Select(u => new UserListItem(u.Id, u.LoginName, (u.FirstName + " " + u.LastName).Trim(), u.Email, u.Mobile, u.Role!.Name,
                u.UserType, u.Dealer != null ? u.Dealer.Name : null,
                string.Join(", ", u.Zones.Select(z => z.Zone!.Name)), u.IsActive, u.LastLoginAt))
            .ToListAsync(ct);
        return new PagedResult<UserListItem>(items, total, page, size);
    }

    [HttpGet("{id:int}")]
    [HasPermission(Permissions.UsersView)]
    public async Task<ActionResult<UserDetail>> Get(int id, CancellationToken ct)
    {
        var u = await db.Users.AsNoTracking().Include(x => x.Zones).FirstOrDefaultAsync(x => x.Id == id, ct);
        return u is null ? NotFound() : ToDetail(u);
    }

    [HttpPost]
    [HasPermission(Permissions.UsersEdit)]
    public async Task<ActionResult<UserDetail>> Create(UserInput input, CancellationToken ct)
    {
        if (await ValidateAsync(input, null, ct) is ActionResult problem) return problem;

        var user = new User { PasswordScheme = PasswordScheme.Pbkdf2, MustChangePassword = true };
        Apply(user, input);
        // Nobody knows this password; the user sets their own through the welcome link.
        user.PasswordHash = passwords.Hash(user, Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)));
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        var token = await PasswordLinks.IssueAsync(db, user.Id, TimeSpan.FromDays(3), ct);
        await alerts.RaiseAsync(AlertType.Welcome, [user.Id], "Your Edwards account is ready",
            $"Your login name is {user.LoginName}.\nUse the button below within 3 days to choose your password.",
            $"/reset-password?token={token}", ct);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = user.Id }, ToDetail(user));
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.UsersEdit)]
    public async Task<ActionResult<UserDetail>> Update(int id, UserInput input, CancellationToken ct)
    {
        var user = await db.Users.Include(u => u.Zones).FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return NotFound();
        if (id == currentUser.UserId && (!input.IsActive || input.RoleId != user.RoleId))
            return Invalid("roleId", "You cannot change your own role or deactivate yourself.");
        if (await ValidateAsync(input, id, ct) is ActionResult problem) return problem;

        Apply(user, input);
        await db.SaveChangesAsync(ct);
        return ToDetail(user);
    }

    /// <summary>Sets a temporary password the user must change, or emails them a link to choose one.</summary>
    [HttpPost("{id:int}/password")]
    [HasPermission(Permissions.UsersEdit)]
    public async Task<IActionResult> SetPassword(int id, SetPasswordInput input, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return NotFound();

        if (!string.IsNullOrEmpty(input.Password))
        {
            if (PasswordService.Validate(input.Password, user.LoginName) is string error) return Invalid("password", error);
            user.PasswordHash = passwords.Hash(user, input.Password);
            user.PasswordScheme = PasswordScheme.Pbkdf2;
            user.MustChangePassword = true;
        }
        else
        {
            var token = await PasswordLinks.IssueAsync(db, user.Id, TimeSpan.FromHours(24), ct);
            await alerts.RaiseAsync(AlertType.PasswordReset, [user.Id], "Choose a new password",
                "An administrator asked for your Edwards password to be reset.\nUse the button below within 24 hours to choose a new one.",
                $"/reset-password?token={token}", ct);
        }
        user.FailedLoginCount = 0;
        user.LockoutEndUtc = null;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<ActionResult?> ValidateAsync(UserInput input, int? id, CancellationToken ct)
    {
        var login = input.LoginName.Trim();
        if (await db.Users.AnyAsync(u => u.LoginName == login && u.Id != (id ?? 0), ct))
            ModelState.AddModelError("loginName", "Another user already has this login name.");
        if (!await db.Roles.AnyAsync(r => r.Id == input.RoleId && r.IsActive, ct))
            ModelState.AddModelError("roleId", "Choose an active role.");
        if (input.Type is UserType.Dealer or UserType.DealerUser)
        {
            if (input.DealerId is not int dealerId || !await db.Dealers.AnyAsync(d => d.Id == dealerId, ct))
                ModelState.AddModelError("dealerId", "Dealer users must belong to a dealer.");
        }
        var zones = input.ZoneIds.Distinct().ToList();
        if (zones.Count > 0 && await db.Zones.CountAsync(z => zones.Contains(z.Id), ct) != zones.Count)
            ModelState.AddModelError("zoneIds", "Choose zones from the list.");
        return ModelState.IsValid ? null : ValidationProblem(ModelState);
    }

    private static void Apply(User user, UserInput input)
    {
        user.LoginName = input.LoginName.Trim();
        user.FirstName = input.FirstName.Trim();
        user.LastName = input.LastName?.Trim() ?? "";
        user.Email = input.Email.Trim();
        user.Mobile = Clean(input.Mobile);
        user.RoleId = input.RoleId!.Value;
        user.UserType = input.Type;
        user.DealerId = input.Type == UserType.Edwards ? null : input.DealerId;
        user.DesignationId = input.DesignationId;
        user.IsActive = input.IsActive;
        var wanted = input.ZoneIds.Distinct().ToHashSet();
        user.Zones.RemoveAll(z => !wanted.Contains(z.ZoneId));
        foreach (var zoneId in wanted.Except(user.Zones.Select(z => z.ZoneId)))
            user.Zones.Add(new UserZone { ZoneId = zoneId });
    }

    private static UserDetail ToDetail(User u) =>
        new(u.Id, u.LoginName, u.FirstName, u.LastName, u.Email, u.Mobile, u.RoleId, u.UserType, u.DealerId, u.DesignationId,
            u.Zones.Select(z => z.ZoneId).ToList(), u.IsActive, u.MustChangePassword, u.LastLoginAt, u.LegacySource, u.CreatedAt);
}

/// <summary>One-time links for choosing a password. Only a hash of the token is stored.</summary>
public static class PasswordLinks
{
    public static async Task<string> IssueAsync(AppDbContext db, int userId, TimeSpan lifetime, CancellationToken ct)
    {
        // Older unused links stop working when a new one is issued.
        var open = await db.PasswordResetTokens.Where(t => t.UserId == userId && t.UsedAt == null).ToListAsync(ct);
        foreach (var t in open) t.UsedAt = DateTime.UtcNow;

        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        db.PasswordResetTokens.Add(new PasswordResetToken { UserId = userId, TokenHash = Hash(token), ExpiresAt = DateTime.UtcNow.Add(lifetime) });
        return token;
    }

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
