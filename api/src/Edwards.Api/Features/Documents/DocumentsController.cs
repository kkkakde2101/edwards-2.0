using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Edwards.Api.Features.Documents;

public sealed class StorageOptions
{
    /// <summary>Folder for uploaded files. Relative paths are under the API's content root.</summary>
    public string DocumentsPath { get; set; } = "App_Data/documents";

    public int MaxUploadMb { get; set; } = 20;
}

public sealed class DocumentQuery : ListQuery
{
    public DocumentOwner? OwnerType { get; set; }
    public int? OwnerId { get; set; }
    public int? CustomerId { get; set; }
}

public sealed record DocumentItem(int Id, DocumentOwner OwnerType, int OwnerId, int CustomerId, string Customer, int? DocumentTypeId,
    string? DocumentType, string Title, string FileName, string ContentType, long Size, string? UploadedBy, DateTime CreatedAt, bool Viewable,
    bool CanDownload, bool CanRemove);

public sealed record DocumentAccessItem(long Id, DateTime At, string? User, string Action);

public sealed class DocumentUpload
{
    [Required]
    public IFormFile? File { get; set; }

    public DocumentOwner OwnerType { get; set; }

    [Required]
    public int? OwnerId { get; set; }

    [StringLength(200)]
    public string? Title { get; set; }

    public int? DocumentTypeId { get; set; }
}

