using Edwards.Api.Domain;

namespace Edwards.Api.Auth;

public sealed record PermissionDefinition(string Key, string Module, string ModuleLabel, string Action, string Label, int SortOrder);

/// <summary>
/// Every permission the API checks. The list is synced into the Permissions table at startup,
/// so a new module only needs new entries here; admins then grant them to roles from the matrix screen.
/// </summary>
public static class Permissions
{
    public const string DashboardView = "dashboard.view";
    public const string CustomersView = "customers.view";
    public const string CustomersCreate = "customers.create";
    public const string CustomersEdit = "customers.edit";
    public const string CustomersDeactivate = "customers.deactivate";
    public const string TransfersView = "transfers.view";
    public const string TransfersRequest = "transfers.request";
    public const string TransfersApprove = "transfers.approve";
    public const string VisitsView = "visits.view";
    public const string VisitsCreate = "visits.create";
    public const string VisitsEdit = "visits.edit";
    public const string LeadsView = "leads.view";
    public const string LeadsCreate = "leads.create";
    public const string LeadsEdit = "leads.edit";
    public const string OpportunitiesView = "opportunities.view";
    public const string OpportunitiesCreate = "opportunities.create";
    public const string OpportunitiesEdit = "opportunities.edit";
    public const string OpportunitiesAssign = "opportunities.assign";
    public const string OpportunitiesReopen = "opportunities.reopen";
    public const string QuotationsView = "quotations.view";
    public const string QuotationsEdit = "quotations.edit";
    public const string QuotationsApprove = "quotations.approve";
    public const string TargetsView = "targets.view";
    public const string TargetsEdit = "targets.edit";
    public const string AssetsView = "assets.view";
    public const string AssetsCreate = "assets.create";
    public const string AssetsEdit = "assets.edit";
    public const string CommissioningView = "commissioning.view";
    public const string CommissioningEdit = "commissioning.edit";
    public const string AmcView = "amc.view";
    public const string AmcEdit = "amc.edit";
    public const string JobsView = "jobs.view";
    public const string JobsCreate = "jobs.create";
    public const string JobsEdit = "jobs.edit";
    public const string JobsAssign = "jobs.assign";
    public const string RemindersView = "reminders.view";
    public const string RemindersEdit = "reminders.edit";
    public const string DocumentsView = "documents.view";
    public const string DocumentsUpload = "documents.upload";
    public const string DocumentsDownload = "documents.download";
    public const string ReportsView = "reports.view";
    public const string ReportsExport = "reports.export";
    public const string AlertsSend = "alerts.send";
    public const string UploadsRun = "uploads.run";
    public const string UsersView = "users.view";
    public const string UsersEdit = "users.edit";
    public const string DealersView = "dealers.view";
    public const string DealersEdit = "dealers.edit";
    public const string MastersView = "masters.view";
    public const string MastersEdit = "masters.edit";
    public const string RolesView = "roles.view";
    public const string RolesEdit = "roles.edit";
    public const string SettingsView = "settings.view";
    public const string SettingsEdit = "settings.edit";

