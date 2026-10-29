using Edwards.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Data;

/// <summary>Tables for sales, service and the platform features (alerts, documents, uploads).</summary>
public partial class AppDbContext
{
    public DbSet<ProductModel> ProductModels => Set<ProductModel>();
    public DbSet<WinningChance> WinningChances => Set<WinningChance>();
    public DbSet<Visit> Visits => Set<Visit>();
    public DbSet<Lead> Leads => Set<Lead>();
    public DbSet<Opportunity> Opportunities => Set<Opportunity>();
    public DbSet<FollowUp> FollowUps => Set<FollowUp>();
    public DbSet<Quotation> Quotations => Set<Quotation>();
    public DbSet<QuotationLine> QuotationLines => Set<QuotationLine>();
    public DbSet<CustomerTransfer> CustomerTransfers => Set<CustomerTransfer>();
    public DbSet<DealerTarget> DealerTargets => Set<DealerTarget>();
    public DbSet<DealerQuantityTarget> DealerQuantityTargets => Set<DealerQuantityTarget>();
    public DbSet<Asset> Assets => Set<Asset>();
    public DbSet<AssetEvent> AssetEvents => Set<AssetEvent>();
    public DbSet<AmcContract> AmcContracts => Set<AmcContract>();
    public DbSet<Commissioning> Commissionings => Set<Commissioning>();
    public DbSet<ServiceJob> ServiceJobs => Set<ServiceJob>();
    public DbSet<JobNote> JobNotes => Set<JobNote>();
    public DbSet<ServiceVisit> ServiceVisits => Set<ServiceVisit>();
    public DbSet<ServiceReminder> ServiceReminders => Set<ServiceReminder>();
    public DbSet<AlertSetting> AlertSettings => Set<AlertSetting>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<EmailMessage> EmailMessages => Set<EmailMessage>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentAccess> DocumentAccesses => Set<DocumentAccess>();
    public DbSet<UploadBatch> UploadBatches => Set<UploadBatch>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();

    protected override void ConfigureConventions(ModelConfigurationBuilder c)
    {
        c.Properties<decimal>().HavePrecision(18, 2);
    }

