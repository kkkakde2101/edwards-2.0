using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Customers;

public sealed class CustomerQuery
{
    public string? Search { get; set; }
    public int? BusinessLineId { get; set; }
    public int? DealerId { get; set; }

    /// <summary>active (default), inactive or all.</summary>
    public string Status { get; set; } = "active";

    /// <summary>name, -name, date or -date (default: newest first).</summary>
    public string Sort { get; set; } = "-date";

    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 25;
}

public sealed record CustomerListItem(
    int Id, string Name, string? City, string? District, string? State, string PinCode, string? Gst,
    string Segment, string AccountType, string? BusinessLine, string Dealer, string? DealerUser,
    int Contacts, DateOnly CustomerDate, bool IsActive);

public sealed record CustomerDetail(
    int Id, DateOnly CustomerDate, string Name, string? Address, string? City, string? District,
    int? StateId, string? State, string PinCode, string? Gst, int SegmentId, string Segment,
    int AccountTypeId, string AccountType, int? BusinessLineId, string? BusinessLine,
    int DealerId, string Dealer, int? DealerUserId, string? DealerUser, bool IsActive,
    DateTime CreatedAt, DateTime? UpdatedAt);

public sealed class CustomerInput
{
    [Required]
    public DateOnly? CustomerDate { get; set; }

    [Required, StringLength(200, MinimumLength = 2)]
    public string Name { get; set; } = "";

    [Required, StringLength(300)]
    public string Address { get; set; } = "";

    [Required, StringLength(100)]
    public string City { get; set; } = "";

    [Required, StringLength(100)]
    public string District { get; set; } = "";

    [Required]
    public int? StateId { get; set; }

    [Required, RegularExpression("^[1-9][0-9]{5}$", ErrorMessage = "Enter a 6-digit pincode.")]
    public string PinCode { get; set; } = "";

    [RegularExpression("(?i)^[0-9]{2}[a-z]{5}[0-9]{4}[a-z][1-9a-z]z[0-9a-z]$",
        ErrorMessage = "Enter a 15-character GST number, for example 27AAAAA0000A1Z5.")]
    public string? Gst { get; set; }

    [Required]
    public int? SegmentId { get; set; }

    [Required]
    public int? AccountTypeId { get; set; }

    public int? BusinessLineId { get; set; }

    [Required]
    public int? DealerId { get; set; }

    [Required]
    public int? DealerUserId { get; set; }

    /// <summary>Set to true to save even though a customer with the same name or GST number exists.</summary>
    public bool ConfirmDuplicate { get; set; }
}

public sealed record DuplicateMatch(int Id, string Name, string? Gst, string? City, string Dealer);

public sealed record DuplicateWarning(string Code, string Message, IReadOnlyList<DuplicateMatch> Matches);

public sealed record ContactItem(
    int Id, string PersonName, string? Designation, string Email, string Mobile, string? LandLine,
    string? ReportingTo, string? Department, bool IsActive);

public sealed class ContactInput
{
    [Required, StringLength(100, MinimumLength = 2)]
    public string PersonName { get; set; } = "";

    [StringLength(250)]
    public string? Designation { get; set; }

    [Required, EmailAddress, StringLength(100)]
    public string Email { get; set; } = "";

    [Required, RegularExpression(@"^[0-9+\-() ]{7,20}$", ErrorMessage = "Enter a valid mobile number.")]
    public string Mobile { get; set; } = "";

    [RegularExpression(@"^[0-9+\-() ]{6,20}$", ErrorMessage = "Enter a valid landline number.")]
    public string? LandLine { get; set; }

    [StringLength(50)]
    public string? ReportingTo { get; set; }

    [StringLength(100)]
    public string? Department { get; set; }
}

[ApiController]
[Route("api/customers")]
public sealed partial class CustomersController(AppDbContext db, ICurrentUser currentUser) : ControllerBase
{
    [GeneratedRegex("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")]
    private static partial Regex GstFormat();

