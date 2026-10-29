using System.Net;
using System.Net.Mail;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Edwards.Api.Features.Alerts;

public sealed class EmailOptions
{
    /// <summary>"Pickup" writes .eml files to <see cref="PickupDirectory"/> (development); "Smtp" sends through the server below.</summary>
    public string Mode { get; set; } = "Pickup";

    public string PickupDirectory { get; set; } = "App_Data/mail";
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public bool UseSsl { get; set; } = true;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string From { get; set; } = "no-reply@edwards.local";
    public string FromName { get; set; } = "Edwards";

    /// <summary>Address of the web app, used for links in emails.</summary>
    public string AppBaseUrl { get; set; } = "http://localhost:4200";
}

/// <summary>
/// Raises alerts: an in-app notification for each recipient, plus an email in the outbox when the alert type allows it.
/// Call before <c>SaveChangesAsync</c> so the alert is stored together with the change that caused it.
/// </summary>
public sealed class AlertService(AppDbContext db, IOptions<EmailOptions> options)
{
    // Password reset and welcome messages are always sent, whatever the settings say.
    private static readonly HashSet<AlertType> Mandatory = [AlertType.PasswordReset, AlertType.Welcome];

    public Task RaiseAsync(AlertType type, IEnumerable<int?> userIds, string title, string body, string? link, CancellationToken ct = default) =>
        RaiseAsync(type, userIds, title, body, link, true, ct);

    /// <param name="email">False keeps the alert in-app only, even when the setting allows email.</param>
    public async Task RaiseAsync(AlertType type, IEnumerable<int?> userIds, string title, string body, string? link, bool email,
        CancellationToken ct)
    {
        var setting = await db.AlertSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Type == type, ct);
        var mandatory = Mandatory.Contains(type);
        if (setting is { Enabled: false } && !mandatory) return;

        var ids = userIds.Where(i => i.HasValue).Select(i => i!.Value).Distinct().ToList();
        if (ids.Count == 0) return;
        title = Fit(title, 200);
        body = Fit(body, 1000);

        var recipients = await db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id) && u.IsActive)
            .Select(u => new { u.Id, u.Email, u.FirstName })
            .ToListAsync(ct);

        var now = DateTime.UtcNow;
        foreach (var r in recipients)
        {
            db.Notifications.Add(new Notification { UserId = r.Id, Type = type, Title = title, Body = body, Link = link, CreatedAt = now });
            if ((mandatory || (email && setting?.SendEmail != false)) && MailAddress.TryCreate(r.Email, out _))
            {
                db.EmailMessages.Add(new EmailMessage
                {
                    To = r.Email,
                    Subject = $"Edwards: {title}",
                    Body = EmailTemplate.Render(r.FirstName, title, body, link, options.Value.AppBaseUrl),
                    Type = type,
                    CreatedAt = now,
                    NextAttemptAt = now,
                });
            }
        }
    }

    private static string Fit(string text, int max) => text.Length <= max ? text : text[..(max - 1)] + "…";
}

/// <summary>Finds who should hear about something, by relationship rather than by name.</summary>
public sealed class Recipients(AppDbContext db)
{
    public Task<List<int>> DealerPrincipalsAsync(int dealerId, CancellationToken ct = default) =>
        db.Users.Where(u => u.IsActive && u.UserType == UserType.Dealer && u.DealerId == dealerId).Select(u => u.Id).ToListAsync(ct);

    /// <summary>Users of a system role whose zones include the dealer's zone.</summary>
    public async Task<List<int>> RoleForDealerZoneAsync(string roleCode, int dealerId, CancellationToken ct = default)
    {
        var zoneId = await db.Dealers.Where(d => d.Id == dealerId).Select(d => d.ZoneId).FirstOrDefaultAsync(ct);
        return await db.Users
            .Where(u => u.IsActive && u.Role!.Code == roleCode && u.Zones.Any(z => z.ZoneId == zoneId))
            .Select(u => u.Id)
            .ToListAsync(ct);
    }

    /// <summary>Who looks after a customer: the dealer principals, the dealer engineer, and users of the given roles in the dealer's zone.</summary>
    public async Task<List<int?>> CustomerTeamAsync(int dealerId, int? dealerUserId, string[] zoneRoles, CancellationToken ct = default)
    {
        var team = (await DealerPrincipalsAsync(dealerId, ct)).Cast<int?>().Append(dealerUserId).ToList();
        foreach (var role in zoneRoles) team.AddRange((await RoleForDealerZoneAsync(role, dealerId, ct)).Cast<int?>());
        return team;
    }

    public Task<List<int>> RoleAsync(string roleCode, CancellationToken ct = default) =>
        db.Users.Where(u => u.IsActive && u.Role!.Code == roleCode).Select(u => u.Id).ToListAsync(ct);

