using ClosedXML.Excel;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Service;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Reports;

public enum ColumnType { Text, Number, Money, Date, Percent }

public sealed record ReportColumn(string Label, ColumnType Type);

public sealed record ReportDefinition(string Key, string Title, string Group, string Description, string[] Filters);

public sealed record ReportTable(string Key, string Title, string Subtitle, List<ReportColumn> Columns, List<object?[]> Rows, object?[]? Totals);

public sealed class ReportFilter
{
    public DateOnly? From { get; set; }
    public DateOnly? To { get; set; }
    public int? FiscalYear { get; set; }
    public int? DealerId { get; set; }
    public string? Stage { get; set; }
}

/// <summary>Read-only reports over the user's data scope, shown as tables and exported to Excel with the same rows.</summary>
[Route("api/reports")]
public sealed class ReportsController(AppDbContext db, ICurrentUser currentUser) : ApiBase
{
    public static readonly IReadOnlyList<ReportDefinition> Catalog =
    [
        new("pipeline", "Pipeline by dealer", "Sales", "Open pipeline, wins and losses per dealer for a fiscal year.", ["fiscalYear", "dealer"]),
        new("targets", "Target vs achievement", "Sales", "Dealer value targets against won opportunities.", ["fiscalYear", "dealer"]),
        new("opportunities", "Opportunity list", "Sales", "Every opportunity with its status, value and owner.", ["dateRange", "dealer", "stage"]),
        new("win-loss", "Win and loss reasons", "Sales", "Why opportunities closed, with count and value.", ["dateRange", "dealer"]),
        new("visits", "Visits by engineer", "Sales", "Visits, customers covered and leads raised per dealer engineer.", ["dateRange", "dealer"]),
        new("leads", "Lead conversion", "Sales", "Leads per dealer by status, with the conversion rate.", ["dateRange", "dealer"]),
        new("customers", "Customers by segment", "Sales", "Customers, contacts and open opportunities per dealer and segment.", ["dealer"]),
        new("service-jobs", "Service jobs", "Service", "Jobs raised in the period with status, engineer and turnaround.", ["dateRange", "dealer"]),
        new("coverage", "Warranty and AMC coverage", "Service", "Every asset with its warranty, AMC and next service date.", ["dealer"]),
    ];

    [HttpGet]
    [HasPermission(Permissions.ReportsView)]
    public IReadOnlyList<ReportDefinition> List() => Catalog;

    [HttpGet("{key}")]
    [HasPermission(Permissions.ReportsView)]
    public async Task<ActionResult<ReportTable>> Run(string key, [FromQuery] ReportFilter filter, CancellationToken ct)
    {
        var table = await BuildAsync(key, filter, ct);
        return table is null ? NotFound() : table;
    }

