using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Alerts;

public sealed record AlertDefinition(AlertType Type, string Label, string When, string Recipients, bool Mandatory = false);

/// <summary>What each alert is for, shown on the alert settings screen.</summary>
public static class AlertCatalog
{
    public static readonly IReadOnlyList<AlertDefinition> All =
    [
        new(AlertType.Welcome, "Welcome", "A user account is created", "The new user, with a link to set a password", true),
        new(AlertType.PasswordReset, "Password reset", "A user asks for a reset link or an admin sends one", "The user", true),
        new(AlertType.Manual, "Manual alert", "Someone sends a message from Send alert", "The chosen users"),
        new(AlertType.LeadAssigned, "New lead", "A visit creates a lead, or a lead is assigned", "Sales in the dealer's zone; the assigned dealer"),
        new(AlertType.OpportunityAssigned, "Opportunity assigned", "An opportunity is assigned to a dealer to accept", "Dealer principal and dealer engineer"),
        new(AlertType.OpportunityStatus, "Opportunity status", "An opportunity is won, lost, postponed, dropped or reopened",
            "Sales in the zone, dealer principal, dealer engineer, owner"),
        new(AlertType.FollowUpOverdue, "Follow-up overdue", "Daily, when the next follow-up date of an open opportunity has passed",
            "Dealer engineer (or principal) and owner"),
        new(AlertType.QuotationSubmitted, "Quotation submitted", "A dealer submits a quotation", "Opportunity owner, or sales in the zone"),
        new(AlertType.QuotationDecided, "Quotation decided", "A quotation is accepted or rejected", "Dealer principal and dealer engineer"),
        new(AlertType.TransferRequested, "Transfer requested", "Someone asks to move a customer to another dealer", "Transfer approvers"),
        new(AlertType.TransferDecided, "Transfer decided", "A transfer is approved or rejected", "Requester; both dealers when approved"),
        new(AlertType.ServiceReminder, "Service due", "Daily, 30 days before an asset's next service date",
            "Dealer, dealer engineer, asset engineer, service coordinators"),
        new(AlertType.UpcomingService, "Service in 7 days", "Daily, 7 days before an open service reminder is due", "Asset engineer, dealer, dealer engineer"),
        new(AlertType.PostCommissioning, "Commissioning completed", "Commissioning is completed and warranty starts", "Dealer, sales in the zone"),
        new(AlertType.WarrantyExpiring, "Warranty ending", "Daily, 60 and 30 days before warranty ends, unless an AMC follows",
            "Dealer, dealer engineer, sales and service coordinators in the zone"),
        new(AlertType.AmcExpiring, "AMC ending", "Daily, 60 and 30 days before an AMC ends, unless it is renewed",
            "Dealer, dealer engineer, sales and service coordinators in the zone"),
        new(AlertType.JobAssigned, "Service job assigned", "A service engineer is assigned to a job", "The engineer"),
        new(AlertType.JobCompleted, "Service job completed", "A service job is completed", "Dealer, service coordinators in the zone"),
        new(AlertType.UploadResult, "Excel upload result", "An Excel upload finishes", "The person who uploaded"),
    ];

    public static AlertDefinition Of(AlertType type) => All.First(d => d.Type == type);
}

public sealed record NotificationItem(long Id, AlertType Type, string Title, string Body, string? Link, DateTime CreatedAt, DateTime? ReadAt);

public sealed record UnreadCount(int Count);

/// <summary>The signed-in user's own notifications (the bell in the header).</summary>
[Route("api/notifications")]
public sealed class NotificationsController(AppDbContext db, ICurrentUser currentUser) : ApiBase
{
    [HttpGet]
    public async Task<PagedResult<NotificationItem>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] bool unread = false,
        CancellationToken ct = default)
    {
        var userId = currentUser.UserId ?? 0;
        var query = db.Notifications.AsNoTracking().Where(n => n.UserId == userId);
        if (unread) query = query.Where(n => n.ReadAt == null);
        var total = await query.CountAsync(ct);
        page = PageOf(page);
        pageSize = SizeOf(pageSize);
        var items = await query.OrderByDescending(n => n.Id).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(n => new NotificationItem(n.Id, n.Type, n.Title, n.Body, n.Link, n.CreatedAt, n.ReadAt))
            .ToListAsync(ct);
        return new PagedResult<NotificationItem>(items, total, page, pageSize);
    }

    [HttpGet("unread-count")]
    public async Task<UnreadCount> Count(CancellationToken ct)
    {
        var userId = currentUser.UserId ?? 0;
        return new UnreadCount(await db.Notifications.CountAsync(n => n.UserId == userId && n.ReadAt == null, ct));
    }

    [HttpPost("{id:long}/read")]
    public async Task<IActionResult> Read(long id, CancellationToken ct)
    {
        var userId = currentUser.UserId ?? 0;
        await db.Notifications.Where(n => n.Id == id && n.UserId == userId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTime.UtcNow), ct);
        return NoContent();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> ReadAll(CancellationToken ct)
    {
        var userId = currentUser.UserId ?? 0;
        await db.Notifications.Where(n => n.UserId == userId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTime.UtcNow), ct);
        return NoContent();
    }
}

