using Microsoft.AspNetCore.Authorization;

namespace Edwards.Api.Auth;

public sealed class PermissionRequirement(string permission) : IAuthorizationRequirement
{
    public string Permission { get; } = permission;
}

/// <summary>Allows the action only when the signed-in user's role holds the permission, for example <c>[HasPermission(Permissions.CustomersEdit)]</c>.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class HasPermissionAttribute(string permission) : AuthorizeAttribute, IAuthorizationRequirementData
{
    public string Permission { get; } = permission;

    public IEnumerable<IAuthorizationRequirement> GetRequirements()
    {
        yield return new PermissionRequirement(Permission);
    }
}

public sealed class PermissionHandler(ICurrentUser currentUser) : AuthorizationHandler<PermissionRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var user = await currentUser.GetAsync();

        // A user who still has to change their password can only reach the endpoints that let them do that.
        if (user is { IsActive: true, MustChangePassword: false } && user.Has(requirement.Permission))
        {
            context.Succeed(requirement);
        }
    }
}
