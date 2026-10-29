using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Features.Dealers;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Uploads;

public sealed record UploadColumn(string Header, bool Required, string Hint);

public sealed record UploadKind(string Key, string Title, string Description, UploadColumn[] Columns);

public sealed record UploadError(int Row, string Column, string Message);

public sealed record UploadResult(int BatchId, string Kind, int Rows, int Saved, int Failed, List<UploadError> Errors);

public sealed record UploadBatchItem(int Id, string Kind, string FileName, string? UploadedBy, DateTime At, int Rows, int Saved, int Failed);

/// <summary>
/// Bulk loading from Excel. Every row is checked first; if any row has a problem nothing is saved and the full list of
/// problems comes back, so the sheet can be fixed and uploaded again. Each attempt is kept in the upload history.
/// </summary>
[Route("api/uploads")]
public sealed partial class UploadsController(AppDbContext db, ICurrentUser currentUser, AlertService alerts) : ApiBase
{
    private const int MaxRows = 5000;

    public static readonly IReadOnlyList<UploadKind> Kinds =
    [
        new("customers", "Customers", "New customers with their dealer and dealer engineer.",
        [
            new("Customer name", true, "Company name, as it should appear everywhere"),
            new("Customer date", false, "DD-MM-YYYY; today if empty"),
            new("Address", true, ""), new("City", true, ""), new("District", true, ""),
            new("State", true, "A name from the States list"),
            new("PIN code", true, "6 digits"),
            new("GST", false, "15 characters, for example 27AAAAA0000A1Z5"),
            new("Segment", true, "A name from the Segments list"),
            new("Account type", true, "A name from the Account types list"),
            new("Business line", false, "A name from the Business lines list"),
            new("Dealer", true, "A name from the Dealers list"),
            new("Dealer engineer login", true, "Login name of an engineer of that dealer"),
        ]),
        new("contacts", "Contacts", "Contact persons for existing customers.",
        [
            new("Customer ID", false, "Use when two customers share a name"),
            new("Customer name", false, "Needed when Customer ID is empty"),
            new("Person name", true, ""), new("Designation", false, ""),
            new("Email", true, ""), new("Mobile", true, ""), new("Landline", false, ""),
            new("Department", false, ""), new("Reporting to", false, ""),
        ]),
        new("assets", "Assets (installed base)", "Units already installed at customers, with their warranty and service dates.",
        [
            new("Customer ID", false, "Use when two customers share a name"),
            new("Customer name", false, "Needed when Customer ID is empty"),
            new("Product range", true, "A name from the Product ranges list"),
            new("Product model", true, "A model of that range"),
            new("Serial number", true, "Unique for the model"),
            new("Site name", false, ""), new("City", true, ""), new("PIN code", true, "6 digits"),
            new("Commissioning date", false, "DD-MM-YYYY"),
            new("Warranty end", false, "DD-MM-YYYY; 12 months from commissioning if empty"),
            new("Service interval months", false, "1 to 24; 6 if empty"),
            new("Last service date", false, "DD-MM-YYYY"),
        ]),
        new("targets", "Dealer targets", "Value targets per dealer and fiscal year, optionally split by product range.",
        [
            new("Dealer", true, "A name from the Dealers list"),
            new("Fiscal year", true, "Starting year, for example 2026 for FY 2026-27"),
            new("Product range", false, "Empty for the dealer's overall value target"),
            new("Target quantity", false, "Units, for a product range row"),
            new("Target value", true, "Rupees"),
        ]),
    ];

    [HttpGet("kinds")]
    [HasPermission(Permissions.UploadsRun)]
    public IReadOnlyList<UploadKind> GetKinds() => Kinds;

    [HttpGet]
    [HasPermission(Permissions.UploadsRun)]
    public async Task<PagedResult<UploadBatchItem>> History([FromQuery] ListQuery q, CancellationToken ct)
    {
        var total = await db.UploadBatches.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await db.UploadBatches.AsNoTracking().OrderByDescending(b => b.Id).Skip((page - 1) * size).Take(size)
            .Select(b => new UploadBatchItem(b.Id, b.Kind, b.FileName,
                db.Users.Where(u => u.Id == b.UploadedBy).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefault(),
                b.At, b.Rows, b.Saved, b.Failed))
            .ToListAsync(ct);
        return new PagedResult<UploadBatchItem>(items, total, page, size);
    }