public sealed record AlertSettingItem(AlertType Type, string Label, string When, string Recipients, bool Mandatory, bool Enabled, bool SendEmail);

public sealed class AlertSettingInput
{
    public bool Enabled { get; set; }
    public bool SendEmail { get; set; }
}

public sealed class EmailQuery : ListQuery
{
    public EmailStatus? Status { get; set; }
    public AlertType? Type { get; set; }
}

public sealed record EmailItem(long Id, string To, string Subject, AlertType Type, EmailStatus Status, int Attempts, string? LastError,
    DateTime CreatedAt, DateTime? SentAt);

public sealed record EmailDetail(long Id, string To, string Subject, AlertType Type, EmailStatus Status, int Attempts, string? LastError,
    DateTime CreatedAt, DateTime? SentAt, string Body);

public sealed class SendAlertInput
{
    public List<int> UserIds { get; set; } = [];
    public List<int> RoleIds { get; set; } = [];
    public List<int> DealerIds { get; set; } = [];

    [Required, StringLength(150, MinimumLength = 3)]
    public string Title { get; set; } = "";

    [Required, StringLength(900, MinimumLength = 3)]
    public string Message { get; set; } = "";

    public bool SendEmail { get; set; } = true;
}

public sealed record SendAlertResult(int Recipients);

public sealed record RecipientOption(int Id, string Name, string Role, string? Dealer);

[Route("api/alerts")]
public sealed class AlertsController(AppDbContext db, ICurrentUser currentUser, AlertService alerts) : ApiBase
{
    [HttpGet("settings")]
    [HasPermission(Permissions.SettingsView)]
    public async Task<List<AlertSettingItem>> Settings(CancellationToken ct)
    {
        var stored = await db.AlertSettings.AsNoTracking().ToDictionaryAsync(s => s.Type, ct);
        return AlertCatalog.All.Select(d => stored.TryGetValue(d.Type, out var s)
                ? new AlertSettingItem(d.Type, d.Label, d.When, d.Recipients, d.Mandatory, s.Enabled || d.Mandatory, s.SendEmail || d.Mandatory)
                : new AlertSettingItem(d.Type, d.Label, d.When, d.Recipients, d.Mandatory, true, true))
            .ToList();
    }

    [HttpPut("settings/{type}")]
    [HasPermission(Permissions.SettingsEdit)]
    public async Task<ActionResult<AlertSettingItem>> UpdateSetting(AlertType type, AlertSettingInput input, CancellationToken ct)
    {
        var definition = AlertCatalog.All.FirstOrDefault(d => d.Type == type);
        if (definition is null) return NotFound();
        if (definition.Mandatory && (!input.Enabled || !input.SendEmail)) return StateConflict($"{definition.Label} messages are always sent.");

        var setting = await db.AlertSettings.FirstOrDefaultAsync(s => s.Type == type, ct);
        if (setting is null) db.AlertSettings.Add(setting = new AlertSetting { Type = type });
        setting.Enabled = input.Enabled;
        setting.SendEmail = input.Enabled && input.SendEmail;
        await db.SaveChangesAsync(ct);
        return new AlertSettingItem(type, definition.Label, definition.When, definition.Recipients, definition.Mandatory, setting.Enabled, setting.SendEmail);
    }

    [HttpGet("emails")]
    [HasPermission(Permissions.SettingsView)]
    public async Task<PagedResult<EmailItem>> Emails([FromQuery] EmailQuery q, CancellationToken ct)
    {
        var query = db.EmailMessages.AsNoTracking();
        if (Clean(q.Search) is string s) query = query.Where(m => m.To.Contains(s) || m.Subject.Contains(s));
        if (q.Status is EmailStatus status) query = query.Where(m => m.Status == status);
        if (q.Type is AlertType type) query = query.Where(m => m.Type == type);
        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await query.OrderByDescending(m => m.Id).Skip((page - 1) * size).Take(size)
            .Select(m => new EmailItem(m.Id, m.To, m.Subject, m.Type, m.Status, m.Attempts, m.LastError, m.CreatedAt, m.SentAt))
            .ToListAsync(ct);
        return new PagedResult<EmailItem>(items, total, page, size);
    }