    private static void ConfigureBusiness(ModelBuilder b)
    {
        b.Entity<ProductModel>(e =>
            e.HasOne(x => x.ProductRange).WithMany().HasForeignKey(x => x.ProductRangeId));

        b.Entity<Visit>(e =>
        {
            e.ToTable("Visits");
            e.Property(x => x.CustomerProduct).HasMaxLength(100);
            e.HasIndex(x => x.VisitDate);
            e.HasOne(x => x.Lead).WithMany().HasForeignKey(x => x.LeadId);
            e.HasMany(x => x.Competitors).WithOne().HasForeignKey(c => c.VisitId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<VisitCompetitor>(e =>
        {
            e.ToTable("VisitCompetitors");
            e.Property(x => x.Model).HasMaxLength(100);
        });

        b.Entity<Lead>(e =>
        {
            e.ToTable("Leads");
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.DisqualifyReason).HasMaxLength(300);
            e.HasOne(x => x.DealerUser).WithMany().HasForeignKey(x => x.DealerUserId);
            e.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerUserId);
            e.HasOne<Visit>().WithMany().HasForeignKey(x => x.VisitId);
            e.HasOne<Opportunity>().WithMany().HasForeignKey(x => x.OpportunityId);
            e.HasIndex(x => x.Status);
        });

        b.Entity<Opportunity>(e =>
        {
            e.ToTable("Opportunities");
            e.Property(x => x.Name).HasMaxLength(250).IsRequired();
            e.Property(x => x.PoNumber).HasMaxLength(100);
            e.HasOne(x => x.DealerUser).WithMany().HasForeignKey(x => x.DealerUserId);
            e.HasOne(x => x.Owner).WithMany().HasForeignKey(x => x.OwnerUserId);
            e.HasOne(x => x.Lead).WithMany().HasForeignKey(x => x.LeadId);
            e.HasMany(x => x.FollowUps).WithOne().HasForeignKey(f => f.OpportunityId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Quotations).WithOne(q => q.Opportunity).HasForeignKey(q => q.OpportunityId);
            e.HasIndex(x => x.Stage);
            e.HasIndex(x => x.ExpectedCloseDate);
        });
        b.Entity<FollowUp>(e =>
        {
            e.ToTable("FollowUps");
            e.Property(x => x.Remark).HasMaxLength(1000).IsRequired();
        });

        b.Entity<Quotation>(e =>
        {
            e.ToTable("Quotations");
            e.Property(x => x.Number).HasMaxLength(40).IsRequired();
            e.HasIndex(x => x.Number).IsUnique();
            e.HasMany(x => x.Lines).WithOne().HasForeignKey(l => l.QuotationId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<QuotationLine>(e =>
        {
            e.ToTable("QuotationLines");
            e.Property(x => x.Description).HasMaxLength(300);
        });

        b.Entity<CustomerTransfer>(e =>
        {
            e.ToTable("CustomerTransfers");
            e.Property(x => x.Reason).HasMaxLength(500).IsRequired();
            e.Property(x => x.DecisionRemark).HasMaxLength(500);
            e.HasOne(x => x.FromDealer).WithMany().HasForeignKey(x => x.FromDealerId);
            e.HasOne(x => x.ToDealer).WithMany().HasForeignKey(x => x.ToDealerId);
        });

        b.Entity<DealerTarget>(e =>
        {
            e.ToTable("DealerTargets");
            e.HasIndex(x => new { x.DealerId, x.FiscalYear }).IsUnique();
        });
        b.Entity<DealerQuantityTarget>(e =>
        {
            e.ToTable("DealerQuantityTargets");
            e.HasIndex(x => new { x.DealerId, x.FiscalYear, x.ProductRangeId }).IsUnique();
        });

        b.Entity<Asset>(e =>
        {
            e.ToTable("Assets");
            e.Property(x => x.SerialNumber).HasMaxLength(100).IsRequired();
            e.Property(x => x.Description).HasMaxLength(300);
            e.Property(x => x.SiteName).HasMaxLength(200);
            e.Property(x => x.City).HasMaxLength(100).IsRequired();
            e.Property(x => x.PinCode).HasMaxLength(6).IsRequired();
            e.HasIndex(x => new { x.SerialNumber, x.ProductModelId }).IsUnique();
            e.HasIndex(x => x.NextServiceDate);
            e.HasOne(x => x.Engineer).WithMany().HasForeignKey(x => x.EngineerUserId);
        });
        b.Entity<AssetEvent>(e =>
        {
            e.ToTable("AssetEvents");
            e.Property(x => x.Kind).HasMaxLength(40).IsRequired();
            e.Property(x => x.Text).HasMaxLength(500).IsRequired();
            e.Property(x => x.Link).HasMaxLength(200);
            e.HasIndex(x => new { x.AssetId, x.At });
        });
        b.Entity<AmcContract>(e => e.ToTable("AmcContracts"));
        b.Entity<Commissioning>(e =>
        {
            e.ToTable("Commissionings");
            e.HasOne(x => x.Engineer).WithMany().HasForeignKey(x => x.EngineerUserId);
        });

        b.Entity<ServiceJob>(e =>
        {
            e.ToTable("ServiceJobs");
            e.Property(x => x.Number).HasMaxLength(30).IsRequired();
            e.HasIndex(x => x.Number).IsUnique();
            e.Property(x => x.Problem).HasMaxLength(1000).IsRequired();
            e.HasOne(x => x.Engineer).WithMany().HasForeignKey(x => x.EngineerUserId);
            e.HasMany(x => x.Notes).WithOne().HasForeignKey(n => n.ServiceJobId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.Status);
        });
        b.Entity<JobNote>(e =>
        {
            e.ToTable("JobNotes");
            e.Property(x => x.Text).HasMaxLength(2000).IsRequired();
        });
        b.Entity<ServiceVisit>(e =>
        {
            e.ToTable("ServiceVisits");
            e.HasOne(x => x.Engineer).WithMany().HasForeignKey(x => x.EngineerUserId);
        });
        b.Entity<ServiceReminder>(e =>
        {
            e.ToTable("ServiceReminders");
            e.Property(x => x.DismissReason).HasMaxLength(300);
            e.HasIndex(x => new { x.Status, x.DueDate });
        });

        b.Entity<AlertSetting>(e =>
        {
            e.ToTable("AlertSettings");
            e.HasKey(x => x.Type);
            e.Property(x => x.Type).ValueGeneratedNever();
        });
        b.Entity<Notification>(e =>
        {
            e.ToTable("Notifications");
            e.Property(x => x.Title).HasMaxLength(200).IsRequired();
            e.Property(x => x.Body).HasMaxLength(1000).IsRequired();
            e.Property(x => x.Link).HasMaxLength(200);
            e.HasIndex(x => new { x.UserId, x.ReadAt });
        });
        b.Entity<EmailMessage>(e =>
        {
            e.ToTable("EmailMessages");
            e.Property(x => x.To).HasMaxLength(200).IsRequired();
            e.Property(x => x.Subject).HasMaxLength(300).IsRequired();
            e.Property(x => x.Body).HasColumnType("nvarchar(max)");
            e.Property(x => x.LastError).HasMaxLength(1000);
            e.HasIndex(x => new { x.Status, x.NextAttemptAt });
        });

        b.Entity<Document>(e =>
        {
            e.ToTable("Documents");
            e.Property(x => x.Title).HasMaxLength(200).IsRequired();
            e.Property(x => x.FileName).HasMaxLength(260).IsRequired();
            e.Property(x => x.ContentType).HasMaxLength(100).IsRequired();
            e.Property(x => x.StorageKey).HasMaxLength(300).IsRequired();
            e.HasIndex(x => new { x.OwnerType, x.OwnerId });
        });
        b.Entity<DocumentAccess>(e =>
        {
            e.ToTable("DocumentAccesses");
            e.Property(x => x.Action).HasMaxLength(20).IsRequired();
            e.HasIndex(x => x.DocumentId);
        });
        b.Entity<UploadBatch>(e =>
        {
            e.ToTable("UploadBatches");
            e.Property(x => x.Kind).HasMaxLength(40).IsRequired();
            e.Property(x => x.FileName).HasMaxLength(260).IsRequired();
            e.Property(x => x.Errors).HasColumnType("nvarchar(max)");
        });
        b.Entity<PasswordResetToken>(e =>
        {
            e.ToTable("PasswordResetTokens");
            e.Property(x => x.TokenHash).HasMaxLength(100).IsRequired();
            e.HasIndex(x => x.TokenHash).IsUnique();
        });

        // Records are deactivated, never deleted, so a delete must not cascade into other records.
        // Only true child rows (lines, notes, follow-ups, competitors, permissions, zones) go with their parent.
        var cascadeAllowed = new[]
        {
            typeof(VisitCompetitor), typeof(QuotationLine), typeof(FollowUp), typeof(JobNote), typeof(RolePermission), typeof(UserZone),
        };
        foreach (var fk in b.Model.GetEntityTypes().SelectMany(t => t.GetForeignKeys()))
        {
            if (fk.DeleteBehavior == DeleteBehavior.Cascade && !cascadeAllowed.Contains(fk.DeclaringEntityType.ClrType))
                fk.DeleteBehavior = DeleteBehavior.Restrict;
        }
    }
}
