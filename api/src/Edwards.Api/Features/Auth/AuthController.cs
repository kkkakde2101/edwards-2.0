using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Features.Users;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Edwards.Api.Features.Auth;

public sealed class LoginRequest
{
    [Required, StringLength(50)]
    public string LoginName { get; set; } = "";

    [Required, StringLength(128)]
    public string Password { get; set; } = "";
}

public sealed record LoginResponse(string Token, DateTime ExpiresAt, bool MustChangePassword);

public sealed class ChangePasswordRequest
{
    [Required]
    public string CurrentPassword { get; set; } = "";

    [Required, StringLength(128)]
    public string NewPassword { get; set; } = "";
}

public sealed class ForgotPasswordRequest
{
    [Required, StringLength(100)]
    public string LoginOrEmail { get; set; } = "";
}

public sealed class ResetPasswordRequest
{
    [Required]
    public string Token { get; set; } = "";

    [Required, StringLength(128)]
    public string NewPassword { get; set; } = "";
}

public sealed record MeResponse(
    int Id,
    string LoginName,
    string DisplayName,
    string RoleName,
    DataScope Scope,
    UserType UserType,
    int? DealerId,
    string? DealerName,
    bool MustChangePassword,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<MenuItem> Menu);

[ApiController]
[Route("api/auth")]
public sealed class AuthController(
    AppDbContext db,
    PasswordService passwords,
    TokenService tokens,
    ICurrentUser currentUser,
    AlertService alerts,
    IOptions<SecurityOptions> security) : ControllerBase
{
    private const string InvalidLogin = "Invalid login name or password.";

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest request, CancellationToken ct)
    {
        var loginName = request.LoginName.Trim();
        var password = request.Password.Trim();
        var now = DateTime.UtcNow;
        var user = await db.Users.FirstOrDefaultAsync(u => u.LoginName == loginName, ct);

        if (user is null || !user.IsActive)
        {
            passwords.VerifyDummy(password);
            return Problem(InvalidLogin, statusCode: StatusCodes.Status401Unauthorized);
        }

        if (user.LockoutEndUtc > now)
        {
            return Problem("Too many failed attempts. Try again in a few minutes.", statusCode: StatusCodes.Status401Unauthorized);
        }

        var check = passwords.Verify(user, password);
        if (check == PasswordCheck.Failed)
        {
            user.FailedLoginCount++;
            if (user.FailedLoginCount >= security.Value.LockoutThreshold)
            {
                user.LockoutEndUtc = now.AddMinutes(security.Value.LockoutMinutes);
                user.FailedLoginCount = 0;
            }
            await db.SaveChangesAsync(ct);
            return Problem(InvalidLogin, statusCode: StatusCodes.Status401Unauthorized);
        }

        if (check == PasswordCheck.SuccessRehashNeeded)
        {
            // Upgrades the unsalted SHA-256 hash copied from today's app to PBKDF2.
            user.PasswordHash = passwords.Hash(user, password);
            user.PasswordScheme = PasswordScheme.Pbkdf2;
        }

        user.FailedLoginCount = 0;
        user.LockoutEndUtc = null;
        user.LastLoginAt = now;
        await db.SaveChangesAsync(ct);

        var (token, expiresAt) = tokens.Create(user);
        return new LoginResponse(token, expiresAt, user.MustChangePassword);
    }

    /// <summary>Emails a one-time link when the login name or email matches an active user. Always answers the same way.</summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request, CancellationToken ct)
    {
        var value = request.LoginOrEmail.Trim();
        var matches = await db.Users.Where(u => u.IsActive && (u.LoginName == value || u.Email == value)).Select(u => u.Id).ToListAsync(ct);
        // Several old logins share one email address; only an exact login name or a unique email gets a link.
        if (matches.Count == 1)
        {
            var token = await PasswordLinks.IssueAsync(db, matches[0], TimeSpan.FromHours(1), ct);
            await alerts.RaiseAsync(AlertType.PasswordReset, [matches[0]], "Choose a new password",
                "Someone asked to reset your Edwards password. If it was you, use the button below within 1 hour.\nIf it was not you, ignore this email; your password has not changed.",
                $"/reset-password?token={token}", ct);
            await db.SaveChangesAsync(ct);
        }
        return NoContent();
    }

    [HttpPost("reset-password")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request, CancellationToken ct)
    {
        var hash = PasswordLinks.Hash(request.Token.Trim());
        var link = await db.PasswordResetTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (link is null || link.UsedAt is not null || link.ExpiresAt < DateTime.UtcNow)
            return Problem("This link has expired or was already used. Ask for a new one.", statusCode: StatusCodes.Status400BadRequest);

        var user = await db.Users.FirstAsync(u => u.Id == link.UserId, ct);
        if (PasswordService.Validate(request.NewPassword, user.LoginName) is string problem)
        {
            ModelState.AddModelError("newPassword", problem);
            return ValidationProblem(ModelState);
        }

        user.PasswordHash = passwords.Hash(user, request.NewPassword);
        user.PasswordScheme = PasswordScheme.Pbkdf2;
        user.MustChangePassword = false;
        user.FailedLoginCount = 0;
        user.LockoutEndUtc = null;
        link.UsedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<MeResponse>> Me(CancellationToken ct)
    {
        var user = await currentUser.GetAsync(ct);
        if (user is null || !user.IsActive) return Unauthorized();

        return new MeResponse(
            user.UserId, user.LoginName, user.DisplayName, user.RoleName, user.Scope, user.UserType, user.DealerId, user.DealerName,
            user.MustChangePassword, user.Permissions.Order().ToList(), MenuCatalog.For(user));
    }

    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == currentUser.UserId, ct);
        if (user is null || !user.IsActive) return Unauthorized();

        if (passwords.Verify(user, request.CurrentPassword.Trim()) == PasswordCheck.Failed)
            ModelState.AddModelError("currentPassword", "The current password is not correct.");
        else if (request.NewPassword == request.CurrentPassword)
            ModelState.AddModelError("newPassword", "Choose a password different from the current one.");
        else if (PasswordService.Validate(request.NewPassword, user.LoginName) is string problem)
            ModelState.AddModelError("newPassword", problem);

        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        user.PasswordHash = passwords.Hash(user, request.NewPassword);
        user.PasswordScheme = PasswordScheme.Pbkdf2;
        user.MustChangePassword = false;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