    [HttpGet]
    [HasPermission(Permissions.CustomersView)]
    public async Task<PagedResult<CustomerListItem>> List([FromQuery] CustomerQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = db.Customers.AsNoTracking().InScope(user);

        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            var s = q.Search.Trim();
            query = query.Where(c => c.Name.Contains(s) || c.PinCode.Contains(s)
                || (c.Gst != null && c.Gst.Contains(s))
                || (c.City != null && c.City.Contains(s))
                || (c.District != null && c.District.Contains(s)));
        }
        if (q.BusinessLineId is int businessLineId) query = query.Where(c => c.BusinessLineId == businessLineId);
        if (q.DealerId is int dealerId) query = query.Where(c => c.DealerId == dealerId);
        query = q.Status switch
        {
            "inactive" => query.Where(c => !c.IsActive),
            "all" => query,
            _ => query.Where(c => c.IsActive),
        };

        var total = await query.CountAsync(ct);
        query = q.Sort switch
        {
            "name" => query.OrderBy(c => c.Name),
            "-name" => query.OrderByDescending(c => c.Name),
            "date" => query.OrderBy(c => c.CustomerDate).ThenBy(c => c.Id),
            _ => query.OrderByDescending(c => c.CustomerDate).ThenByDescending(c => c.Id),
        };

        var page = Math.Max(1, q.Page);
        var size = Math.Clamp(q.PageSize, 10, 100);
        var items = await query
            .Skip((page - 1) * size)
            .Take(size)
            .Select(c => new CustomerListItem(
                c.Id, c.Name, c.City, c.District, c.State != null ? c.State.Name : null, c.PinCode, c.Gst,
                c.Segment!.Name, c.AccountType!.Name, c.BusinessLine != null ? c.BusinessLine.Name : null,
                c.Dealer!.Name, c.DealerUser != null ? c.DealerUser.FirstName + " " + c.DealerUser.LastName : null,
                c.Contacts.Count(x => x.IsActive), c.CustomerDate, c.IsActive))
            .ToListAsync(ct);