/// <summary>
/// Documents attached to customers, assets, opportunities, quotations, commissioning and jobs.
/// Viewing streams the file to the in-app viewer, which watermarks it; downloading the original needs its own permission.
/// Every view, download and refused download is logged.
/// </summary>
[Route("api/documents")]
public sealed class DocumentsController(AppDbContext db, ICurrentUser currentUser, IOptions<StorageOptions> storage, IWebHostEnvironment env) : ApiBase
{
    private static readonly Dictionary<string, (string ContentType, byte[]? Magic)> Allowed = new(StringComparer.OrdinalIgnoreCase)
    {
        [".pdf"] = ("application/pdf", "%PDF"u8.ToArray()),
        [".png"] = ("image/png", [0x89, 0x50, 0x4E, 0x47]),
        [".jpg"] = ("image/jpeg", [0xFF, 0xD8, 0xFF]),
        [".jpeg"] = ("image/jpeg", [0xFF, 0xD8, 0xFF]),
        [".xlsx"] = ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK"u8.ToArray()),
        [".docx"] = ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "PK"u8.ToArray()),
        [".csv"] = ("text/csv", null),
        [".txt"] = ("text/plain", null),
    };

    private static bool IsViewable(string contentType) => contentType is "application/pdf" or "image/png" or "image/jpeg";

    [HttpGet]
    [HasPermission(Permissions.DocumentsView)]
    public async Task<PagedResult<DocumentItem>> List([FromQuery] DocumentQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = db.Documents.AsNoTracking().InScope(user).Where(d => d.IsActive);
        if (Clean(q.Search) is string s) query = query.Where(d => d.Title.Contains(s) || d.FileName.Contains(s) || d.Customer!.Name.Contains(s));
        if (q.OwnerType is DocumentOwner type) query = query.Where(d => d.OwnerType == type);
        if (q.OwnerId is int ownerId) query = query.Where(d => d.OwnerId == ownerId);
        if (q.CustomerId is int customerId) query = query.Where(d => d.CustomerId == customerId);

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await Items(query.OrderByDescending(d => d.Id).Skip((page - 1) * size).Take(size), user).ToListAsync(ct);
        return new PagedResult<DocumentItem>(items, total, page, size);
    }

    [HttpPost]
    [HasPermission(Permissions.DocumentsUpload)]
    [RequestSizeLimit(30 * 1024 * 1024)]
    public async Task<ActionResult<DocumentItem>> Upload([FromForm] DocumentUpload input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var file = input.File!;
        var ext = Path.GetExtension(file.FileName);
        if (!Allowed.TryGetValue(ext, out var kind)) return Invalid("file", "Upload a PDF, image (PNG or JPG), Excel, Word, CSV or text file.");
        if (file.Length == 0) return Invalid("file", "The file is empty.");
        if (file.Length > storage.Value.MaxUploadMb * 1024L * 1024L) return Invalid("file", $"Files can be at most {storage.Value.MaxUploadMb} MB.");
        if (kind.Magic is byte[] magic)
        {
            var head = new byte[magic.Length];
            await using var peek = file.OpenReadStream();
            if (await peek.ReadAtLeastAsync(head, head.Length, false, ct) < head.Length || !head.AsSpan().SequenceEqual(magic))
                return Invalid("file", "The file's content does not match its extension.");
        }
        var customerId = await CustomerOfAsync(input.OwnerType, input.OwnerId!.Value, user, ct);
        if (customerId is null) return Invalid("ownerId", "Attach the document to a record you have access to.");
        if (input.DocumentTypeId is int typeId && !await db.Set<DocumentType>().AnyAsync(t => t.Id == typeId && t.IsActive, ct))
            return Invalid("documentTypeId", "Choose a document type from the list.");

        var key = Path.Combine(DateTime.UtcNow.ToString("yyyy"), DateTime.UtcNow.ToString("MM"), $"{Guid.NewGuid():N}{ext.ToLowerInvariant()}");
        var path = PathOf(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using (var target = System.IO.File.Create(path))
        await using (var source = file.OpenReadStream())
            await source.CopyToAsync(target, ct);

        var name = Path.GetFileName(file.FileName);
        var doc = new Document
        {
            OwnerType = input.OwnerType,
            OwnerId = input.OwnerId.Value,
            CustomerId = customerId.Value,
            DocumentTypeId = input.DocumentTypeId,
            Title = Clean(input.Title) ?? Path.GetFileNameWithoutExtension(name),
            FileName = name.Length > 260 ? name[^260..] : name,
            ContentType = kind.ContentType,
            Size = file.Length,
            StorageKey = key,
        };
        db.Documents.Add(doc);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            System.IO.File.Delete(path);
            throw;
        }
        return await Items(db.Documents.AsNoTracking().Where(d => d.Id == doc.Id), user).FirstAsync(ct);
    }

    /// <summary>The file for the in-app viewer. Not cached, so it is not left in the browser.</summary>
    [HttpGet("{id:int}/view")]
    [HasPermission(Permissions.DocumentsView)]
    public async Task<IActionResult> View(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var doc = await db.Documents.AsNoTracking().InScope(user).FirstOrDefaultAsync(d => d.Id == id && d.IsActive, ct);
        if (doc is null) return NotFound();
        if (!IsViewable(doc.ContentType)) return StateConflict("This file type cannot be shown in the viewer. Download it instead.");
        await LogAsync(doc.Id, user.UserId, "view", ct);
        Response.Headers.CacheControl = "no-store";
        return PhysicalFile(PathOf(doc.StorageKey), doc.ContentType);
    }

    [HttpGet("{id:int}/download")]
    [HasPermission(Permissions.DocumentsView)]
    public async Task<IActionResult> Download(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var doc = await db.Documents.AsNoTracking().InScope(user).FirstOrDefaultAsync(d => d.Id == id && d.IsActive, ct);
        if (doc is null) return NotFound();
        if (!user.Has(Permissions.DocumentsDownload))
        {
            await LogAsync(doc.Id, user.UserId, "refused", ct);
            return Problem("Your role can view documents but not download them.", statusCode: StatusCodes.Status403Forbidden);
        }
        await LogAsync(doc.Id, user.UserId, "download", ct);
        Response.Headers.CacheControl = "no-store";
        return PhysicalFile(PathOf(doc.StorageKey), doc.ContentType, doc.FileName);
    }

    [HttpPost("{id:int}/remove")]
    [HasPermission(Permissions.DocumentsUpload)]
    public async Task<IActionResult> Remove(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var doc = await db.Documents.InScope(user).FirstOrDefaultAsync(d => d.Id == id && d.IsActive, ct);
        if (doc is null) return NotFound();
        if (doc.CreatedBy != user.UserId && user.Scope != DataScope.All) return StateConflict("Only the person who uploaded a document can remove it.");
        doc.IsActive = false;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpGet("{id:int}/access")]
    [HasPermission(Permissions.DocumentsDownload)]
    public async Task<ActionResult<List<DocumentAccessItem>>> Access(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        if (!await db.Documents.InScope(user).AnyAsync(d => d.Id == id, ct)) return NotFound();
        return await db.DocumentAccesses.AsNoTracking().Where(a => a.DocumentId == id).OrderByDescending(a => a.Id).Take(200)
            .Select(a => new DocumentAccessItem(a.Id, a.At,
                db.Users.Where(u => u.Id == a.UserId).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefault(), a.Action))
            .ToListAsync(ct);
    }

    private string PathOf(string key)
    {
        var root = Path.IsPathRooted(storage.Value.DocumentsPath)
            ? storage.Value.DocumentsPath
            : Path.Combine(env.ContentRootPath, storage.Value.DocumentsPath);
        return Path.Combine(root, key);
    }

    private async Task LogAsync(int documentId, int userId, string action, CancellationToken ct)
    {
        db.DocumentAccesses.Add(new DocumentAccess { DocumentId = documentId, UserId = userId, At = DateTime.UtcNow, Action = action });
        await db.SaveChangesAsync(ct);
    }

    /// <summary>The customer a document belongs to, or null when the owner does not exist or is outside the user's scope.</summary>
    private async Task<int?> CustomerOfAsync(DocumentOwner type, int ownerId, UserContext user, CancellationToken ct)
    {
        switch (type)
        {
            case DocumentOwner.Customer:
                return await db.Customers.InScope(user).Where(c => c.Id == ownerId).Select(c => (int?)c.Id).FirstOrDefaultAsync(ct);
            case DocumentOwner.Asset:
                return await db.Assets.InScope(user).Where(a => a.Id == ownerId).Select(a => (int?)a.CustomerId).FirstOrDefaultAsync(ct);
            case DocumentOwner.Opportunity:
                return await db.Opportunities.InScope(user).Where(o => o.Id == ownerId).Select(o => (int?)o.CustomerId).FirstOrDefaultAsync(ct);
            case DocumentOwner.Quotation:
                var visible = db.Opportunities.InScope(user);
                return await db.Quotations.Where(q => q.Id == ownerId && visible.Any(o => o.Id == q.OpportunityId))
                    .Select(q => (int?)q.Opportunity!.CustomerId).FirstOrDefaultAsync(ct);
            case DocumentOwner.Commissioning:
                return await db.Commissionings.InScope(user).Where(c => c.Id == ownerId).Select(c => (int?)c.Asset!.CustomerId).FirstOrDefaultAsync(ct);
            case DocumentOwner.ServiceJob:
                return await db.ServiceJobs.InScope(user).Where(j => j.Id == ownerId).Select(j => (int?)j.Asset!.CustomerId).FirstOrDefaultAsync(ct);
            default:
                return null;
        }
    }

    private IQueryable<DocumentItem> Items(IQueryable<Document> q, UserContext user)
    {
        var download = user.Has(Permissions.DocumentsDownload);
        var upload = user.Has(Permissions.DocumentsUpload);
        var all = user.Scope == DataScope.All;
        return q.Select(d => new DocumentItem(d.Id, d.OwnerType, d.OwnerId, d.CustomerId, d.Customer!.Name, d.DocumentTypeId,
            d.DocumentType != null ? d.DocumentType.Name : null, d.Title, d.FileName, d.ContentType, d.Size,
            db.Users.Where(u => u.Id == d.CreatedBy).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefault(), d.CreatedAt,
            d.ContentType == "application/pdf" || d.ContentType == "image/png" || d.ContentType == "image/jpeg", download,
            upload && (all || d.CreatedBy == user.UserId)));
    }
}
