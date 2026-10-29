using System.Text;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Features.Documents;
using Edwards.Api.Features.Service;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc.ModelBinding.Metadata;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

// "dotnet run -- <command>" runs an admin task (migrate, import-legacy, set-password, create-admin) and exits.
var command = CliCommands.Detect(args);
var builder = WebApplication.CreateBuilder(command is null ? args : []);

var connectionString = builder.Configuration.GetConnectionString("Default");
// Detail screens load several lists at once (asset timeline, contracts, jobs); split queries avoid one huge joined result.
builder.Services.AddDbContext<AppDbContext>(o =>
{
    if (string.IsNullOrWhiteSpace(connectionString)) o.UseSqlServer(sql => sql.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery));
    else o.UseSqlServer(connectionString, sql => sql.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery));
});

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.Configure<SecurityOptions>(builder.Configuration.GetSection("Security"));
builder.Services.AddHttpContextAccessor();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<PasswordService>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<PermissionCache>();
builder.Services.AddScoped<IUserIdAccessor, HttpUserIdAccessor>();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddScoped<IAuthorizationHandler, PermissionHandler>();
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection("Email"));
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection("Storage"));
builder.Services.AddScoped<AlertService>();
builder.Services.AddScoped<Recipients>();
builder.Services.AddScoped<DailyJobRunner>();
builder.Services.AddScoped<JobFactory>();
if (command is null)
{
    builder.Services.AddHostedService<EmailDispatcher>();
    if (builder.Configuration.GetValue("Jobs:Enabled", true)) builder.Services.AddHostedService<DailyJobs>();
}

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            NameClaimType = JwtRegisteredClaimNames.UniqueName,
            ClockSkew = TimeSpan.FromMinutes(1),
        };
    });

// Every endpoint needs a signed-in user unless it says [AllowAnonymous]; [HasPermission] adds the permission check.
builder.Services.AddAuthorization(o =>
    o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

// Behind the web container's reverse proxy, take the client IP from X-Forwarded-For so the login limit
// applies per user, not to everyone at once. Only enable this where the API is not reachable directly.
if (builder.Configuration.GetValue<bool>("Proxy:TrustForwardedHeaders"))
{
    builder.Services.Configure<ForwardedHeadersOptions>(o =>
    {
        o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        o.KnownIPNetworks.Clear();
        o.KnownProxies.Clear();
    });
}

var loginsPerMinute = builder.Configuration.GetValue("Security:LoginAttemptsPerMinute", 10);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = loginsPerMinute, Window = TimeSpan.FromMinutes(1) }));
});

builder.Services
    .AddControllers(o => o.ModelMetadataDetailsProviders.Add(new SystemTextJsonValidationMetadataProvider()))
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();

var app = builder.Build();

if (command is not null) return await CliCommands.RunAsync(app.Services, command, args);

if (jwt.Key.Length < 32)
    throw new InvalidOperationException("Jwt:Key must be at least 32 characters. Set it with user-secrets or the Jwt__Key environment variable.");

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup")) await db.Database.MigrateAsync();
    await DbSeeder.SeedAsync(db);
}

if (app.Configuration.GetValue<bool>("Proxy:TrustForwardedHeaders")) app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment()) app.MapOpenApi().AllowAnonymous();

app.MapGet("/health", async (AppDbContext db, CancellationToken ct) =>
        await db.Database.CanConnectAsync(ct)
            ? Results.Ok(new { status = "ok" })
            : Results.Problem("The database is not reachable.", statusCode: StatusCodes.Status503ServiceUnavailable))
    .AllowAnonymous();

app.MapControllers();
await app.RunAsync();
return 0;