    public static readonly IReadOnlyList<PermissionDefinition> All = Build(
    [
        ("dashboard", "Dashboard", [(DashboardView, "view", "See the dashboard")]),
        ("customers", "Customers and contacts",
        [
            (CustomersView, "view", "See customers and their contacts"),
            (CustomersCreate, "create", "Add customers"),
            (CustomersEdit, "edit", "Edit customers and their contacts"),
            (CustomersDeactivate, "deactivate", "Deactivate and reactivate customers"),
        ]),
        ("transfers", "Customer transfers",
        [
            (TransfersView, "view", "See customer transfers"),
            (TransfersRequest, "request", "Request a transfer to another dealer"),
            (TransfersApprove, "approve", "Approve or reject transfers"),
        ]),
        ("visits", "Visits",
        [
            (VisitsView, "view", "See visits"),
            (VisitsCreate, "create", "Record visits"),
            (VisitsEdit, "edit", "Edit visits"),
        ]),
        ("leads", "Leads",
        [
            (LeadsView, "view", "See leads"),
            (LeadsCreate, "create", "Add leads by hand"),
            (LeadsEdit, "edit", "Qualify, disqualify, assign and convert leads"),
        ]),
        ("opportunities", "Opportunities",
        [
            (OpportunitiesView, "view", "See opportunities"),
            (OpportunitiesCreate, "create", "Add opportunities"),
            (OpportunitiesEdit, "edit", "Update opportunities, log follow-ups, change status"),
            (OpportunitiesAssign, "assign", "Assign opportunities to dealers"),
            (OpportunitiesReopen, "reopen", "Reopen won, lost or dropped opportunities"),
        ]),
        ("quotations", "Quotations",
        [
            (QuotationsView, "view", "See quotations"),
            (QuotationsEdit, "edit", "Prepare, revise and submit quotations"),
            (QuotationsApprove, "approve", "Accept or reject submitted quotations"),
        ]),
        ("targets", "Dealer targets",
        [
            (TargetsView, "view", "See targets and achievement"),
            (TargetsEdit, "edit", "Set dealer targets"),
        ]),
        ("assets", "Assets",
        [
            (AssetsView, "view", "See assets and their history"),
            (AssetsCreate, "create", "Add assets"),
            (AssetsEdit, "edit", "Edit assets"),
        ]),
        ("commissioning", "Commissioning",
        [
            (CommissioningView, "view", "See commissioning"),
            (CommissioningEdit, "edit", "Plan and record commissioning"),
        ]),
        ("amc", "Warranty and AMC",
        [
            (AmcView, "view", "See warranty and AMC"),
            (AmcEdit, "edit", "Add and edit AMC contracts"),
        ]),
        ("jobs", "Service jobs and visits",
        [
            (JobsView, "view", "See service jobs and visits"),
            (JobsCreate, "create", "Raise service jobs"),
            (JobsEdit, "edit", "Update jobs, record visits and completion"),
            (JobsAssign, "assign", "Assign service engineers"),
        ]),
        ("reminders", "Service reminders",
        [
            (RemindersView, "view", "See service reminders"),
            (RemindersEdit, "edit", "Follow up, dismiss and convert reminders"),
        ]),
        ("documents", "Documents",
        [
            (DocumentsView, "view", "View documents in the secure viewer"),
            (DocumentsUpload, "upload", "Upload documents"),
            (DocumentsDownload, "download", "Download original files"),
        ]),
        ("reports", "Reports",
        [
            (ReportsView, "view", "See reports"),
            (ReportsExport, "export", "Export reports to Excel"),
        ]),
        ("alerts", "Manual alerts", [(AlertsSend, "send", "Send alerts to users")]),
        ("uploads", "Excel upload", [(UploadsRun, "upload", "Upload data from Excel")]),
        ("users", "Users",
        [
            (UsersView, "view", "See users"),
            (UsersEdit, "edit", "Add users, change roles and reset passwords"),
        ]),
        ("dealers", "Dealers",
        [
            (DealersView, "view", "See dealers"),
            (DealersEdit, "edit", "Add and edit dealers"),
        ]),
        ("masters", "Masters",
        [
            (MastersView, "view", "See master lists"),
            (MastersEdit, "edit", "Add and edit master list values"),
        ]),
        ("roles", "Roles and permissions",
        [
            (RolesView, "view", "See roles and their permissions"),
            (RolesEdit, "edit", "Add roles and change permissions"),
        ]),
        ("settings", "Alert settings and email log",
        [
            (SettingsView, "view", "See alert settings and sent emails"),
            (SettingsEdit, "edit", "Switch alerts on or off"),
        ]),
    ]);

    public static bool Exists(string key) => All.Any(p => p.Key == key);

    private static List<PermissionDefinition> Build((string Module, string Label, (string Key, string Action, string Label)[] Actions)[] modules)
    {
        var list = new List<PermissionDefinition>();
        var order = 0;
        foreach (var (module, moduleLabel, actions) in modules)
        {
            order += 10;
            for (var i = 0; i < actions.Length; i++)
                list.Add(new PermissionDefinition(actions[i].Key, module, moduleLabel, actions[i].Action, actions[i].Label, order + i));
        }
        return list;
    }
}

public sealed record RoleDefault(string Code, string Name, string Description, DataScope Scope, string[] Permissions);

/// <summary>Roles created on first start, matching the proposed access matrix. Admins can change them afterwards.</summary>
public static class RoleDefaults
{
    public const string Admin = "admin";
    public const string Sales = "sales";
    public const string Dealer = "dealer";
    public const string DealerUser = "dealer-user";
    public const string ServiceCoordinator = "service-coordinator";
    public const string ServiceEngineer = "service-engineer";

