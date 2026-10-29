using Microsoft.AspNetCore.Mvc;

namespace Edwards.Api.Infrastructure;

[ApiController]
public abstract class ApiBase : ControllerBase
{
    /// <summary>A 400 with one field error, in the same shape as automatic validation errors.</summary>
    protected ActionResult Invalid(string field, string message)
    {
        ModelState.AddModelError(field, message);
        return ValidationProblem(ModelState);
    }

    /// <summary>A 409 for an action the record's current state does not allow.</summary>
    protected ObjectResult StateConflict(string message) => Problem(message, statusCode: StatusCodes.Status409Conflict);

    protected static int PageOf(int page) => Math.Max(1, page);

    protected static int SizeOf(int size) => Math.Clamp(size, 10, 100);

    protected static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

/// <summary>Paging and search parameters shared by list endpoints.</summary>
public class ListQuery
{
    public string? Search { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 25;
}
