using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Lookups;

public sealed record DealerOption(int Id, string Name, string Zone, int ZoneId);

/// <summary>Active values for dropdowns. Any signed-in user can read them; records are limited to the user's scope.</summary>
[ApiController]
[Route("api/lookups")]
[Authorize]
public sealed class LookupsController(AppDbContext db, ICurrentUser currentUser) : ControllerBase
{
    [HttpGet("masters/{key}")]
    public async Task<ActionResult<List<MasterOption>>> Master(string key, [FromQuery] int? parentId, CancellationToken ct)
    {
        var master = MasterCatalog.Find(key);
        if (master is null) return NotFound();
        return await master.Store.OptionsAsync(db, parentId, ct);
    }

    [HttpGet("dealers")]
    public async Task<List<DealerOption>> Dealers(CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        return await db.Dealers.AsNoTracking().InScope(user)
            .Where(d => d.IsActive)
            .OrderBy(d => d.Name)
            .Select(d => new DealerOption(d.Id, d.Name, d.Zone!.Name, d.ZoneId))
            .ToListAsync(ct);
    }

    /// <summary>Every active dealer, for choosing the dealer a customer moves to. Only names are returned.</summary>
    [HttpGet("dealers/all")]
    public async Task<List<DealerOption>> AllDealers(CancellationToken ct) =>
        await db.Dealers.AsNoTracking()
            .Where(d => d.IsActive)
            .OrderBy(d => d.Name)
            .Select(d => new DealerOption(d.Id, d.Name, d.Zone!.Name, d.ZoneId))
            .ToListAsync(ct);

    [HttpGet("dealers/{dealerId:int}/users")]
    public async Task<ActionResult<List<Option>>> DealerUsers(int dealerId, [FromQuery] bool any, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        // "any" lists engineers of a dealer outside the user's scope, needed when requesting a transfer to that dealer.
        if (!any && !await db.Dealers.InScope(user).AnyAsync(d => d.Id == dealerId, ct)) return NotFound();

        var query = db.Users.AsNoTracking()
            .Where(u => u.DealerId == dealerId && u.UserType == UserType.DealerUser && u.IsActive);
        if (!any && user.Scope == DataScope.Own) query = query.Where(u => u.Id == user.UserId);

        return await query
            .OrderBy(u => u.FirstName).ThenBy(u => u.LastName)
            .Select(u => new Option(u.Id, (u.FirstName + " " + u.LastName).Trim()))
            .ToListAsync(ct);
    }

    /// <summary>Customers in the user's scope whose name, city or GST matches, for pickers on other forms.</summary>
    [HttpGet("customers")]
    public async Task<List<Option>> Customers([FromQuery] string? search, [FromQuery] int? id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = db.Customers.AsNoTracking().InScope(user).Where(c => c.IsActive);
        if (id is int customerId) query = query.Where(c => c.Id == customerId);
        else if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            query = query.Where(c => c.Name.Contains(s) || (c.City != null && c.City.Contains(s)) || (c.Gst != null && c.Gst.Contains(s)));
        }
        return await query
            .OrderBy(c => c.Name)
            .Take(20)
            .Select(c => new Option(c.Id, c.City != null ? c.Name + " · " + c.City : c.District != null ? c.Name + " · " + c.District : c.Name))
            .ToListAsync(ct);
    }

    [HttpGet("customers/{customerId:int}/assets")]
    public async Task<ActionResult<List<Option>>> CustomerAssets(int customerId, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        if (!await db.Customers.InScope(user).AnyAsync(c => c.Id == customerId, ct)) return NotFound();
        return await db.Assets.AsNoTracking()
            .Where(a => a.CustomerId == customerId && a.IsActive)
            .OrderBy(a => a.SerialNumber)
            .Select(a => new Option(a.Id, a.ProductModel != null ? a.SerialNumber + " · " + a.ProductModel.Name : a.SerialNumber))
            .ToListAsync(ct);
    }

    /// <summary>Won opportunities of a customer, for linking a new asset to the sale.</summary>
    [HttpGet("customers/{customerId:int}/won-opportunities")]
    public async Task<ActionResult<List<Option>>> WonOpportunities(int customerId, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        if (!await db.Customers.InScope(user).AnyAsync(c => c.Id == customerId, ct)) return NotFound();
        return await db.Opportunities.AsNoTracking()
            .Where(o => o.CustomerId == customerId && o.Stage == OpportunityStage.Won)
            .OrderByDescending(o => o.ClosedDate)
            .Select(o => new Option(o.Id, o.Name))
            .ToListAsync(ct);
    }

    /// <summary>Who can do service work on a customer's assets: Edwards service staff and the customer's dealer engineers.</summary>
    [HttpGet("engineers")]
    public async Task<ActionResult<List<Option>>> Engineers([FromQuery] int customerId, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var dealerId = await db.Customers.InScope(user).Where(c => c.Id == customerId).Select(c => (int?)c.DealerId).FirstOrDefaultAsync(ct);
        if (dealerId is null) return NotFound();
        return await db.Users.AsNoTracking()
            .Where(u => u.IsActive && ((u.UserType == UserType.Edwards
                    && (u.Role!.Code == RoleDefaults.ServiceEngineer || u.Role.Code == RoleDefaults.ServiceCoordinator))
                || (u.UserType == UserType.DealerUser && u.DealerId == dealerId)))
            .OrderBy(u => u.UserType).ThenBy(u => u.FirstName).ThenBy(u => u.LastName)
            .Select(u => new Option(u.Id, u.UserType == UserType.Edwards ? (u.FirstName + " " + u.LastName).Trim() + " (Edwards)"
                : (u.FirstName + " " + u.LastName).Trim()))
            .ToListAsync(ct);
    }

    /// <summary>Active users holding one of the given system roles, for choosing owners and engineers.</summary>
    [HttpGet("users")]
    public async Task<List<Option>> Users([FromQuery] string roles, CancellationToken ct)
    {
        var codes = (roles ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return await db.Users.AsNoTracking()
            .Where(u => u.IsActive && u.Role!.Code != null && codes.Contains(u.Role.Code))
            .OrderBy(u => u.FirstName).ThenBy(u => u.LastName)
            .Select(u => new Option(u.Id, (u.FirstName + " " + u.LastName).Trim()))
            .ToListAsync(ct);
    }

    [HttpGet("roles")]
    public async Task<List<Option>> Roles(CancellationToken ct) =>
        await db.Roles.AsNoTracking()
            .Where(r => r.IsActive)
            .OrderBy(r => r.Id)
            .Select(r => new Option(r.Id, r.Name))
            .ToListAsync(ct);
}
