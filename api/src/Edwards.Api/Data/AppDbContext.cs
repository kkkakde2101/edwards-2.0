using System.Text.Json;
using Edwards.Api.Auth;
using Edwards.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Edwards.Api.Data;

public partial class AppDbContext(DbContextOptions<AppDbContext> options, IUserIdAccessor? userIds = null) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<UserZone> UserZones => Set<UserZone>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<Dealer> Dealers => Set<Dealer>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Contact> Contacts => Set<Contact>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<Zone> Zones => Set<Zone>();
    public DbSet<State> States => Set<State>();
    public DbSet<Segment> Segments => Set<Segment>();
    public DbSet<AccountType> AccountTypes => Set<AccountType>();
    public DbSet<BusinessLine> BusinessLines => Set<BusinessLine>();
    public DbSet<Designation> Designations => Set<Designation>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        foreach (var master in MasterCatalog.All)
        {
            b.Entity(master.EntityType, e =>
            {
                e.ToTable(master.Table);
                e.Property(nameof(MasterEntity.Name)).HasMaxLength(100).IsRequired();
                e.Property(nameof(MasterEntity.Description)).HasMaxLength(200);
                e.HasIndex(nameof(MasterEntity.Name));
            });
        }

        b.Entity<Dealer>(e =>
        {
            e.ToTable("Dealers");
            e.Property(x => x.Name).HasMaxLength(100).IsRequired();
            e.Property(x => x.Description).HasMaxLength(200);
            e.Property(x => x.Address).HasMaxLength(300);
            e.Property(x => x.Mobile).HasMaxLength(50);
            e.Property(x => x.Pan).HasMaxLength(50);
            e.Property(x => x.Email).HasMaxLength(100);
            e.Property(x => x.Gstn).HasMaxLength(50);
            e.HasOne(x => x.Zone).WithMany().HasForeignKey(x => x.ZoneId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<User>(e =>
        {
            e.ToTable("Users");
            e.Ignore(x => x.FullName);
            e.Property(x => x.LoginName).HasMaxLength(50).IsRequired();
            e.HasIndex(x => x.LoginName).IsUnique();
            e.Property(x => x.PasswordHash).HasMaxLength(200).IsRequired();
            e.Property(x => x.FirstName).HasMaxLength(50).IsRequired();
            e.Property(x => x.LastName).HasMaxLength(50).IsRequired();
            e.Property(x => x.Email).HasMaxLength(100).IsRequired();
            e.Property(x => x.Mobile).HasMaxLength(50);
            e.Property(x => x.LegacySource).HasMaxLength(30);
            e.HasIndex(x => new { x.LegacySource, x.LegacyId });
            e.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Designation).WithMany().HasForeignKey(x => x.DesignationId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Zones).WithOne().HasForeignKey(z => z.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<UserZone>(e =>
        {
            e.ToTable("UserZones");
            e.HasKey(x => new { x.UserId, x.ZoneId });
            e.HasOne(x => x.Zone).WithMany().HasForeignKey(x => x.ZoneId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Role>(e =>
        {
            e.ToTable("Roles");
            e.Property(x => x.Code).HasMaxLength(30);
            e.HasIndex(x => x.Code).IsUnique().HasFilter("[Code] IS NOT NULL");
            e.Property(x => x.Name).HasMaxLength(50).IsRequired();
            e.HasIndex(x => x.Name).IsUnique();
            e.Property(x => x.Description).HasMaxLength(200);
            e.HasMany(x => x.Permissions).WithOne().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Permission>(e =>
        {
            e.ToTable("Permissions");
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasMaxLength(100);
            e.Property(x => x.Module).HasMaxLength(50).IsRequired();
            e.Property(x => x.ModuleLabel).HasMaxLength(100).IsRequired();
            e.Property(x => x.Action).HasMaxLength(50).IsRequired();
            e.Property(x => x.Label).HasMaxLength(100).IsRequired();
        });

        b.Entity<RolePermission>(e =>
        {
            e.ToTable("RolePermissions");
            e.HasKey(x => new { x.RoleId, x.PermissionKey });
            e.Property(x => x.PermissionKey).HasMaxLength(100);
            e.HasOne<Permission>().WithMany().HasForeignKey(x => x.PermissionKey).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Customer>(e =>
        {
            e.ToTable("Customers");
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.Address).HasMaxLength(300);
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.District).HasMaxLength(100);
            e.Property(x => x.PinCode).HasMaxLength(6).IsRequired();
            e.Property(x => x.Gst).HasMaxLength(50);
            e.HasIndex(x => x.Name);
            e.HasIndex(x => x.Gst);
            e.HasOne(x => x.State).WithMany().HasForeignKey(x => x.StateId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Segment).WithMany().HasForeignKey(x => x.SegmentId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.AccountType).WithMany().HasForeignKey(x => x.AccountTypeId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.BusinessLine).WithMany().HasForeignKey(x => x.BusinessLineId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Dealer).WithMany().HasForeignKey(x => x.DealerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.DealerUser).WithMany().HasForeignKey(x => x.DealerUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Contacts).WithOne(c => c.Customer).HasForeignKey(c => c.CustomerId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Contact>(e =>
        {
            e.ToTable("Contacts");
            e.Property(x => x.PersonName).HasMaxLength(100).IsRequired();
            e.Property(x => x.Designation).HasMaxLength(250);
            e.Property(x => x.Email).HasMaxLength(100).IsRequired();
            e.Property(x => x.Mobile).HasMaxLength(150).IsRequired();
            e.Property(x => x.LandLine).HasMaxLength(100);
            e.Property(x => x.ReportingTo).HasMaxLength(50);
            e.Property(x => x.Department).HasMaxLength(100);
        });

        ConfigureBusiness(b);

        b.Entity<AuditLog>(e =>
        {
            e.ToTable("AuditLogs");
            e.Property(x => x.Changes).HasColumnType("nvarchar(max)");
            e.Property(x => x.Entity).HasMaxLength(50).IsRequired();
            e.Property(x => x.EntityId).HasMaxLength(150).IsRequired();
            e.Property(x => x.Action).HasMaxLength(20).IsRequired();
            e.HasIndex(x => new { x.Entity, x.EntityId });
            e.HasIndex(x => x.AtUtc);
        });
    }

    // ---- Audit trail -------------------------------------------------------------------------

    private static readonly HashSet<string> NotAudited =
    [
        nameof(AuditableEntity.CreatedAt), nameof(AuditableEntity.CreatedBy),
        nameof(AuditableEntity.UpdatedAt), nameof(AuditableEntity.UpdatedBy),
        nameof(User.LastLoginAt), nameof(User.FailedLoginCount), nameof(User.LockoutEndUtc),
    ];

    private static readonly HashSet<string> Secret = [nameof(User.PasswordHash)];

    private static bool IsAudited(object entity) =>
        entity is Customer or Contact or User or UserZone or Role or RolePermission or Dealer or MasterEntity
            or Visit or Lead or Opportunity or Quotation or CustomerTransfer or DealerTarget or DealerQuantityTarget
            or Asset or AmcContract or Commissioning or ServiceJob or ServiceVisit or ServiceReminder or Document or AlertSetting;

    public override int SaveChanges(bool acceptAllChangesOnSuccess) =>
        SaveChangesAsync(acceptAllChangesOnSuccess).GetAwaiter().GetResult();

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var userId = userIds?.UserId;
        var pending = new List<(EntityEntry Entry, AuditLog Log)>();

        foreach (var entry in ChangeTracker.Entries().ToList())
        {
            if (entry.State is EntityState.Unchanged or EntityState.Detached) continue;

            if (entry.Entity is AuditableEntity audited)
            {
                if (entry.State == EntityState.Added)
                {
                    audited.CreatedAt = now;
                    audited.CreatedBy ??= userId;
                }
                else if (entry.State == EntityState.Modified)
                {
                    audited.UpdatedAt = now;
                    audited.UpdatedBy = userId;
                }
            }

            if (!IsAudited(entry.Entity)) continue;
            var changes = DescribeChanges(entry);
            if (changes is null) continue;
            pending.Add((entry, new AuditLog
            {
                AtUtc = now,
                UserId = userId,
                Entity = entry.Metadata.ClrType.Name,
                Action = entry.State.ToString(),
                Changes = changes,
            }));
        }

        if (pending.Count == 0) return await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);

        // The audit rows need the keys the database generates, so they are written in a second save
        // inside the same transaction: either both are stored or neither is.
        await using var tx = Database.IsRelational() && Database.CurrentTransaction is null
            ? await Database.BeginTransactionAsync(ct)
            : null;
        var result = await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);
        foreach (var (entry, log) in pending) log.EntityId = KeyOf(entry);
        AuditLogs.AddRange(pending.Select(p => p.Log));
        await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return result;
    }

    private static string? DescribeChanges(EntityEntry entry)
    {
        var changes = new Dictionary<string, object?>();
        foreach (var p in entry.Properties)
        {
            var name = p.Metadata.Name;
            if (NotAudited.Contains(name)) continue;
            switch (entry.State)
            {
                case EntityState.Added when !p.Metadata.IsPrimaryKey():
                    changes[name] = Secret.Contains(name) ? "(set)" : p.CurrentValue;
                    break;
                case EntityState.Modified when p.IsModified && !Equals(p.OriginalValue, p.CurrentValue):
                    changes[name] = Secret.Contains(name)
                        ? new { from = "(hidden)", to = "(changed)" }
                        : new { from = p.OriginalValue, to = p.CurrentValue };
                    break;
            }
        }

        if (entry.State == EntityState.Modified && changes.Count == 0) return null;
        return JsonSerializer.Serialize(changes);
    }

    private static string KeyOf(EntityEntry entry) =>
        string.Join("|", entry.Metadata.FindPrimaryKey()!.Properties.Select(p => entry.Property(p.Name).CurrentValue));
}
