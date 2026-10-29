using Edwards.Api.Auth;
using Edwards.Api.Domain;

namespace Edwards.Api.Infrastructure;

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

public sealed record Option(int Id, string Name);

/// <summary>Limits queries to the records the signed-in user's role is allowed to see.</summary>
public static partial class ScopeExtensions
{
    public static IQueryable<Customer> InScope(this IQueryable<Customer> query, UserContext user) => user.Scope switch
    {
        DataScope.All => query,
        DataScope.Zone => query.Where(c => user.ZoneIds.Contains(c.Dealer!.ZoneId)),
        DataScope.Dealer => user.DealerId is int dealerId ? query.Where(c => c.DealerId == dealerId) : query.Where(c => false),
        DataScope.Own => query.Where(c => c.DealerUserId == user.UserId),
        _ => query.Where(c => false),
    };

    public static IQueryable<Dealer> InScope(this IQueryable<Dealer> query, UserContext user) => user.Scope switch
    {
        DataScope.All => query,
        DataScope.Zone => query.Where(d => user.ZoneIds.Contains(d.ZoneId)),
        DataScope.Dealer or DataScope.Own => user.DealerId is int dealerId ? query.Where(d => d.Id == dealerId) : query.Where(d => false),
        _ => query.Where(d => false),
    };
}
