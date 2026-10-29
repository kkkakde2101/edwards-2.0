using System.Security.Cryptography;
using System.Text;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Tests;

public class PasswordServiceTests
{
    private readonly PasswordService _passwords = new();

    private static string LegacyHash(string password) =>
        Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(password.Trim())));

    [Fact]
    public void Legacy_hash_from_todays_app_is_accepted_and_flagged_for_upgrade()
    {
        var user = new User { PasswordScheme = PasswordScheme.LegacySha256, PasswordHash = LegacyHash("Dealer@2024") };

        Assert.Equal(PasswordCheck.SuccessRehashNeeded, _passwords.Verify(user, "Dealer@2024"));
        // Today's app trimmed passwords before hashing, so a trailing space still matches.
        Assert.Equal(PasswordCheck.SuccessRehashNeeded, _passwords.Verify(user, "Dealer@2024 "));
        Assert.Equal(PasswordCheck.Failed, _passwords.Verify(user, "dealer@2024"));
    }

    [Fact]
    public void Upgraded_hash_is_salted_and_verifies()
    {
        var user = new User { LoginName = "test", PasswordScheme = PasswordScheme.Pbkdf2 };
        user.PasswordHash = _passwords.Hash(user, "Secret123");
        var second = _passwords.Hash(user, "Secret123");

        Assert.NotEqual(user.PasswordHash, second);
        Assert.Equal(PasswordCheck.Success, _passwords.Verify(user, "Secret123"));
        Assert.Equal(PasswordCheck.Failed, _passwords.Verify(user, "Secret124"));
    }

    [Theory]
    [InlineData("short1", false)]
    [InlineData("lettersonly", false)]
    [InlineData("12345678", false)]
    [InlineData(" Secret123", false)]
    [InlineData("naresh123", true)]
    [InlineData("Naresh123", true)]
    public void Policy_requires_length_letters_and_digits(string password, bool valid)
    {
        Assert.Equal(valid, PasswordService.Validate(password, "someone") is null);
    }

    [Fact]
    public void Policy_rejects_the_login_name()
    {
        Assert.NotNull(PasswordService.Validate("Naresh123", "naresh123"));
    }
}

public class ScopeTests
{
    private static AppDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new AppDbContext(options);
        db.Zones.AddRange(new Zone { Id = 1, Name = "North" }, new Zone { Id = 2, Name = "South" });
        db.Dealers.AddRange(
            new Dealer { Id = 10, Name = "North Dealer", ZoneId = 1 },
            new Dealer { Id = 20, Name = "South Dealer", ZoneId = 2 });
        db.Customers.AddRange(
            new Customer { Id = 1, Name = "A", PinCode = "411001", DealerId = 10, DealerUserId = 100 },
            new Customer { Id = 2, Name = "B", PinCode = "411001", DealerId = 10, DealerUserId = 101 },
            new Customer { Id = 3, Name = "C", PinCode = "560001", DealerId = 20, DealerUserId = 200 });
        db.SaveChanges();
        return db;
    }

    private static UserContext User(DataScope scope, int userId = 1, int? dealerId = null, params int[] zones) =>
        new(userId, "u", "U", UserType.Edwards, 1, "Role", scope, dealerId, null, zones, new HashSet<string>(), true, false);

    [Fact]
    public void All_sees_every_customer()
    {
        using var db = NewDb();
        Assert.Equal(3, db.Customers.Include(c => c.Dealer).InScope(User(DataScope.All)).Count());
    }

    [Fact]
    public void Zone_sees_only_customers_of_dealers_in_the_users_zones()
    {
        using var db = NewDb();
        var ids = db.Customers.Include(c => c.Dealer).InScope(User(DataScope.Zone, zones: 2)).Select(c => c.Id).ToList();
        Assert.Equal([3], ids);
    }

    [Fact]
    public void Dealer_sees_only_its_own_dealer()
    {
        using var db = NewDb();
        var ids = db.Customers.InScope(User(DataScope.Dealer, dealerId: 10)).Select(c => c.Id).OrderBy(i => i).ToList();
        Assert.Equal([1, 2], ids);
    }

    [Fact]
    public void Own_sees_only_customers_assigned_to_the_user()
    {
        using var db = NewDb();
        var ids = db.Customers.InScope(User(DataScope.Own, userId: 101, dealerId: 10)).Select(c => c.Id).ToList();
        Assert.Equal([2], ids);
    }

    [Fact]
    public void Dealer_scope_without_a_dealer_sees_nothing()
    {
        using var db = NewDb();
        Assert.Empty(db.Customers.InScope(User(DataScope.Dealer)));
    }

    [Fact]
    public async Task Saving_a_customer_writes_an_audit_row()
    {
        await using var db = NewDb();
        var customer = await db.Customers.FirstAsync(c => c.Id == 1);
        customer.Name = "A renamed";
        await db.SaveChangesAsync();

        var logs = await db.AuditLogs.Where(a => a.Entity == "Customer" && a.EntityId == "1").OrderBy(a => a.Id).ToListAsync();
        Assert.Equal(["Added", "Modified"], logs.Select(l => l.Action));
        Assert.Contains("A renamed", logs[1].Changes);
        Assert.DoesNotContain("PinCode", logs[1].Changes);
    }
}

public class MenuTests
{
    private static UserContext With(params string[] permissions) =>
        new(1, "u", "U", UserType.Edwards, 1, "Role", DataScope.All, null, null, [], permissions.ToHashSet(), true, false);

    [Fact]
    public void Menu_only_lists_what_the_role_allows()
    {
        var menu = MenuCatalog.For(With(Permissions.DashboardView, Permissions.CustomersView));
        Assert.Equal(["Dashboard", "Customers"], menu.Select(m => m.Label));
    }

    [Fact]
    public void Administration_appears_when_any_child_is_allowed()
    {
        var admin = Assert.Single(MenuCatalog.For(With(Permissions.RolesView)));
        Assert.Equal("Administration", admin.Label);
        Assert.Equal(["Roles and permissions"], admin.Children!.Select(c => c.Label));
    }

    [Fact]
    public void A_user_who_must_change_password_gets_no_menu()
    {
        var user = With(Permissions.DashboardView) with { MustChangePassword = true };
        Assert.Empty(MenuCatalog.For(user));
    }
}
