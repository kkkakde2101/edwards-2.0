using System.ComponentModel.DataAnnotations;
using Edwards.Api.Auth;
using Edwards.Api.Data;
using Edwards.Api.Domain;
using Edwards.Api.Features.Alerts;
using Edwards.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Edwards.Api.Features.Service;

public sealed class JobQuery : ListQuery
{
    /// <summary>A status, or "open" for everything not completed or closed.</summary>
    public string? Status { get; set; } = "open";

    public JobPriority? Priority { get; set; }
    public int? EngineerUserId { get; set; }
    public int? AssetId { get; set; }
    public int? CustomerId { get; set; }
}

public sealed record JobListItem(int Id, string Number, int AssetId, string SerialNumber, string? Model, int CustomerId, string Customer,
    string City, string Problem, JobPriority Priority, JobStatus Status, JobSource Source, string? Engineer, DateOnly? PlannedDate,
    DateTime CreatedAt, DateTime? CompletedAt);

public sealed record JobNoteItem(int Id, DateTime At, string? By, string Text, JobStatus? StatusChangedTo);

public sealed record ServiceVisitItem(int Id, ServiceVisitType Type, DateOnly VisitDate, bool Completed, string? Engineer, string? Remarks);

public sealed record JobActions(bool Edit, bool Assign, bool Start, bool Hold, bool Complete, bool Close);

public sealed record JobDetail(int Id, string Number, int AssetId, string SerialNumber, string? Model, int CustomerId, string Customer, string Dealer,
    string? SiteName, string City, string Problem, JobPriority Priority, JobStatus Status, JobSource Source, int? EngineerUserId, string? Engineer,
    DateOnly? PlannedDate, DateTime CreatedAt, DateTime? CompletedAt, string? CompletionReport, int? ReminderId, int? OpportunityId,
    List<JobNoteItem> Notes, List<ServiceVisitItem> Visits, JobActions? Actions);

public sealed class JobInput
{
    [Required]
    public int? AssetId { get; set; }

    [Required, StringLength(1000, MinimumLength = 5)]
    public string Problem { get; set; } = "";

    public JobPriority Priority { get; set; } = JobPriority.Medium;

    public DateOnly? PlannedDate { get; set; }

    /// <summary>Used only when the user may assign engineers.</summary>
    public int? EngineerUserId { get; set; }
}

public sealed class AssignJobInput
{
    [Required]
    public int? EngineerUserId { get; set; }

    public DateOnly? PlannedDate { get; set; }
}

public sealed class JobNoteInput
{
    [Required, StringLength(2000, MinimumLength = 2)]
    public string Text { get; set; } = "";

    /// <summary>Optional move to InProgress or OnHold together with the note.</summary>
    public JobStatus? Status { get; set; }
}

public sealed class CompleteJobInput
{
    [Required]
    public DateOnly? VisitDate { get; set; }

    public ServiceVisitType VisitType { get; set; } = ServiceVisitType.Breakdown;

    [Required, StringLength(2000, MinimumLength = 5)]
    public string Report { get; set; } = "";
}

/// <summary>
/// Service jobs: a breakdown call, a preventive service raised from a reminder, or a job sold through an opportunity.
/// Open → Assigned → In progress (↔ On hold) → Completed → Closed. Completing records the service visit on the asset.
/// </summary>
[Route("api/jobs")]
public sealed class JobsController(AppDbContext db, ICurrentUser currentUser, AlertService alerts, Recipients recipients, JobFactory jobs) : ApiBase
{
    [HttpGet]
    [HasPermission(Permissions.JobsView)]
    public async Task<PagedResult<JobListItem>> List([FromQuery] JobQuery q, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var query = db.ServiceJobs.AsNoTracking().InScope(user);
        if (Clean(q.Search) is string s)
            query = query.Where(j => j.Number.Contains(s) || j.Asset!.SerialNumber.Contains(s) || j.Asset.Customer!.Name.Contains(s) || j.Problem.Contains(s));
        if (q.Status == "open") query = query.Where(j => j.Status != JobStatus.Completed && j.Status != JobStatus.Closed);
        else if (Enum.TryParse<JobStatus>(q.Status, true, out var status)) query = query.Where(j => j.Status == status);
        if (q.Priority is JobPriority priority) query = query.Where(j => j.Priority == priority);
        if (q.EngineerUserId is int engineer) query = query.Where(j => j.EngineerUserId == engineer);
        if (q.AssetId is int assetId) query = query.Where(j => j.AssetId == assetId);
        if (q.CustomerId is int customerId) query = query.Where(j => j.Asset!.CustomerId == customerId);

        var total = await query.CountAsync(ct);
        var page = PageOf(q.Page);
        var size = SizeOf(q.PageSize);
        var items = await query
            .OrderByDescending(j => j.Priority).ThenBy(j => j.PlannedDate == null).ThenBy(j => j.PlannedDate).ThenByDescending(j => j.Id)
            .Skip((page - 1) * size).Take(size)
            .Select(j => new JobListItem(j.Id, j.Number, j.AssetId, j.Asset!.SerialNumber, j.Asset.ProductModel != null ? j.Asset.ProductModel.Name : null,
                j.Asset.CustomerId, j.Asset.Customer!.Name, j.Asset.City, j.Problem, j.Priority, j.Status, j.Source,
                j.Engineer != null ? (j.Engineer.FirstName + " " + j.Engineer.LastName).Trim() : null, j.PlannedDate, j.CreatedAt, j.CompletedAt))
            .ToListAsync(ct);
        return new PagedResult<JobListItem>(items, total, page, size);
    }