    [HttpGet("emails/{id:long}")]
    [HasPermission(Permissions.SettingsView)]
    public async Task<ActionResult<EmailDetail>> Email(long id, CancellationToken ct)
    {
        var m = await db.EmailMessages.AsNoTracking().Where(x => x.Id == id)
            .Select(x => new EmailDetail(x.Id, x.To, x.Subject, x.Type, x.Status, x.Attempts, x.LastError, x.CreatedAt, x.SentAt, x.Body))
            .FirstOrDefaultAsync(ct);
        return m is null ? NotFound() : m;
    }

    [HttpPost("emails/{id:long}/retry")]
    [HasPermission(Permissions.SettingsEdit)]
    public async Task<IActionResult> Retry(long id, CancellationToken ct)
    {
        var m = await db.EmailMessages.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (m is null) return NotFound();
        if (m.Status != EmailStatus.Failed) return StateConflict("Only failed emails can be retried.");
        m.Status = EmailStatus.Pending;
        m.Attempts = 0;
        m.NextAttemptAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Runs the daily jobs now instead of waiting for the hourly run. Safe to repeat: each job skips what it already handled.</summary>
    [HttpPost("run-daily-jobs")]
    [HasPermission(Permissions.SettingsEdit)]
    public Task<DailyJobResult> RunDailyJobs([FromServices] DailyJobRunner runner, CancellationToken ct) =>
        runner.RunAsync(DateOnly.FromDateTime(DateTime.Today), ct);

    [HttpGet("recipients")]
    [HasPermission(Permissions.AlertsSend)]
    public async Task<List<RecipientOption>> RecipientOptions([FromQuery] string? search, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = Reachable(db.Users.AsNoTracking().Where(u => u.IsActive), user);
        if (Clean(search) is string s) query = query.Where(u => u.FirstName.Contains(s) || u.LastName.Contains(s) || u.LoginName.Contains(s));
        return await query.OrderBy(u => u.FirstName).ThenBy(u => u.LastName).Take(30)
            .Select(u => new RecipientOption(u.Id, (u.FirstName + " " + u.LastName).Trim(), u.Role!.Name, u.Dealer != null ? u.Dealer.Name : null))
            .ToListAsync(ct);
    }

    [HttpPost("send")]
    [HasPermission(Permissions.AlertsSend)]
    public async Task<ActionResult<SendAlertResult>> Send(SendAlertInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        if (input.UserIds.Count + input.RoleIds.Count + input.DealerIds.Count == 0)
            return Invalid("userIds", "Choose at least one user, role or dealer.");
        if (await db.AlertSettings.AnyAsync(s => s.Type == AlertType.Manual && !s.Enabled, ct))
            return StateConflict("Manual alerts are switched off in the alert settings.");

        var ids = await Reachable(db.Users.AsNoTracking().Where(u => u.IsActive && u.Id != user.UserId
                && (input.UserIds.Contains(u.Id) || input.RoleIds.Contains(u.RoleId) || (u.DealerId != null && input.DealerIds.Contains(u.DealerId.Value)))), user)
            .Select(u => (int?)u.Id)
            .ToListAsync(ct);
        if (ids.Count == 0) return Invalid("userIds", "None of the chosen recipients are active users you can reach.");

        await alerts.RaiseAsync(AlertType.Manual, ids, input.Title.Trim(), $"{input.Message.Trim()}\n— {user.DisplayName}", null, input.SendEmail, ct);
        await db.SaveChangesAsync(ct);
        return new SendAlertResult(ids.Count);
    }

    /// <summary>Edwards staff can be reached by anyone who may send alerts; dealer users only by senders who can see their dealer.</summary>
    private static IQueryable<User> Reachable(IQueryable<User> users, UserContext sender) => sender.Scope switch
    {
        DataScope.All => users,
        DataScope.Zone => users.Where(u => u.UserType == UserType.Edwards || (u.DealerId != null && sender.ZoneIds.Contains(u.Dealer!.ZoneId))),
        _ => users.Where(u => u.UserType == UserType.Edwards || (sender.DealerId != null && u.DealerId == sender.DealerId)),
    };
}
