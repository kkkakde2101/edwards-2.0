using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Infrastructure;

/// <summary>
/// Admin tasks run from the command line instead of starting the web server:
/// <code>
/// dotnet run -- migrate
/// dotnet run -- import-legacy edvac_27oct
/// dotnet run -- set-password &lt;login&gt; &lt;password&gt; [--must-change]
/// dotnet run -- create-admin &lt;login&gt; &lt;password&gt; &lt;first name&gt; &lt;last name&gt; &lt;email&gt;
/// </code>
/// </summary>
public static class CliCommands
{
    private static readonly string[] Known = ["migrate", "import-legacy", "set-password", "create-admin"];

    public static string? Detect(string[] args) => args.Length > 0 && Known.Contains(args[0]) ? args[0] : null;

    public static async Task<int> RunAsync(IServiceProvider services, string command, string[] args)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var passwords = scope.ServiceProvider.GetRequiredService<PasswordService>();

        try
        {
            switch (command)
            {
                case "migrate":
                    await db.Database.MigrateAsync();
                    await DbSeeder.SeedAsync(db);
                    Console.WriteLine("Database is up to date, and permissions and roles are seeded.");
                    return 0;

                case "import-legacy":
                    var source = args.ElementAtOrDefault(1) ?? "edvac_27oct";
                    Console.WriteLine($"Importing from {source}...");
                    foreach (var (table, rows) in await LegacyImporter.RunAsync(db, source))
                        Console.WriteLine($"  {table,-16} {rows,6}");
                    Console.WriteLine("Import finished.");
                    return 0;

                case "set-password":
                    if (args.Length < 3) return Usage("set-password <login> <password> [--must-change]");
                    var user = await db.Users.FirstOrDefaultAsync(u => u.LoginName == args[1]);
                    if (user is null) return Fail($"No user with login name '{args[1]}'.");
                    if (PasswordService.Validate(args[2], user.LoginName) is string problem) return Fail(problem);
                    user.PasswordHash = passwords.Hash(user, args[2]);
                    user.PasswordScheme = PasswordScheme.Pbkdf2;
                    user.MustChangePassword = args.Contains("--must-change");
                    user.FailedLoginCount = 0;
                    user.LockoutEndUtc = null;
                    await db.SaveChangesAsync();
                    Console.WriteLine($"Password set for {user.LoginName}.");
                    return 0;

                case "create-admin":
                    if (args.Length < 6) return Usage("create-admin <login> <password> <first name> <last name> <email>");
                    if (await db.Users.AnyAsync(u => u.LoginName == args[1])) return Fail($"Login name '{args[1]}' is already taken.");
                    if (PasswordService.Validate(args[2], args[1]) is string error) return Fail(error);
                    var role = await db.Roles.FirstAsync(r => r.Code == RoleDefaults.Admin);
                    var admin = new User
                    {
                        LoginName = args[1],
                        FirstName = args[3],
                        LastName = args[4],
                        Email = args[5],
                        UserType = UserType.Edwards,
                        RoleId = role.Id,
                        PasswordScheme = PasswordScheme.Pbkdf2,
                    };
                    admin.PasswordHash = passwords.Hash(admin, args[2]);
                    db.Users.Add(admin);
                    await db.SaveChangesAsync();
                    Console.WriteLine($"Created {admin.LoginName} with the {role.Name} role.");
                    return 0;
            }
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }

        return Usage("migrate | import-legacy | set-password | create-admin");
    }

    private static int Usage(string text)
    {
        Console.Error.WriteLine($"Usage: dotnet run -- {text}");
        return 2;
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }
}
