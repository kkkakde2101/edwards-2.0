using System.Data;
using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Data;

/// <summary>
/// Copies today's data from a database on the same SQL Server. Each script skips itself when its tables
/// already hold data, so the command can be repeated after a release adds a new script.
/// </summary>
public static partial class LegacyImporter
{
    private static readonly string[] Scripts = ["import-from-legacy.sql", "import-sales-from-legacy.sql"];

    [GeneratedRegex("^[A-Za-z0-9_]{1,128}$")]
    private static partial Regex DatabaseName();

    public static async Task<IReadOnlyList<(string Table, int Rows)>> RunAsync(AppDbContext db, string sourceDatabase, CancellationToken ct = default)
    {
        if (!DatabaseName().IsMatch(sourceDatabase))
            throw new ArgumentException("The source database name may only contain letters, digits and underscores.", nameof(sourceDatabase));

        var connection = db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);

        var counts = new List<(string, int)>();
        foreach (var script in Scripts)
        {
            await using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"Edwards.Api.Data.Sql.{script}")
                ?? throw new InvalidOperationException($"Import script {script} is missing from the build.");
            using var reader = new StreamReader(stream);
            var sql = (await reader.ReadToEndAsync(ct)).Replace("{{SOURCE}}", sourceDatabase);

            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.CommandTimeout = 600;
            await using var results = await command.ExecuteReaderAsync(ct);
            while (await results.ReadAsync(ct)) counts.Add((results.GetString(0), results.GetInt32(1)));
        }
        return counts;
    }
}