    private static readonly string[] SalesWork =
    [
        Permissions.DashboardView,
        Permissions.CustomersView, Permissions.CustomersCreate, Permissions.CustomersEdit, Permissions.CustomersDeactivate,
        Permissions.TransfersView, Permissions.TransfersRequest,
        Permissions.VisitsView, Permissions.LeadsView, Permissions.LeadsCreate, Permissions.LeadsEdit,
        Permissions.OpportunitiesView, Permissions.OpportunitiesCreate, Permissions.OpportunitiesEdit, Permissions.OpportunitiesAssign,
        Permissions.QuotationsView, Permissions.QuotationsApprove, Permissions.TargetsView,
        Permissions.AssetsView, Permissions.CommissioningView, Permissions.AmcView, Permissions.JobsView, Permissions.RemindersView,
        Permissions.DocumentsView, Permissions.DocumentsUpload, Permissions.ReportsView, Permissions.ReportsExport, Permissions.AlertsSend,
    ];

    private static readonly string[] DealerWork =
    [
        Permissions.DashboardView,
        Permissions.CustomersView, Permissions.CustomersCreate, Permissions.CustomersEdit, Permissions.TransfersView,
        Permissions.VisitsView, Permissions.VisitsCreate, Permissions.VisitsEdit,
        Permissions.LeadsView, Permissions.LeadsCreate, Permissions.LeadsEdit,
        Permissions.OpportunitiesView, Permissions.OpportunitiesCreate, Permissions.OpportunitiesEdit,
        Permissions.QuotationsView, Permissions.QuotationsEdit, Permissions.TargetsView,
        Permissions.AssetsView, Permissions.AssetsCreate, Permissions.AssetsEdit, Permissions.CommissioningView, Permissions.AmcView,
        Permissions.JobsView, Permissions.JobsCreate, Permissions.JobsEdit, Permissions.RemindersView, Permissions.RemindersEdit,
        Permissions.DocumentsView, Permissions.DocumentsUpload, Permissions.ReportsView,
    ];

    private static readonly string[] DealerUserWork =
    [
        Permissions.DashboardView,
        Permissions.CustomersView, Permissions.CustomersCreate, Permissions.CustomersEdit,
        Permissions.VisitsView, Permissions.VisitsCreate, Permissions.VisitsEdit,
        Permissions.LeadsView, Permissions.LeadsCreate, Permissions.LeadsEdit,
        Permissions.OpportunitiesView, Permissions.OpportunitiesEdit, Permissions.QuotationsView, Permissions.QuotationsEdit,
        Permissions.AssetsView, Permissions.JobsView, Permissions.JobsEdit, Permissions.RemindersView, Permissions.RemindersEdit,
        Permissions.DocumentsView, Permissions.DocumentsUpload, Permissions.ReportsView,
    ];

    private static readonly string[] ServiceCoordinatorWork =
    [
        Permissions.DashboardView, Permissions.CustomersView,
        Permissions.OpportunitiesView, Permissions.OpportunitiesCreate, Permissions.OpportunitiesEdit, Permissions.QuotationsView,
        Permissions.AssetsView, Permissions.AssetsCreate, Permissions.AssetsEdit,
        Permissions.CommissioningView, Permissions.CommissioningEdit, Permissions.AmcView, Permissions.AmcEdit,
        Permissions.JobsView, Permissions.JobsCreate, Permissions.JobsEdit, Permissions.JobsAssign,
        Permissions.RemindersView, Permissions.RemindersEdit,
        Permissions.DocumentsView, Permissions.DocumentsUpload, Permissions.ReportsView, Permissions.ReportsExport, Permissions.AlertsSend,
    ];

    private static readonly string[] ServiceEngineerWork =
    [
        Permissions.DashboardView, Permissions.CustomersView, Permissions.AssetsView,
        Permissions.CommissioningView, Permissions.CommissioningEdit, Permissions.JobsView, Permissions.JobsEdit,
        Permissions.DocumentsView, Permissions.DocumentsUpload,
    ];

    public static readonly IReadOnlyList<RoleDefault> All =
    [
        new(Admin, "Business / Admin", "Edwards administrators. Full access to every module.", DataScope.All,
            Permissions.All.Select(p => p.Key).ToArray()),
        new(Sales, "Sales", "Edwards sales staff. Work with customers in their zones.", DataScope.Zone, SalesWork),
        new(Dealer, "Dealer", "Dealer principal. Works with the dealer's own customers.", DataScope.Dealer, DealerWork),
        new(DealerUser, "Dealer user", "Dealer engineer. Works with the customers assigned to them.", DataScope.Own, DealerUserWork),
        new(ServiceCoordinator, "Service coordinator", "Plans service work for customers in their zones.", DataScope.Zone, ServiceCoordinatorWork),
        new(ServiceEngineer, "Service engineer", "Carries out service jobs assigned to them.", DataScope.Own, ServiceEngineerWork),
    ];
}
