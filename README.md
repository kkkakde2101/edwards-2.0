# Edwards 2.0

The rebuild of the Edwards dealer CRM (today's GrowVAC / EDVAC Connect) on a current stack, with the same look as today's app and access control driven by data instead of hard-coded role names.

| Part | Stack | Folder |
| --- | --- | --- |
| API | ASP.NET Core on .NET 10, EF Core 10, SQL Server 2022 / Azure SQL | `api/` |
| Web | Angular 22 (standalone components, signals, zoneless) | `web/` |
| Database | New schema created by EF Core migrations | `api/src/Edwards.Api/Data/Migrations` |

## What is built

**Platform**
- **Sign-in**: JWT tokens, lockout after 5 failed attempts, login rate limit, forced password change, password policy, password reset by emailed link, welcome email with a set-password link for new users.
- **Passwords from today's app keep working.** Old unsalted SHA-256 hashes are accepted once and upgraded to PBKDF2 on that sign-in.
- **Dynamic access control**: roles, permissions per module and action, and a data scope per role (All, Zone, Dealer, Own). The API checks every call; the sidebar is built from the user's permissions. Admins change roles on the *Roles and permissions* screen and the change applies on the user's next click.
- **Administration**: users (one table replacing today's `Users`, `DealerAdmin` and `DealerEngineers`), dealers, 21 master lists (product models under ranges, winning chances as percentages), Excel upload (customers, contacts, assets, targets; all-or-nothing with a row-by-row error list and upload history).
- **Alerts**: 19 alert types, each switchable on/off and for email; in-app notifications under the bell; email outbox with retries and an email log; manual *Send alert* to people, roles or dealers; daily jobs for overdue follow-ups, due transfers, service reminders, 7-day upcoming service, warranty and AMC expiry (60 and 30 days).
- **Documents** on customers, assets, opportunities, quotations, commissioning and jobs: PDFs and images open in a viewer that draws them on canvas with the viewer's name and time as a watermark; downloading the original needs its own permission; every view, download and refused download is logged.
- **Reports**: 9 reports (pipeline, target vs achievement, opportunity list, win/loss reasons, visits by engineer, lead conversion, customers by segment, service jobs, warranty/AMC coverage) with Excel export.
- **Audit trail** on every business record: who, when, old and new values.

**Sales**
- Customers and contacts, with a 360° view (opportunities, leads, visits, assets, documents, transfers).
- Visits with competitor lines; a visit with potential creates a lead automatically (today's rule).
- Leads: qualify, disqualify, reopen, assign, convert to an opportunity.
- Opportunities: follow-ups with next dates, assignment to a dealer who must accept, status rules (won needs a PO, lost needs a reason, dropped needs a remark, reopening needs its own permission).
- Quotations: revisions with lines, submit, accept or reject, revise; the opportunity value follows the latest revision.
- Customer transfers between dealers with approval; open leads and opportunities move on the effective date.
- Dealer targets per fiscal year (value and per product range) with achievement from won opportunities.

**Service**
- Assets (installed units) with a history timeline.
- Commissioning: completing it starts the warranty and schedules the first service.
- Warranty and AMC contracts, with coverage and expiry views.
- Service jobs: assign, start, hold, complete (records the service visit), close.
- Service reminders 30 days before the next service, turned into a job (covered units) or a paid service opportunity.

**Imported from today's database**: masters, dealers, users, zone mapping, customers, contacts, visits, leads, opportunities, quotations with lines, and dealer targets.

## Run it locally

Prerequisites: .NET 10 SDK, Node 24, SQL Server reachable on `localhost,1433`, and today's database restored on the same server (for example as `edvac_27oct`).

```bash
# 1. API secrets (stored outside the repo by dotnet user-secrets)
cd api/src/Edwards.Api
dotnet user-secrets set "ConnectionStrings:Default" "Server=localhost,1433;Database=Edwards2;User Id=sa;Password=<password>;TrustServerCertificate=True;Encrypt=True"
dotnet user-secrets set "Jwt:Key" "$(openssl rand -base64 48)"

# 2. Create the database, then copy today's data into it
export ASPNETCORE_ENVIRONMENT=Development
dotnet run -- migrate
dotnet run -- import-legacy edvac_27oct

# 3. An admin login for yourself (existing users keep their current passwords)
dotnet run -- create-admin edwards.admin '<password>' First Last you@example.com

# 4. Start the API on http://localhost:5080
dotnet run

# 5. Start the web app on http://localhost:4200 (proxies /api to the API)
cd ../../../web
npm ci
npx ng serve
```

Other admin commands: `dotnet run -- set-password <login> <password> [--must-change]`.

## Run with Docker

```bash
cp .env.example .env   # fill in the connection string and a random JWT key
docker compose --env-file .env up --build
# open http://localhost:8080
```

The API applies migrations on start. Only the web container is published; the API is reached through it.

## Tests

```bash
cd api && dotnet test           # password upgrade, password policy, data scope, menu, audit trail
```

## Adding a module

1. Add its permissions to `api/src/Edwards.Api/Auth/Permissions.cs`. They are synced to the database at startup and appear in the permission matrix; Business / Admin receives them automatically.
2. Protect each endpoint with `[HasPermission(Permissions.X)]`, and filter queries with `.InScope(user)` where records belong to dealers.
3. Add the menu entry in `Auth/MenuCatalog.cs` and the route with `permissionGuard(P.x)` in `web/src/app/app.routes.ts`.
4. Hide buttons with `*appCan="P.x"`. This is for tidiness only; the API is what enforces access.

A new master list needs one entity class in `Domain/Masters.cs`, one line in `Data/MasterCatalog.cs` and a migration.

## Notes

- Customers moved from today's system have no city yet (the old app had no city field). The form asks for it on the next edit, and the dashboard counts what is missing.
- 13 active customers belong to dealers that are now inactive. Editing them keeps the current dealer; new customers can only use active dealers.
- Emails: in development they are written as `.eml` files to `api/src/Edwards.Api/App_Data/mail` instead of being sent. Set `Email:Mode` to `Smtp` with the server details to send them.
- Uploaded documents are stored under `App_Data/documents` (setting `Storage:DocumentsPath`); in Docker that folder is the `edwards-data` volume. Back it up with the database.
- The daily alert jobs run an hour apart using the server's local date; the containers run on India time.