        return new PagedResult<CustomerListItem>(items, total, page, size);
    }

    [HttpGet("{id:int}")]
    [HasPermission(Permissions.CustomersView)]
    public async Task<ActionResult<CustomerDetail>> Get(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var detail = await DetailQuery(user, id).FirstOrDefaultAsync(ct);
        return detail is null ? NotFound() : detail;
    }

    [HttpPost]
    [HasPermission(Permissions.CustomersCreate)]
    public async Task<IActionResult> Create(CustomerInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var problem = await CheckAsync(input, user, null, ct);
        if (problem is not null) return problem;

        var customer = new Customer();
        Apply(customer, input);
        db.Customers.Add(customer);
        await db.SaveChangesAsync(ct);

        var detail = await DetailQuery(user, customer.Id).FirstAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = customer.Id }, detail);
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.CustomersEdit)]
    public async Task<IActionResult> Update(int id, CustomerInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var customer = await db.Customers.InScope(user).FirstOrDefaultAsync(c => c.Id == id, ct);
        if (customer is null) return NotFound();

        var problem = await CheckAsync(input, user, customer, ct);
        if (problem is not null) return problem;

        Apply(customer, input);
        await db.SaveChangesAsync(ct);
        return Ok(await DetailQuery(user, id).FirstAsync(ct));
    }

    [HttpPost("{id:int}/deactivate")]
    [HasPermission(Permissions.CustomersDeactivate)]
    public Task<IActionResult> Deactivate(int id, CancellationToken ct) => SetActive(id, false, ct);

    [HttpPost("{id:int}/activate")]
    [HasPermission(Permissions.CustomersDeactivate)]
    public Task<IActionResult> Activate(int id, CancellationToken ct) => SetActive(id, true, ct);

    [HttpGet("{id:int}/contacts")]
    [HasPermission(Permissions.CustomersView)]
    public async Task<ActionResult<List<ContactItem>>> Contacts(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        if (!await db.Customers.InScope(user).AnyAsync(c => c.Id == id, ct)) return NotFound();

        return await db.Contacts.AsNoTracking()
            .Where(c => c.CustomerId == id)
            .OrderByDescending(c => c.IsActive).ThenBy(c => c.PersonName)
            .Select(c => new ContactItem(c.Id, c.PersonName, c.Designation, c.Email, c.Mobile, c.LandLine,
                c.ReportingTo, c.Department, c.IsActive))
            .ToListAsync(ct);
    }

    [HttpPost("{id:int}/contacts")]
    [HasPermission(Permissions.CustomersEdit)]
    public async Task<ActionResult<ContactItem>> AddContact(int id, ContactInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        if (!await db.Customers.InScope(user).AnyAsync(c => c.Id == id && c.IsActive, ct)) return NotFound();

        var contact = new Contact { CustomerId = id };
        Apply(contact, input);
        db.Contacts.Add(contact);
        await db.SaveChangesAsync(ct);
        return ToItem(contact);
    }

    [HttpPut("{id:int}/contacts/{contactId:int}")]
    [HasPermission(Permissions.CustomersEdit)]
    public async Task<ActionResult<ContactItem>> UpdateContact(int id, int contactId, ContactInput input, CancellationToken ct)
    {
        var contact = await FindContactAsync(id, contactId, ct);
        if (contact is null) return NotFound();
        Apply(contact, input);
        await db.SaveChangesAsync(ct);
        return ToItem(contact);
    }

    [HttpPost("{id:int}/contacts/{contactId:int}/deactivate")]
    [HasPermission(Permissions.CustomersEdit)]
    public Task<ActionResult<ContactItem>> DeactivateContact(int id, int contactId, CancellationToken ct) =>
        SetContactActive(id, contactId, false, ct);

    [HttpPost("{id:int}/contacts/{contactId:int}/activate")]
    [HasPermission(Permissions.CustomersEdit)]
    public Task<ActionResult<ContactItem>> ActivateContact(int id, int contactId, CancellationToken ct) =>
        SetContactActive(id, contactId, true, ct);

    // ---- helpers ------------------------------------------------------------------------------

    private IQueryable<CustomerDetail> DetailQuery(UserContext user, int id) =>
        db.Customers.AsNoTracking().InScope(user).Where(c => c.Id == id).Select(c => new CustomerDetail(
            c.Id, c.CustomerDate, c.Name, c.Address, c.City, c.District, c.StateId,
            c.State != null ? c.State.Name : null, c.PinCode, c.Gst, c.SegmentId, c.Segment!.Name,
            c.AccountTypeId, c.AccountType!.Name, c.BusinessLineId, c.BusinessLine != null ? c.BusinessLine.Name : null,
            c.DealerId, c.Dealer!.Name, c.DealerUserId,
            c.DealerUser != null ? c.DealerUser.FirstName + " " + c.DealerUser.LastName : null,
            c.IsActive, c.CreatedAt, c.UpdatedAt));

    /// <summary>Validates references and scope, then warns about duplicates. Returns null when the input can be saved.</summary>
    private async Task<IActionResult?> CheckAsync(CustomerInput input, UserContext user, Customer? existing, CancellationToken ct)
    {
        // An edit may keep a value that has since been deactivated (13 customers still belong to inactive dealers);
        // new customers and changed values must use active ones.
        int? keepState = existing?.StateId, keepSegment = existing?.SegmentId, keepType = existing?.AccountTypeId,
            keepLine = existing?.BusinessLineId, keepDealer = existing?.DealerId, keepEngineer = existing?.DealerUserId;

        input.Name = input.Name.Trim();
        input.Gst = string.IsNullOrWhiteSpace(input.Gst) ? null : input.Gst.Trim().ToUpperInvariant();

        // Dealer users always own the customers they create or edit.
        if (user.Scope == DataScope.Own) input.DealerUserId = user.UserId;

        if (input.Gst is not null && !GstFormat().IsMatch(input.Gst))
            ModelState.AddModelError("gst", "Enter a 15-character GST number, for example 27AAAAA0000A1Z5.");
        if (!await db.States.AnyAsync(x => x.Id == input.StateId && (x.IsActive || x.Id == keepState), ct))
            ModelState.AddModelError("stateId", "Choose a state from the list.");
        if (!await db.Segments.AnyAsync(x => x.Id == input.SegmentId && (x.IsActive || x.Id == keepSegment), ct))
            ModelState.AddModelError("segmentId", "Choose a segment from the list.");
        if (!await db.AccountTypes.AnyAsync(x => x.Id == input.AccountTypeId && (x.IsActive || x.Id == keepType), ct))
            ModelState.AddModelError("accountTypeId", "Choose an account type from the list.");
        if (input.BusinessLineId is int bl && !await db.BusinessLines.AnyAsync(x => x.Id == bl && (x.IsActive || x.Id == keepLine), ct))
            ModelState.AddModelError("businessLineId", "Choose a business line from the list.");
        // Moving to another dealer goes through a customer transfer, so open leads and opportunities move with the customer.
        if (existing is not null && input.DealerId != existing.DealerId)
            ModelState.AddModelError("dealerId", "To move the customer to another dealer, raise a customer transfer.");
        else if (!await db.Dealers.InScope(user).AnyAsync(d => d.Id == input.DealerId && (d.IsActive || d.Id == keepDealer), ct))
            ModelState.AddModelError("dealerId", "Choose a dealer you have access to.");
        else if (!await db.Users.AnyAsync(u => u.Id == input.DealerUserId && u.DealerId == input.DealerId
                     && u.UserType == UserType.DealerUser && (u.IsActive || u.Id == keepEngineer), ct))
            ModelState.AddModelError("dealerUserId", "Choose a dealer engineer who works for the selected dealer.");

        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (input.ConfirmDuplicate) return null;

        var matches = await db.Customers.AsNoTracking()
            .Where(c => c.IsActive && c.Id != (existing == null ? 0 : existing.Id)
                && (c.Name == input.Name || (input.Gst != null && c.Gst == input.Gst)))
            .OrderBy(c => c.Name)
            .Take(5)
            .Select(c => new DuplicateMatch(c.Id, c.Name, c.Gst, c.City, c.Dealer!.Name))
            .ToListAsync(ct);

        return matches.Count == 0
            ? null
            : Conflict(new DuplicateWarning("duplicate", "A customer with the same name or GST number already exists.", matches));
    }

    private static void Apply(Customer c, CustomerInput input)
    {
        c.CustomerDate = input.CustomerDate!.Value;
        c.Name = input.Name;
        c.Address = input.Address.Trim();
        c.City = input.City.Trim();
        c.District = input.District.Trim();
        c.StateId = input.StateId;
        c.PinCode = input.PinCode.Trim();
        c.Gst = input.Gst;
        c.SegmentId = input.SegmentId!.Value;
        c.AccountTypeId = input.AccountTypeId!.Value;
        c.BusinessLineId = input.BusinessLineId;
        c.DealerId = input.DealerId!.Value;
        c.DealerUserId = input.DealerUserId;
    }

    private static void Apply(Contact c, ContactInput input)
    {
        c.PersonName = input.PersonName.Trim();
        c.Designation = Clean(input.Designation);
        c.Email = input.Email.Trim();
        c.Mobile = input.Mobile.Trim();
        c.LandLine = Clean(input.LandLine);
        c.ReportingTo = Clean(input.ReportingTo);
        c.Department = Clean(input.Department);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static ContactItem ToItem(Contact c) =>
        new(c.Id, c.PersonName, c.Designation, c.Email, c.Mobile, c.LandLine, c.ReportingTo, c.Department, c.IsActive);

    private async Task<IActionResult> SetActive(int id, bool active, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var customer = await db.Customers.InScope(user).FirstOrDefaultAsync(c => c.Id == id, ct);
        if (customer is null) return NotFound();
        customer.IsActive = active;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<Contact?> FindContactAsync(int customerId, int contactId, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var visible = db.Customers.InScope(user);
        return await db.Contacts
            .Where(c => c.Id == contactId && c.CustomerId == customerId)
            .Where(c => visible.Any(x => x.Id == c.CustomerId))
            .FirstOrDefaultAsync(ct);
    }

    private async Task<ActionResult<ContactItem>> SetContactActive(int id, int contactId, bool active, CancellationToken ct)
    {
        var contact = await FindContactAsync(id, contactId, ct);
        if (contact is null) return NotFound();
        contact.IsActive = active;
        await db.SaveChangesAsync(ct);
        return ToItem(contact);
    }
}
