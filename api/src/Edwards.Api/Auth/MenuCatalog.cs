namespace Edwards.Api.Auth;

public sealed record MenuItem(string Label, string Icon, string? Route, string? Permission, IReadOnlyList<MenuItem>? Children = null);

/// <summary>
/// The sidebar. The API sends each user only the items their permissions allow,
/// so the screens never hard-code role or login names.
/// </summary>
public static class MenuCatalog
{
    private static readonly IReadOnlyList<MenuItem> All =
    [
        new("Dashboard", "fa-solid fa-gauge-high", "/dashboard", Permissions.DashboardView),
        new("Customers", "fa-solid fa-building", "/customers", Permissions.CustomersView),
        new("Sales", "fa-solid fa-handshake", null, null,
        [
            new("Visits", "fa-solid fa-person-walking", "/visits", Permissions.VisitsView),
            new("Leads", "fa-solid fa-bullseye", "/leads", Permissions.LeadsView),
            new("Opportunities", "fa-solid fa-chart-line", "/opportunities", Permissions.OpportunitiesView),
            new("Customer transfers", "fa-solid fa-right-left", "/transfers", Permissions.TransfersView),
            new("Dealer targets", "fa-solid fa-flag-checkered", "/targets", Permissions.TargetsView),
        ]),
        new("Service", "fa-solid fa-screwdriver-wrench", null, null,
        [
            new("Assets", "fa-solid fa-gears", "/assets", Permissions.AssetsView),
            new("Commissioning", "fa-solid fa-plug-circle-check", "/commissioning", Permissions.CommissioningView),
            new("Warranty and AMC", "fa-solid fa-shield-halved", "/amc", Permissions.AmcView),
            new("Service jobs", "fa-solid fa-toolbox", "/jobs", Permissions.JobsView),
            new("Service reminders", "fa-solid fa-bell-concierge", "/reminders", Permissions.RemindersView),
        ]),
        new("Reports", "fa-solid fa-table-list", "/reports", Permissions.ReportsView),
        new("Send alert", "fa-solid fa-bullhorn", "/alerts/send", Permissions.AlertsSend),
        new("Administration", "fa-solid fa-gear", null, null,
        [
            new("Users", "fa-solid fa-users", "/admin/users", Permissions.UsersView),
            new("Dealers", "fa-solid fa-store", "/admin/dealers", Permissions.DealersView),
            new("Masters", "fa-solid fa-list-ul", "/admin/masters", Permissions.MastersView),
            new("Roles and permissions", "fa-solid fa-user-shield", "/admin/roles", Permissions.RolesView),
            new("Excel upload", "fa-solid fa-file-excel", "/admin/upload", Permissions.UploadsRun),
            new("Alerts and email", "fa-solid fa-envelope-open-text", "/admin/alerts", Permissions.SettingsView),
        ]),
    ];

    public static IReadOnlyList<MenuItem> For(UserContext user)
    {
        if (user.MustChangePassword) return [];
        return Filter(All, user);
    }

    private static List<MenuItem> Filter(IReadOnlyList<MenuItem> items, UserContext user)
    {
        var visible = new List<MenuItem>();
        foreach (var item in items)
        {
            if (item.Children is { Count: > 0 })
            {
                var children = Filter(item.Children, user);
                if (children.Count > 0) visible.Add(item with { Children = children, Permission = null });
            }
            else if (item.Permission is null || user.Has(item.Permission))
            {
                visible.Add(item with { Permission = null });
            }
        }
        return visible;
    }
}
