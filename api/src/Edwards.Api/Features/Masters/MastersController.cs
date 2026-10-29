using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Masters;

public sealed record MasterSummary(string Key, string Label, string Group, int Total, int Active, string? ParentKey, string? NumberLabel);

public sealed class MasterInput
{
    [Required, StringLength(100, MinimumLength = 1)]
    public string Name { get; set; } = "";

    [StringLength(200)]
    public string? Description { get; set; }

    [Range(0, 9999)]
    public int SortOrder { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>The value in the parent list, for lists that have one (product model → product range).</summary>
    public int? ParentId { get; set; }

    /// <summary>The number carried by lists that have one (winning chance → percentage).</summary>
    [Range(0, 1_000_000)]
    public int? Number { get; set; }
}

/// <summary>One API for every master list in <see cref="MasterCatalog"/>.</summary>
[ApiController]
[Route("api/masters")]
public sealed class MastersController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [HasPermission(Permissions.MastersView)]
    public async Task<List<MasterSummary>> List(CancellationToken ct)
    {
        var result = new List<MasterSummary>();
        foreach (var master in MasterCatalog.All)
        {
            var query = master.Store.Query(db).AsNoTracking();
            result.Add(new MasterSummary(master.Key, master.Label, master.Group,
                await query.CountAsync(ct), await query.CountAsync(x => x.IsActive, ct), master.ParentKey, master.NumberLabel));
        }
        return result;
    }

    [HttpGet("{key}")]
    [HasPermission(Permissions.MastersView)]
    public async Task<ActionResult<List<MasterItem>>> Items(string key, CancellationToken ct)
    {
        var master = MasterCatalog.Find(key);
        if (master is null) return NotFound();
        return await master.Store.ItemsAsync(db, ct);
    }

    [HttpPost("{key}")]
    [HasPermission(Permissions.MastersEdit)]
    public async Task<ActionResult<MasterItem>> Create(string key, MasterInput input, CancellationToken ct)
    {
        var master = MasterCatalog.Find(key);
        if (master is null) return NotFound();
        await ValidateAsync(master, input, null, ct);
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var entity = master.Store.New();
        Apply(entity, input);
        master.Store.Add(db, entity);
        await db.SaveChangesAsync(ct);
        return await ItemAsync(master, entity.Id, ct);
    }

    [HttpPut("{key}/{id:int}")]
    [HasPermission(Permissions.MastersEdit)]
    public async Task<ActionResult<MasterItem>> Update(string key, int id, MasterInput input, CancellationToken ct)
    {
        var master = MasterCatalog.Find(key);
        if (master is null) return NotFound();
        var entity = await master.Store.FindAsync(db, id, ct);
        if (entity is null) return NotFound();
        await ValidateAsync(master, input, id, ct);
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        Apply(entity, input);
        await db.SaveChangesAsync(ct);
        return await ItemAsync(master, id, ct);
    }

    private async Task ValidateAsync(MasterDefinition master, MasterInput input, int? id, CancellationToken ct)
    {
        var name = input.Name.Trim();
        if (await master.Store.Query(db).AnyAsync(x => x.Name == name && x.Id != (id ?? 0), ct))
            ModelState.AddModelError("name", $"{master.Label} already has a value with this name.");

        if (master.ParentKey is not null)
        {
            var parent = MasterCatalog.Find(master.ParentKey)!;
            if (input.ParentId is not int parentId || !await parent.Store.Query(db).AnyAsync(x => x.Id == parentId, ct))
                ModelState.AddModelError("parentId", $"Choose a value from {parent.Label.ToLowerInvariant()}.");
        }

        if (master.NumberLabel is not null && input.Number is null)
            ModelState.AddModelError("number", $"Enter the {master.NumberLabel.ToLowerInvariant()}.");
    }

    private async Task<MasterItem> ItemAsync(MasterDefinition master, int id, CancellationToken ct) =>
        (await master.Store.ItemsAsync(db, ct)).First(x => x.Id == id);

    private static void Apply(MasterEntity entity, MasterInput input)
    {
        entity.Name = input.Name.Trim();
        entity.Description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
        entity.SortOrder = input.SortOrder;
        entity.IsActive = input.IsActive;
        if (entity is IHasParent child && input.ParentId is int parentId) child.ParentId = parentId;
        if (entity is IHasNumber numbered && input.Number is int number) numbered.Number = number;
    }
}
