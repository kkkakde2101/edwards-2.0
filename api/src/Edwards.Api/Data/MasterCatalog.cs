using Edwards.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Data;

public sealed record MasterItem(
    int Id, string Name, string? Description, int SortOrder, bool IsActive, DateTime CreatedAt, DateTime? UpdatedAt,
    int? ParentId = null, string? ParentName = null, int? Number = null);

public sealed record MasterOption(int Id, string Name, int? ParentId = null, int? Number = null);

/// <summary>Typed access to one master table, so the Masters screen can work with all of them through one API.</summary>
public interface IMasterStore
{
    IQueryable<MasterEntity> Query(AppDbContext db);
    Task<List<MasterItem>> ItemsAsync(AppDbContext db, CancellationToken ct);
    Task<List<MasterOption>> OptionsAsync(AppDbContext db, int? parentId, CancellationToken ct);
    MasterEntity New();
    void Add(AppDbContext db, MasterEntity entity);
    Task<MasterEntity?> FindAsync(AppDbContext db, int id, CancellationToken ct);
}

public class MasterStore<T> : IMasterStore where T : MasterEntity, new()
{
    public IQueryable<MasterEntity> Query(AppDbContext db) => db.Set<T>();

    public virtual Task<List<MasterItem>> ItemsAsync(AppDbContext db, CancellationToken ct) =>
        Ordered(db.Set<T>().AsNoTracking())
            .Select(x => new MasterItem(x.Id, x.Name, x.Description, x.SortOrder, x.IsActive, x.CreatedAt, x.UpdatedAt, null, null, null))
            .ToListAsync(ct);

    public virtual Task<List<MasterOption>> OptionsAsync(AppDbContext db, int? parentId, CancellationToken ct) =>
        db.Set<T>().AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder).ThenBy(x => x.Name)
            .Select(x => new MasterOption(x.Id, x.Name, null, null))
            .ToListAsync(ct);

    public MasterEntity New() => new T();
    public void Add(AppDbContext db, MasterEntity entity) => db.Set<T>().Add((T)entity);

    public async Task<MasterEntity?> FindAsync(AppDbContext db, int id, CancellationToken ct) =>
        await db.Set<T>().FirstOrDefaultAsync(x => x.Id == id, ct);

    protected static IQueryable<TE> Ordered<TE>(IQueryable<TE> q) where TE : MasterEntity =>
        q.OrderByDescending(x => x.IsActive).ThenBy(x => x.SortOrder).ThenBy(x => x.Name);
}

/// <summary>Product models belong to a product range; dropdowns can filter by range.</summary>
public sealed class ProductModelStore : MasterStore<ProductModel>
{
    public override Task<List<MasterItem>> ItemsAsync(AppDbContext db, CancellationToken ct) =>
        Ordered(db.Set<ProductModel>().AsNoTracking())
            .Select(x => new MasterItem(x.Id, x.Name, x.Description, x.SortOrder, x.IsActive, x.CreatedAt, x.UpdatedAt,
                x.ProductRangeId, x.ProductRange!.Name, null))
            .ToListAsync(ct);

    public override Task<List<MasterOption>> OptionsAsync(AppDbContext db, int? parentId, CancellationToken ct) =>
        db.Set<ProductModel>().AsNoTracking()
            .Where(x => x.IsActive && (parentId == null || x.ProductRangeId == parentId))
            .OrderBy(x => x.SortOrder).ThenBy(x => x.Name)
            .Select(x => new MasterOption(x.Id, x.Name, x.ProductRangeId, null))
            .ToListAsync(ct);
}

/// <summary>Winning chances carry their percentage, used for weighted pipeline value.</summary>
public sealed class WinningChanceStore : MasterStore<WinningChance>
{
    public override Task<List<MasterItem>> ItemsAsync(AppDbContext db, CancellationToken ct) =>
        db.Set<WinningChance>().AsNoTracking()
            .OrderByDescending(x => x.IsActive).ThenBy(x => x.Percentage)
            .Select(x => new MasterItem(x.Id, x.Name, x.Description, x.SortOrder, x.IsActive, x.CreatedAt, x.UpdatedAt,
                null, null, x.Percentage))
            .ToListAsync(ct);

    public override Task<List<MasterOption>> OptionsAsync(AppDbContext db, int? parentId, CancellationToken ct) =>
        db.Set<WinningChance>().AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.Percentage)
            .Select(x => new MasterOption(x.Id, x.Name, null, x.Percentage))
            .ToListAsync(ct);
}

public sealed record MasterDefinition(
    string Key, string Label, string Group, Type EntityType, string Table, IMasterStore Store,
    string? ParentKey = null, string? NumberLabel = null);

/// <summary>Every master list. Adding a master means one entity class, one line here and a migration.</summary>
public static class MasterCatalog
{
    public static readonly IReadOnlyList<MasterDefinition> All =
    [
        Def<Zone>("zones", "Zones", "Organisation", "Zones"),
        Def<BusinessLine>("business-lines", "Business lines", "Organisation", "BusinessLines"),
        Def<Designation>("designations", "Designations", "Organisation", "Designations"),
        Def<State>("states", "States", "Location", "States"),
        Def<District>("districts", "Districts", "Location", "Districts"),
        Def<Segment>("segments", "Segments or industries", "Customers", "Segments"),
        Def<AccountType>("account-types", "Account types", "Customers", "AccountTypes"),
        Def<ApplicationArea>("applications", "Applications", "Customers", "Applications"),
        Def<ProductRange>("product-ranges", "Product ranges", "Products", "ProductRanges"),
        new("product-models", "Product models", "Products", typeof(ProductModel), "ProductModels", new ProductModelStore(), ParentKey: "product-ranges"),
        Def<PumpTechnology>("pump-technologies", "Competition pump technologies", "Products", "PumpTechnologies"),
        Def<CompetitionMake>("competition-makes", "Competition makes", "Products", "CompetitionMakes"),
        Def<VisitType>("visit-types", "Visit types", "Sales", "VisitTypes"),
        Def<LeadType>("lead-types", "Lead types", "Sales", "LeadTypes"),
        Def<SalesPhase>("sales-phases", "Sales phases", "Sales", "SalesPhases"),
        new("winning-chances", "Chances of winning", "Sales", typeof(WinningChance), "WinningChances", new WinningChanceStore(), NumberLabel: "Percentage"),
        Def<OpportunityMode>("opportunity-modes", "Opportunity created modes", "Sales", "OpportunityModes"),
        Def<WinningReason>("winning-reasons", "Reasons for winning", "Sales", "WinningReasons"),
        Def<LosingReason>("losing-reasons", "Reasons for losing", "Sales", "LosingReasons"),
        Def<AmcType>("amc-types", "AMC types", "Service", "AmcTypes"),
        Def<DocumentType>("document-types", "Document types", "Service", "DocumentTypes"),
    ];

    public static MasterDefinition? Find(string key) => All.FirstOrDefault(d => d.Key == key);

    private static MasterDefinition Def<T>(string key, string label, string group, string table)
        where T : MasterEntity, new() => new(key, label, group, typeof(T), table, new MasterStore<T>());
}