    /// <summary>Users whose role holds the permission, optionally limited to those who can see the dealer's records.</summary>
    public async Task<List<int>> WithPermissionAsync(string permission, int? dealerId = null, CancellationToken ct = default)
    {
        var zoneId = dealerId is int d ? await db.Dealers.Where(x => x.Id == d).Select(x => (int?)x.ZoneId).FirstOrDefaultAsync(ct) : null;
        return await db.Users
            .Where(u => u.IsActive && u.Role!.IsActive && db.RolePermissions.Any(p => p.RoleId == u.RoleId && p.PermissionKey == permission))
            .Where(u => dealerId == null
                || u.Role!.DataScope == DataScope.All
                || (u.Role.DataScope == DataScope.Zone && u.Zones.Any(z => z.ZoneId == zoneId))
                || (u.Role.DataScope == DataScope.Dealer && u.DealerId == dealerId))
            .Select(u => u.Id)
            .ToListAsync(ct);
    }
}

public static class EmailTemplate
{
    public static string Render(string firstName, string title, string body, string? link, string baseUrl)
    {
        static string e(string? value) => WebUtility.HtmlEncode(value) ?? "";
        var paragraphs = string.Join("", body.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => $"<p style=\"margin:0 0 12px\">{e(line)}</p>"));
        var button = link is null ? "" :
            $"<p style=\"margin:20px 0 0\"><a href=\"{e(baseUrl.TrimEnd('/') + link)}\" style=\"background:#c4262e;color:#fff;padding:9px 20px;border-radius:20px;text-decoration:none;font-weight:600\">Open in Edwards</a></p>";
        return $"""
            <div style="font-family:'Source Sans Pro',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #ddd">
              <div style="background:#9b1525;background:radial-gradient(circle,#d22734 0%,#870a20 100%);color:#fff;padding:14px 20px;font-size:18px;font-weight:700">EDWARDS</div>
              <div style="padding:20px;color:#333;font-size:15px;line-height:1.5">
                <p style="margin:0 0 12px">Hello {e(firstName)},</p>
                <h2 style="margin:0 0 12px;font-size:18px;color:#2d363a">{e(title)}</h2>
                {paragraphs}
                {button}
              </div>
              <div style="padding:12px 20px;background:#f4f5f6;color:#6b7378;font-size:12px">This message was sent by the Edwards application. Alerts can be switched off by your administrator.</div>
            </div>
            """;
    }
}

/// <summary>Delivers the email outbox every 20 seconds. Each message is tried 3 times, 5 and 10 minutes apart.</summary>
public sealed class EmailDispatcher(IServiceScopeFactory scopes, IOptions<EmailOptions> options, ILogger<EmailDispatcher> log) : BackgroundService
{
    private const int MaxAttempts = 3;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SendPendingAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Email outbox run failed.");
            }
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
        }
    }

    public async Task SendPendingAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;
        var batch = await db.EmailMessages
            .Where(m => m.Status == EmailStatus.Pending && m.NextAttemptAt <= now)
            .OrderBy(m => m.Id)
            .Take(20)
            .ToListAsync(ct);
        if (batch.Count == 0) return;

        var o = options.Value;
        using var client = CreateClient(o);
        foreach (var message in batch)
        {
            message.Attempts++;
            try
            {
                using var mail = new MailMessage(new MailAddress(o.From, o.FromName), new MailAddress(message.To))
                {
                    Subject = message.Subject,
                    Body = message.Body,
                    IsBodyHtml = true,
                };
                await client.SendMailAsync(mail, ct);
                message.Status = EmailStatus.Sent;
                message.SentAt = DateTime.UtcNow;
                message.LastError = null;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                message.LastError = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
                message.Status = message.Attempts >= MaxAttempts ? EmailStatus.Failed : EmailStatus.Pending;
                message.NextAttemptAt = DateTime.UtcNow.AddMinutes(5 * message.Attempts);
                log.LogWarning("Email {Id} to {To} failed (attempt {Attempt}): {Error}", message.Id, message.To, message.Attempts, ex.Message);
            }
        }
        await db.SaveChangesAsync(ct);
    }

    private static SmtpClient CreateClient(EmailOptions o)
    {
        if (!string.Equals(o.Mode, "Smtp", StringComparison.OrdinalIgnoreCase))
        {
            var dir = Path.GetFullPath(o.PickupDirectory);
            Directory.CreateDirectory(dir);
            return new SmtpClient { DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory, PickupDirectoryLocation = dir };
        }
        return new SmtpClient(o.Host, o.Port)
        {
            EnableSsl = o.UseSsl,
            Credentials = string.IsNullOrEmpty(o.User) ? null : new NetworkCredential(o.User, o.Password),
        };
    }
}