    [HttpGet("{key}/export")]
    [HasPermission(Permissions.ReportsExport)]
    public async Task<IActionResult> Export(string key, [FromQuery] ReportFilter filter, CancellationToken ct)
    {
        var table = await BuildAsync(key, filter, ct);
        if (table is null) return NotFound();

        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet(table.Title.Length > 31 ? table.Title[..31] : table.Title);
        ws.Cell(1, 1).Value = table.Title;
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(2, 1).Value = table.Subtitle;
        for (var c = 0; c < table.Columns.Count; c++)
        {
            var cell = ws.Cell(4, c + 1);
            cell.Value = table.Columns[c].Label;
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#C4262E");
        }
        var r = 5;
        foreach (var row in table.Rows.Append(table.Totals).Where(x => x is not null))
        {
            for (var c = 0; c < table.Columns.Count; c++) Write(ws.Cell(r, c + 1), row![c], table.Columns[c].Type);
            if (ReferenceEquals(row, table.Totals)) ws.Row(r).Style.Font.Bold = true;
            r++;
        }
        ws.Columns(1, table.Columns.Count).AdjustToContents(4, r);
        ws.SheetView.FreezeRows(4);

        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"edwards-{key}-{DateTime.Today:yyyy-MM-dd}.xlsx");
    }

    private static void Write(IXLCell cell, object? value, ColumnType type)
    {
        switch (value)
        {
            case null:
                return;
            case DateOnly d:
                cell.Value = d.ToDateTime(TimeOnly.MinValue);
                cell.Style.DateFormat.Format = "dd-mmm-yyyy";
                return;
            case DateTime dt:
                cell.Value = dt;
                cell.Style.DateFormat.Format = "dd-mmm-yyyy";
                return;
            case decimal or double or int or long:
                cell.Value = Convert.ToDouble(value);
                cell.Style.NumberFormat.Format = type switch { ColumnType.Money => "#,##0", ColumnType.Percent => "0.0%", _ => "#,##0" };
                return;
            default:
                cell.Value = value.ToString();
                return;
        }
    }

    private async Task<ReportTable?> BuildAsync(string key, ReportFilter f, CancellationToken ct)
    {
        var definition = Catalog.FirstOrDefault(d => d.Key == key);
        if (definition is null) return null;
        var user = await currentUser.RequireAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var fy = f.FiscalYear ?? FiscalYear.Current;
        var (fyStart, fyEnd) = FiscalYear.Range(fy);
        var from = f.From ?? FiscalYear.Range(FiscalYear.Current).Start;
        var to = f.To ?? today;
        var period = $"{from:dd MMM yyyy} to {to:dd MMM yyyy}";

        ReportTable Table(string subtitle, (string Label, ColumnType Type)[] columns, List<object?[]> rows, object?[]? totals = null) =>
            new(key, definition.Title, subtitle, columns.Select(c => new ReportColumn(c.Label, c.Type)).ToList(), rows, totals);

        switch (key)
        {
            case "pipeline":
            {
                var opps = Dealer(db.Opportunities.AsNoTracking().InScope(user).Where(o => o.IsActive), f.DealerId);
                var rows = await opps.GroupBy(o => new { o.DealerId, Dealer = o.Dealer!.Name, Zone = o.Dealer.Zone!.Name })
                    .Select(g => new
                    {
                        g.Key.Dealer,
                        g.Key.Zone,
                        Open = g.Count(o => o.Stage == OpportunityStage.Open || o.Stage == OpportunityStage.Postponed),
                        OpenValue = g.Where(o => o.Stage == OpportunityStage.Open || o.Stage == OpportunityStage.Postponed).Sum(o => o.Value),
                        Won = g.Count(o => o.Stage == OpportunityStage.Won && o.ClosedDate >= fyStart && o.ClosedDate <= fyEnd),
                        WonValue = g.Where(o => o.Stage == OpportunityStage.Won && o.ClosedDate >= fyStart && o.ClosedDate <= fyEnd).Sum(o => o.Value),
                        Lost = g.Count(o => (o.Stage == OpportunityStage.Lost || o.Stage == OpportunityStage.Dropped)
                            && o.ClosedDate >= fyStart && o.ClosedDate <= fyEnd),
                    })
                    .OrderByDescending(x => x.OpenValue)
                    .ToListAsync(ct);
                return Table(FiscalYear.Label(fy),
                    [("Dealer", ColumnType.Text), ("Zone", ColumnType.Text), ("Open", ColumnType.Number), ("Open value", ColumnType.Money),
                        ("Won", ColumnType.Number), ("Won value", ColumnType.Money), ("Lost or dropped", ColumnType.Number), ("Win rate", ColumnType.Percent)],
                    rows.Select(x => new object?[] { x.Dealer, x.Zone, x.Open, x.OpenValue, x.Won, x.WonValue, x.Lost, Rate(x.Won, x.Won + x.Lost) }).ToList(),
                    ["Total", null, rows.Sum(x => x.Open), rows.Sum(x => x.OpenValue), rows.Sum(x => x.Won), rows.Sum(x => x.WonValue),
                        rows.Sum(x => x.Lost), Rate(rows.Sum(x => x.Won), rows.Sum(x => x.Won + x.Lost))]);
            }
            case "targets":
            {
                var dealers = await Dealer(db.Dealers.AsNoTracking().InScope(user).Where(d => d.IsActive), f.DealerId)
                    .Select(d => new
                    {
                        d.Name,
                        Zone = d.Zone!.Name,
                        Target = db.DealerTargets.Where(t => t.DealerId == d.Id && t.FiscalYear == fy).Sum(t => (decimal?)t.TargetValue) ?? 0,
                        Won = db.Opportunities.Count(o => o.DealerId == d.Id && o.Stage == OpportunityStage.Won && o.ClosedDate >= fyStart && o.ClosedDate <= fyEnd),
                        Achieved = db.Opportunities.Where(o => o.DealerId == d.Id && o.Stage == OpportunityStage.Won && o.ClosedDate >= fyStart
                            && o.ClosedDate <= fyEnd).Sum(o => (decimal?)o.Value) ?? 0,
                    })
                    .OrderBy(x => x.Name)
                    .ToListAsync(ct);
                return Table(FiscalYear.Label(fy),
                    [("Dealer", ColumnType.Text), ("Zone", ColumnType.Text), ("Target", ColumnType.Money), ("Achieved", ColumnType.Money),
                        ("Achievement", ColumnType.Percent), ("Won opportunities", ColumnType.Number)],
                    dealers.Select(x => new object?[] { x.Name, x.Zone, x.Target, x.Achieved, x.Target == 0 ? null : x.Achieved / x.Target, x.Won }).ToList(),
                    ["Total", null, dealers.Sum(x => x.Target), dealers.Sum(x => x.Achieved),
                        dealers.Sum(x => x.Target) == 0 ? null : dealers.Sum(x => x.Achieved) / dealers.Sum(x => x.Target), dealers.Sum(x => x.Won)]);
            }
            case "opportunities":
            {
                var opps = Dealer(db.Opportunities.AsNoTracking().InScope(user).Where(o => o.IsActive), f.DealerId)
                    .Where(o => o.CreatedAt >= from.ToDateTime(TimeOnly.MinValue) && o.CreatedAt < to.AddDays(1).ToDateTime(TimeOnly.MinValue)
                        || (o.ClosedDate >= from && o.ClosedDate <= to));
                if (f.Stage == "open") opps = opps.Where(o => o.Stage == OpportunityStage.Open || o.Stage == OpportunityStage.Postponed);
                else if (Enum.TryParse<OpportunityStage>(f.Stage, true, out var stage)) opps = opps.Where(o => o.Stage == stage);
                var list = await opps.OrderByDescending(o => o.Id).Take(5000)
                    .Select(o => new
                    {
                        o.Name, Customer = o.Customer!.Name, Dealer = o.Dealer!.Name, o.Type, o.Stage, o.Value, o.ExpectedCloseDate,
                        Phase = o.SalesPhase != null ? o.SalesPhase.Name : null, Chance = o.WinningChance != null ? (int?)o.WinningChance.Percentage : null,
                        Owner = o.Owner != null ? (o.Owner.FirstName + " " + o.Owner.LastName).Trim() : null,
                        Engineer = o.DealerUser != null ? (o.DealerUser.FirstName + " " + o.DealerUser.LastName).Trim() : null,
                        o.CreatedAt, o.ClosedDate,
                    })
                    .ToListAsync(ct);
                var rows = list.Select(o => new object?[]
                {
                    o.Name, o.Customer, o.Dealer, o.Type.ToString(), o.Stage.ToString(), o.Value, o.ExpectedCloseDate, o.Phase, o.Chance, o.Owner,
                    o.Engineer, DateOnly.FromDateTime(o.CreatedAt), o.ClosedDate,
                }).ToList();
                return Table($"Created or closed {period}",
                    [("Opportunity", ColumnType.Text), ("Customer", ColumnType.Text), ("Dealer", ColumnType.Text), ("Type", ColumnType.Text),
                        ("Status", ColumnType.Text), ("Value", ColumnType.Money), ("Expected close", ColumnType.Date), ("Sales phase", ColumnType.Text),
                        ("Chance %", ColumnType.Number), ("Owner", ColumnType.Text), ("Dealer engineer", ColumnType.Text), ("Created", ColumnType.Date),
                        ("Closed", ColumnType.Date)],
                    rows, ["Total", $"{rows.Count} opportunities", null, null, null, rows.Sum(x => (decimal)x[5]!), null, null, null, null, null, null, null]);
            }
            case "win-loss":
            {
                var closed = Dealer(db.Opportunities.AsNoTracking().InScope(user), f.DealerId)
                    .Where(o => o.ClosedDate >= from && o.ClosedDate <= to
                        && (o.Stage == OpportunityStage.Won || o.Stage == OpportunityStage.Lost || o.Stage == OpportunityStage.Dropped));
                var rows = await closed
                    .GroupBy(o => new
                    {
                        o.Stage,
                        Reason = o.Stage == OpportunityStage.Won ? (o.WinningReason != null ? o.WinningReason.Name : "Not given")
                            : o.Stage == OpportunityStage.Lost ? (o.LosingReason != null ? o.LosingReason.Name : "Not given") : "Project dropped",
                    })
                    .Select(g => new { g.Key.Stage, g.Key.Reason, Count = g.Count(), Value = g.Sum(o => o.Value) })
                    .ToListAsync(ct);
                rows = rows.OrderBy(x => x.Stage).ThenByDescending(x => x.Count).ToList();
                return Table($"Closed {period}",
                    [("Outcome", ColumnType.Text), ("Reason", ColumnType.Text), ("Opportunities", ColumnType.Number), ("Value", ColumnType.Money)],
                    rows.Select(x => new object?[] { x.Stage.ToString(), x.Reason, x.Count, x.Value }).ToList(),
                    ["Total", null, rows.Sum(x => x.Count), rows.Sum(x => x.Value)]);
            }
            case "visits":
            {
                var visits = Dealer(db.Visits.AsNoTracking().InScope(user), f.DealerId).Where(v => v.VisitDate >= from && v.VisitDate <= to);
                var rows = await visits
                    .GroupBy(v => new
                    {
                        Dealer = v.Dealer!.Name,
                        Engineer = v.DealerUser != null ? (v.DealerUser.FirstName + " " + v.DealerUser.LastName).Trim() : "Unknown",
                    })
                    .Select(g => new
                    {
                        g.Key.Dealer,
                        g.Key.Engineer,
                        Visits = g.Count(),
                        Customers = g.Select(v => v.CustomerId).Distinct().Count(),
                        WithPotential = g.Count(v => v.HasPotential),
                        Leads = g.Count(v => v.LeadId != null),
                        Last = g.Max(v => v.VisitDate),
                    })
                    .ToListAsync(ct);
                rows = rows.OrderBy(x => x.Dealer).ThenByDescending(x => x.Visits).ToList();
                return Table(period,
                    [("Dealer", ColumnType.Text), ("Engineer", ColumnType.Text), ("Visits", ColumnType.Number), ("Customers visited", ColumnType.Number),
                        ("With potential", ColumnType.Number), ("Leads", ColumnType.Number), ("Last visit", ColumnType.Date)],
                    rows.Select(x => new object?[] { x.Dealer, x.Engineer, x.Visits, x.Customers, x.WithPotential, x.Leads, x.Last }).ToList(),
                    ["Total", null, rows.Sum(x => x.Visits), null, rows.Sum(x => x.WithPotential), rows.Sum(x => x.Leads), null]);
            }
            case "leads":
            {
                var leads = db.Leads.AsNoTracking().InScope(user)
                    .Where(l => l.CreatedAt >= from.ToDateTime(TimeOnly.MinValue) && l.CreatedAt < to.AddDays(1).ToDateTime(TimeOnly.MinValue));
                if (f.DealerId is int dealerId) leads = leads.Where(l => (l.DealerId ?? l.Customer!.DealerId) == dealerId);
                var rows = await leads
                    .GroupBy(l => l.Dealer != null ? l.Dealer.Name : l.Customer!.Dealer!.Name)
                    .Select(g => new
                    {
                        Dealer = g.Key,
                        Total = g.Count(),
                        New = g.Count(l => l.Status == LeadStatus.New),
                        Qualified = g.Count(l => l.Status == LeadStatus.Qualified),
                        Converted = g.Count(l => l.Status == LeadStatus.Converted),
                        Disqualified = g.Count(l => l.Status == LeadStatus.Disqualified),
                    })
                    .ToListAsync(ct);
                rows = rows.OrderByDescending(x => x.Total).ToList();
                return Table($"Leads created {period}",
                    [("Dealer", ColumnType.Text), ("Leads", ColumnType.Number), ("New", ColumnType.Number), ("Qualified", ColumnType.Number),
                        ("Converted", ColumnType.Number), ("Disqualified", ColumnType.Number), ("Conversion", ColumnType.Percent)],
                    rows.Select(x => new object?[] { x.Dealer, x.Total, x.New, x.Qualified, x.Converted, x.Disqualified, Rate(x.Converted, x.Total) }).ToList(),
                    ["Total", rows.Sum(x => x.Total), rows.Sum(x => x.New), rows.Sum(x => x.Qualified), rows.Sum(x => x.Converted),
                        rows.Sum(x => x.Disqualified), Rate(rows.Sum(x => x.Converted), rows.Sum(x => x.Total))]);
            }
            case "customers":
            {
                var customers = db.Customers.AsNoTracking().InScope(user).Where(c => c.IsActive);
                if (f.DealerId is int dealerId) customers = customers.Where(c => c.DealerId == dealerId);
                var perCustomer = await customers
                    .Select(c => new
                    {
                        Dealer = c.Dealer!.Name,
                        Segment = c.Segment!.Name,
                        Contacts = c.Contacts.Count(x => x.IsActive),
                        Open = db.Opportunities.Count(o => o.CustomerId == c.Id && (o.Stage == OpportunityStage.Open || o.Stage == OpportunityStage.Postponed)),
                    })
                    .ToListAsync(ct);
                var rows = perCustomer.GroupBy(x => (x.Dealer, x.Segment))
                    .Select(g => new { g.Key.Dealer, g.Key.Segment, Customers = g.Count(), Contacts = g.Sum(x => x.Contacts), Open = g.Sum(x => x.Open) })
                    .OrderBy(x => x.Dealer).ThenByDescending(x => x.Customers)
                    .ToList();
                return Table("Active customers today",
                    [("Dealer", ColumnType.Text), ("Segment", ColumnType.Text), ("Customers", ColumnType.Number), ("Contacts", ColumnType.Number),
                        ("Open opportunities", ColumnType.Number)],
                    rows.Select(x => new object?[] { x.Dealer, x.Segment, x.Customers, x.Contacts, x.Open }).ToList(),
                    ["Total", null, rows.Sum(x => x.Customers), rows.Sum(x => x.Contacts), rows.Sum(x => x.Open)]);
            }
            case "service-jobs":
            {
                var jobs = db.ServiceJobs.AsNoTracking().InScope(user)
                    .Where(j => j.CreatedAt >= from.ToDateTime(TimeOnly.MinValue) && j.CreatedAt < to.AddDays(1).ToDateTime(TimeOnly.MinValue));
                if (f.DealerId is int dealerId) jobs = jobs.Where(j => j.Asset!.Customer!.DealerId == dealerId);
                var rows = await jobs.OrderByDescending(j => j.Id).Take(5000)
                    .Select(j => new
                    {
                        j.Number, j.Asset!.SerialNumber, Model = j.Asset.ProductModel != null ? j.Asset.ProductModel.Name : null,
                        Customer = j.Asset.Customer!.Name, Dealer = j.Asset.Customer.Dealer!.Name, j.Priority, j.Status, j.Source,
                        Engineer = j.Engineer != null ? (j.Engineer.FirstName + " " + j.Engineer.LastName).Trim() : null, j.CreatedAt, j.CompletedAt,
                    })
                    .ToListAsync(ct);
                return Table($"Raised {period}",
                    [("Job", ColumnType.Text), ("Serial number", ColumnType.Text), ("Model", ColumnType.Text), ("Customer", ColumnType.Text),
                        ("Dealer", ColumnType.Text), ("Priority", ColumnType.Text), ("Status", ColumnType.Text), ("Source", ColumnType.Text),
                        ("Engineer", ColumnType.Text), ("Raised", ColumnType.Date), ("Completed", ColumnType.Date), ("Days to complete", ColumnType.Number)],
                    rows.Select(x => new object?[]
                    {
                        x.Number, x.SerialNumber, x.Model, x.Customer, x.Dealer, x.Priority.ToString(), x.Status.ToString(), x.Source.ToString(),
                        x.Engineer, DateOnly.FromDateTime(x.CreatedAt), x.CompletedAt is DateTime c ? DateOnly.FromDateTime(c) : null,
                        x.CompletedAt is DateTime done ? (int)Math.Ceiling((done - x.CreatedAt).TotalDays) : null,
                    }).ToList(),
                    ["Total", $"{rows.Count} jobs", null, null, null, null, $"{rows.Count(x => x.Status is JobStatus.Completed or JobStatus.Closed)} done",
                        null, null, null, null, null]);
            }
            case "coverage":
            {
                var assets = db.Assets.AsNoTracking().InScope(user).Where(a => a.IsActive);
                if (f.DealerId is int dealerId) assets = assets.Where(a => a.Customer!.DealerId == dealerId);
                var rows = await assets.OrderBy(a => a.Customer!.Name).ThenBy(a => a.SerialNumber).Take(5000)
                    .Select(a => new
                    {
                        a.SerialNumber, Model = a.ProductModel != null ? a.ProductModel.Name : null, Customer = a.Customer!.Name,
                        Dealer = a.Customer.Dealer!.Name, a.City, a.CommissioningDate, a.WarrantyEnd,
                        AmcEnd = db.AmcContracts.Where(c => c.AssetId == a.Id && c.IsActive && c.StartDate <= today).Max(c => (DateOnly?)c.EndDate),
                        a.NextServiceDate,
                    })
                    .ToListAsync(ct);
                return Table($"Active assets on {today:dd MMM yyyy}",
                    [("Serial number", ColumnType.Text), ("Model", ColumnType.Text), ("Customer", ColumnType.Text), ("Dealer", ColumnType.Text),
                        ("City", ColumnType.Text), ("Commissioned", ColumnType.Date), ("Warranty end", ColumnType.Date), ("AMC end", ColumnType.Date),
                        ("Coverage", ColumnType.Text), ("Next service", ColumnType.Date)],
                    rows.Select(x => new object?[]
                    {
                        x.SerialNumber, x.Model, x.Customer, x.Dealer, x.City, x.CommissioningDate, x.WarrantyEnd, x.AmcEnd,
                        CoverageLabel(ServiceRules.CoverageOf(x.WarrantyEnd, x.AmcEnd, today)), x.NextServiceDate,
                    }).ToList());
            }
            default:
                return null;
        }
    }

    private static decimal? Rate(int part, int whole) => whole == 0 ? null : Math.Round((decimal)part / whole, 4);

    private static string CoverageLabel(Coverage c) => c switch
    {
        Coverage.Warranty => "In warranty",
        Coverage.WarrantyEnding => "Warranty ending",
        Coverage.Amc => "AMC",
        Coverage.AmcEnding => "AMC ending",
        Coverage.Expired => "Not covered",
        _ => "No dates",
    };

    private static IQueryable<Opportunity> Dealer(IQueryable<Opportunity> q, int? dealerId) => dealerId is int d ? q.Where(o => o.DealerId == d) : q;

    private static IQueryable<Visit> Dealer(IQueryable<Visit> q, int? dealerId) => dealerId is int d ? q.Where(v => v.DealerId == d) : q;

    private static IQueryable<Domain.Dealer> Dealer(IQueryable<Domain.Dealer> q, int? dealerId) => dealerId is int d ? q.Where(x => x.Id == d) : q;
}