    [HttpGet("{id:int}")]
    [HasPermission(Permissions.JobsView)]
    public async Task<ActionResult<JobDetail>> Get(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var j = await db.ServiceJobs.AsNoTracking().InScope(user).Where(x => x.Id == id)
            .Select(x => new JobDetail(x.Id, x.Number, x.AssetId, x.Asset!.SerialNumber, x.Asset.ProductModel != null ? x.Asset.ProductModel.Name : null,
                x.Asset.CustomerId, x.Asset.Customer!.Name, x.Asset.Customer.Dealer!.Name, x.Asset.SiteName, x.Asset.City, x.Problem, x.Priority,
                x.Status, x.Source, x.EngineerUserId, x.Engineer != null ? (x.Engineer.FirstName + " " + x.Engineer.LastName).Trim() : null,
                x.PlannedDate, x.CreatedAt, x.CompletedAt, x.CompletionReport, x.ReminderId, x.OpportunityId,
                x.Notes.OrderByDescending(n => n.At).ThenByDescending(n => n.Id)
                    .Select(n => new JobNoteItem(n.Id, n.At, n.User != null ? (n.User.FirstName + " " + n.User.LastName).Trim() : null, n.Text,
                        n.StatusChangedTo)).ToList(),
                db.ServiceVisits.Where(v => v.ServiceJobId == x.Id).OrderByDescending(v => v.VisitDate)
                    .Select(v => new ServiceVisitItem(v.Id, v.Type, v.VisitDate, v.Completed,
                        v.Engineer != null ? (v.Engineer.FirstName + " " + v.Engineer.LastName).Trim() : null, v.Remarks)).ToList(),
                null))
            .FirstOrDefaultAsync(ct);
        if (j is null) return NotFound();
        var open = j.Status is not (JobStatus.Completed or JobStatus.Closed);
        var edit = user.Has(Permissions.JobsEdit);
        return j with
        {
            Actions = new JobActions(
                Edit: open && edit,
                Assign: open && user.Has(Permissions.JobsAssign),
                Start: edit && j.Status is JobStatus.Assigned or JobStatus.OnHold or JobStatus.Open && j.EngineerUserId is not null,
                Hold: edit && j.Status == JobStatus.InProgress,
                Complete: edit && j.Status is JobStatus.Assigned or JobStatus.InProgress or JobStatus.OnHold,
                Close: j.Status == JobStatus.Completed && user.Has(Permissions.JobsAssign)),
        };
    }