    [HttpGet("{kind}/template")]
    [HasPermission(Permissions.UploadsRun)]
    public async Task<IActionResult> Template(string kind, CancellationToken ct)
    {
        var definition = Kinds.FirstOrDefault(k => k.Key == kind);
        if (definition is null) return NotFound();
        var user = await currentUser.RequireAsync(ct);

        using var wb = new XLWorkbook();
        var sheet = wb.AddWorksheet(definition.Title.Length > 31 ? definition.Title[..31] : definition.Title);
        for (var i = 0; i < definition.Columns.Length; i++)
        {
            var cell = sheet.Cell(1, i + 1);
            cell.Value = definition.Columns[i].Header;
            cell.Style.Font.Bold = true;
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml(definition.Columns[i].Required ? "#C4262E" : "#2D363A");
            if (definition.Columns[i].Hint.Length > 0) cell.CreateComment().AddText(definition.Columns[i].Hint);
        }
        sheet.Columns(1, definition.Columns.Length).Width = 22;
        sheet.SheetView.FreezeRows(1);

        var help = wb.AddWorksheet("Instructions");
        help.Cell(1, 1).Value = definition.Description;
        help.Cell(2, 1).Value = "Red headings are required. Keep the heading row as it is; rows can be in any order.";
        help.Cell(4, 1).Value = "Column";
        help.Cell(4, 2).Value = "Required";
        help.Cell(4, 3).Value = "How to fill it";
        help.Row(4).Style.Font.Bold = true;
        for (var i = 0; i < definition.Columns.Length; i++)
        {
            help.Cell(5 + i, 1).Value = definition.Columns[i].Header;
            help.Cell(5 + i, 2).Value = definition.Columns[i].Required ? "Yes" : "No";
            help.Cell(5 + i, 3).Value = definition.Columns[i].Hint;
        }
        help.Columns(1, 3).AdjustToContents();

        var lists = wb.AddWorksheet("Lists");
        var col = 1;
        foreach (var (title, values) in await ListsAsync(kind, user, ct))
        {
            lists.Cell(1, col).Value = title;
            lists.Cell(1, col).Style.Font.Bold = true;
            for (var r = 0; r < values.Count; r++) lists.Cell(r + 2, col).Value = values[r];
            col++;
        }
        lists.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"edwards-{kind}-template.xlsx");
    }

    [HttpPost("{kind}")]
    [HasPermission(Permissions.UploadsRun)]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult<UploadResult>> Upload(string kind, IFormFile? file, CancellationToken ct)
    {
        var definition = Kinds.FirstOrDefault(k => k.Key == kind);
        if (definition is null) return NotFound();
        if (file is null || file.Length == 0) return Invalid("file", "Choose the Excel file to upload.");
        if (!string.Equals(Path.GetExtension(file.FileName), ".xlsx", StringComparison.OrdinalIgnoreCase))
            return Invalid("file", "Upload the .xlsx template.");
        var user = await currentUser.RequireAsync(ct);

        XLWorkbook wb;
        try
        {
            await using var stream = file.OpenReadStream();
            wb = new XLWorkbook(stream);
        }
        catch (Exception)
        {
            return Invalid("file", "The file could not be read as an Excel workbook.");
        }

        using (wb)
        {
            var sheet = wb.Worksheets.First();
            var columns = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var cell in sheet.Row(1).CellsUsed()) columns.TryAdd(cell.GetFormattedString().Trim().TrimEnd('*').Trim(), cell.Address.ColumnNumber);
            var missing = definition.Columns.Where(c => c.Required && !columns.ContainsKey(c.Header)).Select(c => c.Header).ToList();
            if (missing.Count > 0) return Invalid("file", $"The sheet is missing these headings: {string.Join(", ", missing)}. Start from the template.");

            var errors = new List<UploadError>();
            var rows = sheet.RowsUsed().Where(r => r.RowNumber() > 1)
                .Select(r => new SheetRow(r.RowNumber(), r, columns, errors))
                .ToList();
            if (rows.Count == 0) return Invalid("file", "The sheet has no rows to upload.");
            if (rows.Count > MaxRows) return Invalid("file", $"Upload at most {MaxRows} rows at a time.");

            var saved = kind switch
            {
                "customers" => await CustomersAsync(rows, user, errors, ct),
                "contacts" => await ContactsAsync(rows, user, errors, ct),
                "assets" => await AssetsAsync(rows, user, errors, ct),
                _ => await TargetsAsync(rows, user, errors, ct),
            };

            var failedRows = errors.Select(e => e.Row).Distinct().Count();
            var batch = new UploadBatch
            {
                Kind = kind,
                FileName = Path.GetFileName(file.FileName) is var n && n.Length > 260 ? n[^260..] : Path.GetFileName(file.FileName),
                UploadedBy = user.UserId,
                At = DateTime.UtcNow,
                Rows = rows.Count,
                Saved = errors.Count == 0 ? saved : 0,
                Failed = failedRows,
                Errors = errors.Count == 0 ? null : JsonSerializer.Serialize(errors.Take(500)),
            };
            if (errors.Count > 0) db.ChangeTracker.Clear();
            db.UploadBatches.Add(batch);
            await alerts.RaiseAsync(AlertType.UploadResult, [user.UserId],
                errors.Count == 0 ? $"{definition.Title} upload saved" : $"{definition.Title} upload rejected",
                errors.Count == 0
                    ? $"{batch.FileName}: {batch.Saved} rows saved."
                    : $"{batch.FileName}: {failedRows} of {rows.Count} rows have problems. Nothing was saved.",
                "/admin/upload", false, ct);
            await db.SaveChangesAsync(ct);
            return new UploadResult(batch.Id, kind, batch.Rows, batch.Saved, batch.Failed, errors.Take(500).ToList());
        }
    }

    // ---- kinds --------------------------------------------------------------------------------

    private async Task<int> CustomersAsync(List<SheetRow> rows, UserContext user, List<UploadError> errors, CancellationToken ct)
    {
        var states = await NamesAsync(db.States, ct);
        var segments = await NamesAsync(db.Segments, ct);
        var types = await NamesAsync(db.AccountTypes, ct);
        var lines = await NamesAsync(db.BusinessLines, ct);
        var dealers = await db.Dealers.InScope(user).Where(d => d.IsActive).ToDictionaryAsync(d => d.Name.Trim(), d => d.Id, StringComparer.OrdinalIgnoreCase, ct);
        var engineers = await db.Users.Where(u => u.IsActive && u.UserType == UserType.DealerUser && u.DealerId != null)
            .Select(u => new { u.LoginName, u.Id, DealerId = u.DealerId!.Value }).ToListAsync(ct);
        var existing = (await db.Customers.Where(c => c.IsActive).Select(c => c.Name).ToListAsync(ct)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var gsts = (await db.Customers.Where(c => c.IsActive && c.Gst != null).Select(c => c.Gst!).ToListAsync(ct)).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var r in rows)
        {
            var name = r.Text("Customer name", true, 200);
            var gst = r.Text("GST", false, 15)?.ToUpperInvariant();
            var pin = r.Text("PIN code", true, 6);
            var dealer = r.Lookup("Dealer", dealers, true);
            var login = r.Text("Dealer engineer login", true, 50);
            if (name is not null && !existing.Add(name)) r.Error("Customer name", "already exists");
            if (gst is not null && !GstFormat().IsMatch(gst)) r.Error("GST", "is not a valid 15-character GST number");
            else if (gst is not null && !gsts.Add(gst)) r.Error("GST", "is already used by another customer");
            if (pin is not null && !PinFormat().IsMatch(pin)) r.Error("PIN code", "must be 6 digits");
            var engineer = dealer is int d && login is not null
                ? engineers.FirstOrDefault(u => u.DealerId == d && string.Equals(u.LoginName, login, StringComparison.OrdinalIgnoreCase))?.Id
                : null;
            if (dealer is not null && login is not null && engineer is null) r.Error("Dealer engineer login", "is not an engineer of this dealer");
            var customer = new Customer
            {
                Name = name ?? "",
                CustomerDate = r.Date("Customer date") ?? DateOnly.FromDateTime(DateTime.Today),
                Address = r.Text("Address", true, 500),
                City = r.Text("City", true, 100),
                District = r.Text("District", true, 100),
                StateId = r.Lookup("State", states, true),
                PinCode = pin ?? "",
                Gst = gst,
                SegmentId = r.Lookup("Segment", segments, true) ?? 0,
                AccountTypeId = r.Lookup("Account type", types, true) ?? 0,
                BusinessLineId = r.Lookup("Business line", lines),
                DealerId = dealer ?? 0,
                DealerUserId = engineer,
            };
            if (!r.HasErrors) db.Customers.Add(customer);
        }
        if (errors.Count > 0) return 0;
        await db.SaveChangesAsync(ct);
        return rows.Count;
    }

    private async Task<int> ContactsAsync(List<SheetRow> rows, UserContext user, List<UploadError> errors, CancellationToken ct)
    {
        var customers = await db.Customers.InScope(user).Where(c => c.IsActive).Select(c => new { c.Id, c.Name }).ToListAsync(ct);
        foreach (var r in rows)
        {
            var customerId = FindCustomer(r, customers.Select(c => (c.Id, c.Name)).ToList());
            var email = r.Text("Email", true, 100);
            if (email is not null && !System.Net.Mail.MailAddress.TryCreate(email, out _)) r.Error("Email", "is not a valid email address");
            var contact = new Contact
            {
                CustomerId = customerId ?? 0,
                PersonName = r.Text("Person name", true, 100) ?? "",
                Designation = r.Text("Designation", false, 100),
                Email = email ?? "",
                Mobile = r.Text("Mobile", true, 50) ?? "",
                LandLine = r.Text("Landline", false, 50),
                Department = r.Text("Department", false, 100),
                ReportingTo = r.Text("Reporting to", false, 100),
            };
            if (!r.HasErrors) db.Contacts.Add(contact);
        }
        if (errors.Count > 0) return 0;
        await db.SaveChangesAsync(ct);
        return rows.Count;
    }

    private async Task<int> AssetsAsync(List<SheetRow> rows, UserContext user, List<UploadError> errors, CancellationToken ct)
    {
        var customers = await db.Customers.InScope(user).Where(c => c.IsActive).Select(c => new { c.Id, c.Name }).ToListAsync(ct);
        var ranges = await NamesAsync(db.ProductRanges(), ct);
        var models = await db.ProductModels.Where(m => m.IsActive).Select(m => new { m.Id, m.Name, m.ProductRangeId }).ToListAsync(ct);
        var serials = (await db.Assets.Select(a => new { a.SerialNumber, a.ProductModelId }).ToListAsync(ct))
            .Select(a => $"{a.ProductModelId}|{a.SerialNumber}").ToHashSet(StringComparer.OrdinalIgnoreCase);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var added = new List<Asset>();

        foreach (var r in rows)
        {
            var customerId = FindCustomer(r, customers.Select(c => (c.Id, c.Name)).ToList());
            var range = r.Lookup("Product range", ranges, true);
            var modelName = r.Text("Product model", true, 200);
            var model = range is int rg && modelName is not null
                ? models.FirstOrDefault(m => m.ProductRangeId == rg && string.Equals(m.Name.Trim(), modelName, StringComparison.OrdinalIgnoreCase))?.Id
                : null;
            if (range is not null && modelName is not null && model is null) r.Error("Product model", "is not a model of this product range");
            var serial = r.Text("Serial number", true, 100);
            if (serial is not null && model is not null && !serials.Add($"{model}|{serial}")) r.Error("Serial number", "is already registered for this model");
            var pin = r.Text("PIN code", true, 6);
            if (pin is not null && !PinFormat().IsMatch(pin)) r.Error("PIN code", "must be 6 digits");
            var commissioned = r.Date("Commissioning date");
            var warrantyEnd = r.Date("Warranty end");
            var lastService = r.Date("Last service date");
            var interval = r.Int("Service interval months", 1, 24) ?? 6;
            if (commissioned > today) r.Error("Commissioning date", "cannot be in the future");
            if (lastService > today) r.Error("Last service date", "cannot be in the future");
            if (warrantyEnd is not null && commissioned is null) r.Error("Commissioning date", "is needed when a warranty end is given");
            if (r.HasErrors) continue;

            var asset = new Asset
            {
                CustomerId = customerId!.Value,
                ProductRangeId = range,
                ProductModelId = model,
                SerialNumber = serial!,
                SiteName = r.Text("Site name", false, 200),
                City = r.Text("City", true, 100) ?? "",
                PinCode = pin!,
                CommissioningDate = commissioned,
                WarrantyStart = commissioned,
                WarrantyEnd = warrantyEnd ?? commissioned?.AddMonths(12).AddDays(-1),
                ServiceIntervalMonths = interval,
                LastServiceDate = lastService,
                NextServiceDate = (lastService ?? commissioned)?.AddMonths(interval),
            };
            db.Assets.Add(asset);
            added.Add(asset);
        }
        if (errors.Count > 0) return 0;
        await db.SaveChangesAsync(ct);
        foreach (var a in added) db.AssetEvents.Add(new AssetEvent { AssetId = a.Id, At = DateTime.UtcNow, Kind = "Created", Text = "Loaded from Excel", UserId = user.UserId });
        await db.SaveChangesAsync(ct);
        return rows.Count;
    }

    private async Task<int> TargetsAsync(List<SheetRow> rows, UserContext user, List<UploadError> errors, CancellationToken ct)
    {
        var dealers = await db.Dealers.InScope(user).Where(d => d.IsActive).ToDictionaryAsync(d => d.Name.Trim(), d => d.Id, StringComparer.OrdinalIgnoreCase, ct);
        var ranges = await NamesAsync(db.ProductRanges(), ct);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var values = new List<(int Dealer, int Year, int? Range, int Quantity, decimal Value)>();

        foreach (var r in rows)
        {
            var dealer = r.Lookup("Dealer", dealers, true);
            var year = r.Int("Fiscal year", 2015, 2100, true);
            var range = r.Lookup("Product range", ranges);
            var quantity = r.Int("Target quantity", 0, 1_000_000) ?? 0;
            var value = r.Decimal("Target value", true);
            if (dealer is not null && year is not null && !seen.Add($"{dealer}|{year}|{range}")) r.Error("Dealer", "appears twice for the same year and range");
            if (!r.HasErrors) values.Add((dealer!.Value, year!.Value, range, quantity, value!.Value));
        }
        if (errors.Count > 0) return 0;

        foreach (var group in values.GroupBy(v => (v.Dealer, v.Year)))
        {
            var (dealerId, year) = group.Key;
            if (group.FirstOrDefault(v => v.Range is null) is { Dealer: > 0 } total)
            {
                var target = await db.DealerTargets.FirstOrDefaultAsync(t => t.DealerId == dealerId && t.FiscalYear == year, ct);
                if (target is null) db.DealerTargets.Add(target = new DealerTarget { DealerId = dealerId, FiscalYear = year });
                target.TargetValue = total.Value;
            }
            foreach (var v in group.Where(v => v.Range is not null))
            {
                var row = await db.DealerQuantityTargets.FirstOrDefaultAsync(t => t.DealerId == dealerId && t.FiscalYear == year && t.ProductRangeId == v.Range, ct);
                if (row is null) db.DealerQuantityTargets.Add(row = new DealerQuantityTarget { DealerId = dealerId, FiscalYear = year, ProductRangeId = v.Range!.Value });
                row.TargetQuantity = v.Quantity;
                row.TargetValue = v.Value;
            }
        }
        await db.SaveChangesAsync(ct);
        return rows.Count;
    }

    // ---- helpers ------------------------------------------------------------------------------

    private static int? FindCustomer(SheetRow r, List<(int Id, string Name)> customers)
    {
        if (r.Int("Customer ID", 1, int.MaxValue) is int id)
        {
            if (customers.Any(c => c.Id == id)) return id;
            r.Error("Customer ID", "is not an active customer you have access to");
            return null;
        }
        var name = r.Text("Customer name", false, 200);
        if (name is null)
        {
            r.Error("Customer name", "or Customer ID is required");
            return null;
        }
        var matches = customers.Where(c => string.Equals(c.Name.Trim(), name, StringComparison.OrdinalIgnoreCase)).ToList();
        if (matches.Count == 1) return matches[0].Id;
        r.Error("Customer name", matches.Count == 0 ? "is not an active customer you have access to" : "matches more than one customer; give the Customer ID");
        return null;
    }

    private static async Task<Dictionary<string, int>> NamesAsync<T>(IQueryable<T> set, CancellationToken ct) where T : MasterEntity =>
        (await set.Where(x => x.IsActive).Select(x => new { x.Id, x.Name }).ToListAsync(ct))
            .GroupBy(x => x.Name.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

    private async Task<List<(string Title, List<string> Values)>> ListsAsync(string kind, UserContext user, CancellationToken ct)
    {
        async Task<List<string>> Names<T>(IQueryable<T> set) where T : MasterEntity =>
            await set.Where(x => x.IsActive).OrderBy(x => x.Name).Select(x => x.Name).ToListAsync(ct);
        var dealers = await db.Dealers.InScope(user).Where(d => d.IsActive).OrderBy(d => d.Name).Select(d => d.Name).ToListAsync(ct);
        return kind switch
        {
            "customers" =>
            [
                ("States", await Names(db.States)), ("Segments", await Names(db.Segments)), ("Account types", await Names(db.AccountTypes)),
                ("Business lines", await Names(db.BusinessLines)), ("Dealers", dealers),
                ("Dealer engineer logins", await db.Users.Where(u => u.IsActive && u.UserType == UserType.DealerUser && u.Dealer!.IsActive)
                    .OrderBy(u => u.Dealer!.Name).ThenBy(u => u.LoginName).Select(u => u.LoginName + "  (" + u.Dealer!.Name + ")").ToListAsync(ct)),
            ],
            "assets" =>
            [
                ("Product ranges", await Names(db.ProductRanges())),
                ("Product models (range: model)", await db.ProductModels.Where(m => m.IsActive).OrderBy(m => m.ProductRange!.Name).ThenBy(m => m.Name)
                    .Select(m => m.ProductRange!.Name + ": " + m.Name).ToListAsync(ct)),
            ],
            "targets" => [("Dealers", dealers), ("Product ranges", await Names(db.ProductRanges()))],
            _ => [],
        };
    }

    [GeneratedRegex("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")]
    private static partial Regex GstFormat();

    [GeneratedRegex("^[1-9][0-9]{5}$")]
    private static partial Regex PinFormat();
}

