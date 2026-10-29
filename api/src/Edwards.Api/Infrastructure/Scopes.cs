using Edwards.Api.Auth;
using Edwards.Api.Domain;

namespace Edwards.Api.Infrastructure;

/// <summary>
/// Data scope for sales and service records. Zone = dealers in the user's zones; Dealer = the user's dealer;
/// Own = records assigned to the user (dealer engineer, sales owner or service engineer).
/// </summary>
public static partial class ScopeExtensions
{
    public static IQueryable<Visit> InScope(this IQueryable<Visit> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(v => u.ZoneIds.Contains(v.Dealer!.ZoneId)),
        DataScope.Dealer => u.DealerId is int d ? q.Where(v => v.DealerId == d) : q.Where(v => false),
        DataScope.Own => q.Where(v => v.DealerUserId == u.UserId),
        _ => q.Where(v => false),
    };

    public static IQueryable<Lead> InScope(this IQueryable<Lead> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(l => (l.DealerId != null && u.ZoneIds.Contains(l.Dealer!.ZoneId))
            || u.ZoneIds.Contains(l.Customer!.Dealer!.ZoneId) || l.OwnerUserId == u.UserId),
        DataScope.Dealer => u.DealerId is int d ? q.Where(l => l.DealerId == d || (l.DealerId == null && l.Customer!.DealerId == d)) : q.Where(l => false),
        DataScope.Own => q.Where(l => l.DealerUserId == u.UserId || l.OwnerUserId == u.UserId || l.CreatedBy == u.UserId),
        _ => q.Where(l => false),
    };

    public static IQueryable<Opportunity> InScope(this IQueryable<Opportunity> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(o => u.ZoneIds.Contains(o.Dealer!.ZoneId) || o.OwnerUserId == u.UserId),
        DataScope.Dealer => u.DealerId is int d ? q.Where(o => o.DealerId == d) : q.Where(o => false),
        DataScope.Own => q.Where(o => o.DealerUserId == u.UserId || o.OwnerUserId == u.UserId),
        _ => q.Where(o => false),
    };

    public static IQueryable<CustomerTransfer> InScope(this IQueryable<CustomerTransfer> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(t => u.ZoneIds.Contains(t.FromDealer!.ZoneId) || u.ZoneIds.Contains(t.ToDealer!.ZoneId)),
        DataScope.Dealer => u.DealerId is int d ? q.Where(t => t.FromDealerId == d || t.ToDealerId == d) : q.Where(t => false),
        DataScope.Own => q.Where(t => t.RequestedBy == u.UserId),
        _ => q.Where(t => false),
    };

    public static IQueryable<Asset> InScope(this IQueryable<Asset> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(a => u.ZoneIds.Contains(a.Customer!.Dealer!.ZoneId)),
        DataScope.Dealer => u.DealerId is int d ? q.Where(a => a.Customer!.DealerId == d) : q.Where(a => false),
        DataScope.Own => q.Where(a => a.EngineerUserId == u.UserId || a.Customer!.DealerUserId == u.UserId),
        _ => q.Where(a => false),
    };

    public static IQueryable<ServiceJob> InScope(this IQueryable<ServiceJob> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(j => u.ZoneIds.Contains(j.Asset!.Customer!.Dealer!.ZoneId)),
        DataScope.Dealer => u.DealerId is int d ? q.Where(j => j.Asset!.Customer!.DealerId == d) : q.Where(j => false),
        DataScope.Own => q.Where(j => j.EngineerUserId == u.UserId || j.Asset!.Customer!.DealerUserId == u.UserId),
        _ => q.Where(j => false),
    };

    public static IQueryable<Commissioning> InScope(this IQueryable<Commissioning> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(c => u.ZoneIds.Contains(c.Asset!.Customer!.Dealer!.ZoneId)),
        DataScope.Dealer => u.DealerId is int d ? q.Where(c => c.Asset!.Customer!.DealerId == d) : q.Where(c => false),
        DataScope.Own => q.Where(c => c.EngineerUserId == u.UserId || c.Asset!.Customer!.DealerUserId == u.UserId),
        _ => q.Where(c => false),
    };

    public static IQueryable<ServiceReminder> InScope(this IQueryable<ServiceReminder> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(r => u.ZoneIds.Contains(r.Asset!.Customer!.Dealer!.ZoneId)),
        DataScope.Dealer => u.DealerId is int d ? q.Where(r => r.Asset!.Customer!.DealerId == d) : q.Where(r => false),
        DataScope.Own => q.Where(r => r.Asset!.EngineerUserId == u.UserId || r.Asset!.Customer!.DealerUserId == u.UserId),
        _ => q.Where(r => false),
    };

    public static IQueryable<AmcContract> InScope(this IQueryable<AmcContract> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(c => u.ZoneIds.Contains(c.Asset!.Customer!.Dealer!.ZoneId)),
        DataScope.Dealer => u.DealerId is int d ? q.Where(c => c.Asset!.Customer!.DealerId == d) : q.Where(c => false),
        DataScope.Own => q.Where(c => c.Asset!.EngineerUserId == u.UserId || c.Asset!.Customer!.DealerUserId == u.UserId),
        _ => q.Where(c => false),
    };

    public static IQueryable<Document> InScope(this IQueryable<Document> q, UserContext u) => u.Scope switch
    {
        DataScope.All => q,
        DataScope.Zone => q.Where(x => u.ZoneIds.Contains(x.Customer!.Dealer!.ZoneId)),
        DataScope.Dealer => u.DealerId is int d ? q.Where(x => x.Customer!.DealerId == d) : q.Where(x => false),
        DataScope.Own => q.Where(x => x.Customer!.DealerUserId == u.UserId || x.CreatedBy == u.UserId),
        _ => q.Where(x => false),
    };
}

/// <summary>Edwards' fiscal year runs April to March and is named by the calendar year it starts in.</summary>
public static class FiscalYear
{
    public static int Of(DateOnly date) => date.Month >= 4 ? date.Year : date.Year - 1;

    public static int Current => Of(DateOnly.FromDateTime(DateTime.Today));

    public static (DateOnly Start, DateOnly End) Range(int year) => (new DateOnly(year, 4, 1), new DateOnly(year + 1, 3, 31));

    public static string Label(int year) => $"FY {year}-{(year + 1) % 100:D2}";
}