    [HttpPost]
    [HasPermission(Permissions.JobsCreate)]
    public async Task<ActionResult<JobDetail>> Create(JobInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var asset = await db.Assets.InScope(user).Include(a => a.Customer).FirstOrDefaultAsync(a => a.Id == input.AssetId && a.IsActive, ct);
        if (asset is null) return Invalid("assetId", "Choose an active asset you have access to.");
        var engineer = user.Has(Permissions.JobsAssign) ? input.EngineerUserId : null;
        if (engineer is int e && !await db.CanServeAsync(e, asset.Customer!.DealerId, ct))
            return Invalid("engineerUserId", "Choose an Edwards engineer or an engineer of the customer's dealer.");

        var job = await jobs.CreateAsync(asset, input.Problem.Trim(), input.Priority, JobSource.Breakdown, input.PlannedDate, engineer, user, ct);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = job.Id }, (await Get(job.Id, ct)).Value);
    }

    [HttpPut("{id:int}")]
    [HasPermission(Permissions.JobsEdit)]
    public async Task<ActionResult<JobDetail>> Update(int id, JobInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var job = await db.ServiceJobs.InScope(user).FirstOrDefaultAsync(j => j.Id == id, ct);
        if (job is null) return NotFound();
        if (job.Status is JobStatus.Completed or JobStatus.Closed) return StateConflict("Completed jobs cannot be changed.");
        if (input.AssetId != job.AssetId) return Invalid("assetId", "A job cannot move to another asset.");
        job.Problem = input.Problem.Trim();
        job.Priority = input.Priority;
        job.PlannedDate = input.PlannedDate;
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/assign")]
    [HasPermission(Permissions.JobsAssign)]
    public async Task<ActionResult<JobDetail>> Assign(int id, AssignJobInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var job = await db.ServiceJobs.InScope(user).Include(j => j.Asset).ThenInclude(a => a!.Customer).FirstOrDefaultAsync(j => j.Id == id, ct);
        if (job is null) return NotFound();
        if (job.Status is JobStatus.Completed or JobStatus.Closed) return StateConflict("Completed jobs cannot be reassigned.");
        var engineer = input.EngineerUserId!.Value;
        if (!await db.CanServeAsync(engineer, job.Asset!.Customer!.DealerId, ct))
            return Invalid("engineerUserId", "Choose an Edwards engineer or an engineer of the customer's dealer.");

        var name = await db.Users.Where(u => u.Id == engineer).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstAsync(ct);
        job.EngineerUserId = engineer;
        job.PlannedDate = input.PlannedDate ?? job.PlannedDate;
        if (job.Status == JobStatus.Open) job.Status = JobStatus.Assigned;
        job.Notes.Add(new JobNote { At = DateTime.UtcNow, UserId = user.UserId, Text = $"Assigned to {name}", StatusChangedTo = job.Status });
        await jobs.NotifyAssignedAsync(job, job.Asset, user, ct);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/notes")]
    [HasPermission(Permissions.JobsEdit)]
    public async Task<ActionResult<JobDetail>> AddNote(int id, JobNoteInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var job = await db.ServiceJobs.InScope(user).FirstOrDefaultAsync(j => j.Id == id, ct);
        if (job is null) return NotFound();
        if (job.Status is JobStatus.Completed or JobStatus.Closed) return StateConflict("Completed jobs cannot be updated.");
        if (input.Status is JobStatus to && to != job.Status)
        {
            var allowed = to switch
            {
                JobStatus.InProgress => job.EngineerUserId is not null && job.Status is JobStatus.Open or JobStatus.Assigned or JobStatus.OnHold,
                JobStatus.OnHold => job.Status == JobStatus.InProgress,
                _ => false,
            };
            if (!allowed) return StateConflict(to == JobStatus.InProgress && job.EngineerUserId is null
                ? "Assign an engineer before starting the job."
                : $"A job cannot move from {job.Status} to {to} here.");
            job.Status = to;
        }
        job.Notes.Add(new JobNote { At = DateTime.UtcNow, UserId = user.UserId, Text = input.Text.Trim(), StatusChangedTo = input.Status });
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/complete")]
    [HasPermission(Permissions.JobsEdit)]
    public async Task<ActionResult<JobDetail>> Complete(int id, CompleteJobInput input, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var job = await db.ServiceJobs.InScope(user).Include(j => j.Asset).ThenInclude(a => a!.Customer).FirstOrDefaultAsync(j => j.Id == id, ct);
        if (job is null) return NotFound();
        if (job.Status is not (JobStatus.Assigned or JobStatus.InProgress or JobStatus.OnHold))
            return StateConflict(job.Status == JobStatus.Open ? "Assign an engineer before completing the job." : "This job is already completed.");
        var date = input.VisitDate!.Value;
        if (date > DateOnly.FromDateTime(DateTime.Today)) return Invalid("visitDate", "The visit date cannot be in the future.");
        if (input.VisitType == ServiceVisitType.Commissioning) return Invalid("visitType", "Record commissioning from the Commissioning screen.");

        job.Status = JobStatus.Completed;
        job.CompletedAt = DateTime.UtcNow;
        job.CompletionReport = input.Report.Trim();
        job.Notes.Add(new JobNote { At = DateTime.UtcNow, UserId = user.UserId, Text = "Completed", StatusChangedTo = JobStatus.Completed });
        var a = job.Asset!;
        db.ServiceVisits.Add(new ServiceVisit
        {
            AssetId = a.Id,
            ServiceJobId = job.Id,
            Type = input.VisitType,
            EngineerUserId = job.EngineerUserId ?? user.UserId,
            VisitDate = date,
            CompletionDate = date,
            Completed = true,
            Remarks = job.CompletionReport,
        });

        // A preventive or AMC service restarts the service interval; a breakdown repair does not.
        a.LastServiceDate = a.LastServiceDate is DateOnly last && last > date ? last : date;
        if (input.VisitType is ServiceVisitType.PreventiveMaintenance or ServiceVisitType.Amc)
            a.NextServiceDate = date.AddMonths(a.ServiceIntervalMonths);
        db.LogAsset(a.Id, "Service", $"{input.VisitType.Label()} on {date:dd MMM yyyy} (job {job.Number})", $"/jobs/{job.Id}", user.UserId);

        var to = await recipients.CustomerTeamAsync(a.Customer!.DealerId, a.Customer.DealerUserId, [RoleDefaults.ServiceCoordinator], ct);
        await alerts.RaiseAsync(AlertType.JobCompleted, to.Where(x => x != user.UserId), $"Job {job.Number} completed",
            $"{a.Customer.Name}, {a.SerialNumber}\n{job.CompletionReport}", $"/jobs/{job.Id}", ct);
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }

    [HttpPost("{id:int}/close")]
    [HasPermission(Permissions.JobsAssign)]
    public async Task<ActionResult<JobDetail>> Close(int id, CancellationToken ct)
    {
        var user = await currentUser.RequireAsync(ct);
        var job = await db.ServiceJobs.InScope(user).FirstOrDefaultAsync(j => j.Id == id, ct);
        if (job is null) return NotFound();
        if (job.Status != JobStatus.Completed) return StateConflict("Only completed jobs can be closed.");
        job.Status = JobStatus.Closed;
        job.Notes.Add(new JobNote { At = DateTime.UtcNow, UserId = user.UserId, Text = "Closed after review", StatusChangedTo = JobStatus.Closed });
        await db.SaveChangesAsync(ct);
        return await Get(id, ct);
    }
}

/// <summary>Raises service jobs for the jobs screen and for service reminders.</summary>
public sealed class JobFactory(AppDbContext db, AlertService alerts)
{
    /// <summary>Creates a job and saves it, so it has its number and id. Alerts are saved by the caller.</summary>
    public async Task<ServiceJob> CreateAsync(Asset asset, string problem, JobPriority priority, JobSource source, DateOnly? planned,
        int? engineer, UserContext user, CancellationToken ct)
    {
        var job = new ServiceJob
        {
            Number = await db.NextJobNumberAsync(ct),
            AssetId = asset.Id,
            Problem = problem,
            Priority = priority,
            Source = source,
            PlannedDate = planned,
            EngineerUserId = engineer,
            Status = engineer is null ? JobStatus.Open : JobStatus.Assigned,
        };
        job.Notes.Add(new JobNote { At = DateTime.UtcNow, UserId = user.UserId, Text = "Job raised", StatusChangedTo = job.Status });
        db.ServiceJobs.Add(job);
        await db.SaveChangesAsync(ct);
        db.LogAsset(asset.Id, "Job", $"Job {job.Number} raised: {problem}", $"/jobs/{job.Id}", user.UserId);
        if (engineer is not null) await NotifyAssignedAsync(job, asset, user, ct);
        return job;
    }

    public async Task NotifyAssignedAsync(ServiceJob job, Asset asset, UserContext user, CancellationToken ct)
    {
        if (job.EngineerUserId is not int engineer || engineer == user.UserId) return;
        var customer = asset.Customer?.Name ?? await db.Customers.Where(c => c.Id == asset.CustomerId).Select(c => c.Name).FirstAsync(ct);
        await alerts.RaiseAsync(AlertType.JobAssigned, [engineer], $"Job {job.Number} assigned to you",
            $"{customer}, {asset.SiteName ?? asset.City}\n{asset.SerialNumber}: {job.Problem}"
                + (job.PlannedDate is DateOnly d ? $"\nPlanned for {d:dd MMM yyyy}." : ""), $"/jobs/{job.Id}", ct);
    }
}