/// <summary>Reads one sheet row by heading and collects problems with the row number and column.</summary>
internal sealed class SheetRow(int number, IXLRow row, Dictionary<string, int> columns, List<UploadError> errors)
{
    private bool _failed;

    public bool HasErrors => _failed;

    public void Error(string column, string message)
    {
        _failed = true;
        errors.Add(new UploadError(number, column, $"{column} {message}."));
    }

    private IXLCell? Cell(string column) => columns.TryGetValue(column, out var c) ? row.Cell(c) : null;

    public string? Text(string column, bool required = false, int max = 200)
    {
        var value = Cell(column)?.GetFormattedString().Trim() ?? "";
        if (value.Length == 0)
        {
            if (required) Error(column, "is required");
            return null;
        }
        if (value.Length > max)
        {
            Error(column, $"can be at most {max} characters");
            return null;
        }
        return value;
    }

    public int? Lookup(string column, IReadOnlyDictionary<string, int> values, bool required = false)
    {
        var text = Text(column, required);
        if (text is null) return null;
        if (values.TryGetValue(text, out var id)) return id;
        Error(column, $"'{text}' is not in the list");
        return null;
    }

    public DateOnly? Date(string column, bool required = false)
    {
        var cell = Cell(column);
        if (cell is null || cell.IsEmpty())
        {
            if (required) Error(column, "is required");
            return null;
        }
        if (cell.DataType == XLDataType.DateTime) return DateOnly.FromDateTime(cell.GetDateTime());
        var text = cell.GetFormattedString().Trim();
        if (DateOnly.TryParseExact(text, ["dd-MM-yyyy", "d-M-yyyy", "dd/MM/yyyy", "d/M/yyyy", "yyyy-MM-dd"], CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var date))
            return date;
        Error(column, "is not a date; use DD-MM-YYYY");
        return null;
    }

    public decimal? Decimal(string column, bool required = false)
    {
        var cell = Cell(column);
        if (cell is null || cell.IsEmpty())
        {
            if (required) Error(column, "is required");
            return null;
        }
        decimal? value = cell.DataType == XLDataType.Number ? (decimal)cell.GetDouble()
            : decimal.TryParse(cell.GetFormattedString().Replace(",", "").Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : null;
        if (value is null or < 0)
        {
            Error(column, "must be a number of 0 or more");
            return null;
        }
        return value;
    }

    public int? Int(string column, int min, int max, bool required = false)
    {
        var value = Decimal(column, required);
        if (value is null) return null;
        if (value != Math.Floor(value.Value) || value < min || value > max)
        {
            Error(column, $"must be a whole number from {min} to {max}");
            return null;
        }
        return (int)value.Value;
    }
}
