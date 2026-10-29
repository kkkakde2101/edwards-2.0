using Edwards.Api.Data;
using Edwards.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Service;

/// <summary>Whether an asset is covered today: by warranty, by an AMC, or not at all.</summary>
public enum Coverage { None, Warranty, WarrantyEnding, Amc, AmcEnding, Expired }

internal static class ServiceRules
{
    /// <summary>Warranty and AMC are "ending" this many days before their end date, matching the expiry alerts.</summary>
    public const int EndingDays = 60;

    public static Coverage CoverageOf(DateOnly? warrantyEnd, DateOnly? amcEnd, DateOnly today)
    {
        if (amcEnd is DateOnly amc && amc >= today) return amc <= today.AddDays(EndingDays) ? Coverage.AmcEnding : Coverage.Amc;
        if (warrantyEnd is DateOnly w && w >= today) return w <= today.AddDays(EndingDays) ? Coverage.WarrantyEnding : Coverage.Warranty;
        return warrantyEnd is null && amcEnd is null ? Coverage.None : Coverage.Expired;
    }

    /// <summary>Adds a line to the asset's history. The caller saves.</summary>
    public static void LogAsset(this AppDbContext db, int assetId, string kind, string text, string? link, int? userId) =>
        db.AssetEvents.Add(new AssetEvent
        {
            AssetId = assetId,
            At = DateTime.UtcNow,
            Kind = kind,
            Text = text.Length > 500 ? text[..500] : text,
            Link = link,
            UserId = userId,
        });

    /// <summary>Service work goes to Edwards staff or to an engineer of the customer's dealer.</summary>
    public static Task<bool> CanServeAsync(this AppDbContext db, int userId, int dealerId, CancellationToken ct) =>
        db.Users.AnyAsync(u => u.Id == userId && u.IsActive
            && (u.UserType == UserType.Edwards || (u.UserType == UserType.DealerUser && u.DealerId == dealerId)), ct);

    /// <summary>Next free number in a yearly series such as SJ-2026-00042.</summary>
    public static async Task<string> NextJobNumberAsync(this AppDbContext db, CancellationToken ct)
    {
        var prefix = $"SJ-{DateTime.Today:yyyy}-";
        var last = await db.ServiceJobs.Where(j => j.Number.StartsWith(prefix)).OrderByDescending(j => j.Number).Select(j => j.Number)
            .FirstOrDefaultAsync(ct);
        var next = last is null ? 1 : int.Parse(last[prefix.Length..]) + 1;
        return $"{prefix}{next:D5}";
    }

    public static string Label(this ServiceVisitType type) => type switch
    {
        ServiceVisitType.PreventiveMaintenance => "Preventive maintenance",
        ServiceVisitType.Amc => "AMC visit",
        _ => type.ToString(),
    };
}
