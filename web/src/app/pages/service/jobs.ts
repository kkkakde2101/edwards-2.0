import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, Injectable, input, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Option, P } from '../../core/models';
import {
  JOB_STATUS_LABELS, JOB_STATUS_PILL, JobDetail, JobListItem, JobPriority, JobStatus, ServiceVisitType, VISIT_TYPE_LABELS,
} from '../../core/service-models';
import { fieldErrors, formatDate, formatDateTime, LookupService, PagedList, problemMessage, todayIso, ToastService } from '../../core/support';
import { DocumentsPanel } from '../../shared/documents';
import { CustomerPicker } from '../../shared/pickers';
import { CanDirective, Modal, Pager } from '../../shared/ui';

const PRIORITY_PILL: Record<JobPriority, string> = { High: 'pill-red', Medium: 'pill-warn', Low: 'pill-inactive' };

interface JobFilters {
  search: string;
  status: string;
  priority: JobPriority | null;
  page: number;
}

const NO_FILTERS: JobFilters = { search: '', status: 'open', priority: null, page: 1 };

@Injectable({ providedIn: 'root' })
export class JobListState {
  readonly filters = signal<JobFilters>({ ...NO_FILTERS });
}

@Component({
  selector: 'app-job-list',
  imports: [FormsModule, ReactiveFormsModule, RouterLink, Pager, CanDirective, Modal, CustomerPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Service jobs</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Service</span><span>/</span><span>Service jobs</span></div>
      </div>
      <button *appCan="P.jobsCreate" type="button" class="btn btn-primary" (click)="openNew()"><i class="fa-solid fa-plus"></i> Raise job</button>
    </div>

    <form class="panel" (ngSubmit)="apply({ ...draft, page: 1 })">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="jq">Job, serial, customer or problem</label>
          <input id="jq" name="q" class="input" type="search" [(ngModel)]="draft.search" placeholder="Type to search">
        </div>
        <div class="field">
          <label for="js">Status</label>
          <select id="js" name="js" class="input" [(ngModel)]="draft.status">
            <option value="open">Open work</option>
            <option value="">All</option>
            @for (s of statuses; track s) { <option [value]="s">{{ statusLabel[s] }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="jp">Priority</label>
          <select id="jp" name="jp" class="input" [(ngModel)]="draft.priority">
            <option [ngValue]="null">All</option>
            <option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
          </select>
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-primary">Search</button>
          <button type="button" class="btn btn-dark" (click)="draft = { ...noFilters }; apply({ ...noFilters })">Reset</button>
        </div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>Job list @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      @if (list.error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ list.error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Job</th><th>Asset</th><th>Customer</th><th>Problem</th><th>Priority</th><th>Status</th><th>Engineer</th><th>Planned</th><th>Raised</th></tr></thead>
          <tbody>
            @for (j of list.result()?.items ?? []; track j.id) {
              <tr class="clickable" (click)="router.navigate(['/jobs', j.id])">
                <td class="nowrap"><a [routerLink]="['/jobs', j.id]" (click)="$event.stopPropagation()">{{ j.number }}</a><div class="hint">{{ j.source }}</div></td>
                <td>{{ j.serialNumber }}<div class="hint">{{ j.model }}</div></td>
                <td>{{ j.customer }}<div class="hint">{{ j.city }}</div></td>
                <td>{{ j.problem }}</td>
                <td><span [class]="'pill ' + priorityPill[j.priority]">{{ j.priority }}</span></td>
                <td><span [class]="'pill ' + statusPill[j.status]">{{ statusLabel[j.status] }}</span></td>
                <td>{{ j.engineer || '—' }}</td>
                <td class="nowrap">{{ date(j.plannedDate) || '—' }}</td>
                <td class="nowrap">{{ date(j.createdAt) }}</td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="9">{{ list.loading() ? 'Loading jobs…' : 'No jobs match these filters.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="apply({ ...state.filters(), page: $event })" /> }
    </section>

    @if (creating()) {
      <app-modal title="Raise a service job" (closed)="creating.set(false)">
        <form (ngSubmit)="create()">
          <div class="panel-body form-grid two">
            <div class="field full">
              <label for="nCustomer">Customer<span class="req">*</span></label>
              <app-customer-picker inputId="nCustomer" (picked)="customerPicked($event)" />
            </div>
            <div class="field full">
              <label for="nAsset">Asset<span class="req">*</span></label>
              <select id="nAsset" name="nAsset" class="input" [(ngModel)]="form.assetId">
                <option [ngValue]="null">Choose…</option>
                @for (a of assets(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
              </select>
              @if (customerChosen() && !assets().length) { <span class="hint">This customer has no registered assets. Register the asset first.</span> }
            </div>
            <div class="field full">
              <label for="nProblem">Problem reported<span class="req">*</span></label>
              <textarea id="nProblem" name="nProblem" class="input" rows="3" maxlength="1000" [(ngModel)]="form.problem"></textarea>
            </div>
            <div class="field">
              <label for="nPriority">Priority</label>
              <select id="nPriority" name="nPriority" class="input" [(ngModel)]="form.priority">
                <option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
              </select>
            </div>
            <div class="field">
              <label for="nPlanned">Planned visit</label>
              <input id="nPlanned" name="nPlanned" class="input" type="date" [(ngModel)]="form.plannedDate">
            </div>
            <ng-container *appCan="P.jobsAssign">
              <div class="field full">
                <label for="nEngineer">Engineer</label>
                <select id="nEngineer" name="nEngineer" class="input" [(ngModel)]="form.engineerUserId">
                  <option [ngValue]="null">Assign later</option>
                  @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                </select>
              </div>
            </ng-container>
            @if (formError()) { <div class="field full"><span class="field-error">{{ formError() }}</span></div> }
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="creating.set(false)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Raise job</button>
          </div>
        </form>
      </app-modal>
    }
  `,
})
export class JobList {
  protected readonly router = inject(Router);
  protected readonly state = inject(JobListState);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly statusLabel = JOB_STATUS_LABELS;
  protected readonly statusPill = JOB_STATUS_PILL;
  protected readonly priorityPill = PRIORITY_PILL;
  protected readonly statuses: JobStatus[] = ['Open', 'Assigned', 'InProgress', 'OnHold', 'Completed', 'Closed'];
  protected readonly noFilters = NO_FILTERS;
  protected readonly list = new PagedList<JobListItem>(this.http, '/api/jobs', 'Jobs could not be loaded.');
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly customerChosen = signal(false);
  protected readonly assets = signal<Option[]>([]);
  protected readonly engineers = signal<Option[]>([]);
  protected draft: JobFilters = { ...this.state.filters() };
  protected form = { assetId: null as number | null, problem: '', priority: 'Medium' as JobPriority, plannedDate: '', engineerUserId: null as number | null };

  constructor() {
    this.apply(this.state.filters());
  }

  protected apply(f: JobFilters): void {
    this.state.filters.set(f);
    this.list.load({ ...f, pageSize: 25 });
  }

  protected openNew(): void {
    this.form = { assetId: null, problem: '', priority: 'Medium', plannedDate: '', engineerUserId: null };
    this.assets.set([]);
    this.engineers.set([]);
    this.customerChosen.set(false);
    this.formError.set(null);
    this.creating.set(true);
  }

  protected customerPicked(c: Option | null): void {
    this.form.assetId = null;
    this.customerChosen.set(!!c);
    this.assets.set([]);
    this.engineers.set([]);
    if (!c) return;
    this.lookups.customerAssets(c.id).subscribe((a) => this.assets.set(a));
    this.lookups.engineers(c.id).subscribe((u) => this.engineers.set(u));
  }

  protected create(): void {
    if (!this.form.assetId) return this.formError.set('Choose the asset.');
    if (this.form.problem.trim().length < 5) return this.formError.set('Describe the problem in a few words.');
    this.busy.set(true);
    this.http.post<JobDetail>('/api/jobs', { ...this.form, problem: this.form.problem.trim(), plannedDate: this.form.plannedDate || null }).subscribe({
      next: (j) => {
        this.busy.set(false);
        this.creating.set(false);
        this.toast.show(`Job ${j.number} raised.`);
        void this.router.navigate(['/jobs', j.id]);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.formError.set(Object.values(fieldErrors(err))[0] ?? problemMessage(err));
      },
    });
  }
}

@Component({
  selector: 'app-job-view',
  imports: [FormsModule, RouterLink, Modal, DocumentsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="page-header"><h1>Service job</h1></div>
      <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div>
    } @else if (job(); as j) {
      <div class="page-header">
        <div>
          <h1>{{ j.number }} <span [class]="'pill ' + statusPill[j.status]">{{ statusLabel[j.status] }}</span> <span [class]="'pill ' + priorityPill[j.priority]">{{ j.priority }}</span></h1>
          <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><a routerLink="/jobs">Service jobs</a><span>/</span><span>{{ j.customer }}</span></div>
        </div>
        <div class="actions">
          <a class="btn btn-dark" routerLink="/jobs"><i class="fa-solid fa-arrow-left"></i> Back</a>
          @if (j.actions?.assign) { <button type="button" class="btn btn-light" (click)="openAssign(j)"><i class="fa-solid fa-user-gear"></i> {{ j.engineerUserId ? 'Reassign' : 'Assign engineer' }}</button> }
          @if (j.actions?.start) { <button type="button" class="btn btn-light" (click)="openNote('InProgress')"><i class="fa-solid fa-play"></i> Start</button> }
          @if (j.actions?.hold) { <button type="button" class="btn btn-light" (click)="openNote('OnHold')"><i class="fa-solid fa-pause"></i> Put on hold</button> }
          @if (j.actions?.complete) { <button type="button" class="btn btn-primary" (click)="openComplete()"><i class="fa-solid fa-check"></i> Complete</button> }
          @if (j.actions?.close) { <button type="button" class="btn btn-primary" (click)="close()" [disabled]="busy()"><i class="fa-solid fa-lock"></i> Close job</button> }
        </div>
      </div>

      <section class="panel">
        <div class="panel-heading"><h3>Job details</h3></div>
        <div class="panel-body">
          <dl class="details">
            <div><dt>Asset</dt><dd><a [routerLink]="['/assets', j.assetId]">{{ j.serialNumber }}</a> · {{ j.model || '—' }}</dd></div>
            <div><dt>Customer</dt><dd><a [routerLink]="['/customers', j.customerId]">{{ j.customer }}</a></dd></div>
            <div><dt>Site</dt><dd>{{ j.siteName ? j.siteName + ', ' : '' }}{{ j.city }}</dd></div>
            <div><dt>Dealer</dt><dd>{{ j.dealer }}</dd></div>
            <div><dt>Engineer</dt><dd>{{ j.engineer || 'Not assigned' }}</dd></div>
            <div><dt>Planned visit</dt><dd>{{ date(j.plannedDate) || '—' }}</dd></div>
            <div><dt>Source</dt><dd>{{ j.source }} @if (j.reminderId) { (service reminder) } @if (j.opportunityId) { · <a [routerLink]="['/opportunities', j.opportunityId]">opportunity</a> }</dd></div>
            <div><dt>Raised</dt><dd>{{ dateTime(j.createdAt) }}</dd></div>
            <div class="wide"><dt>Problem</dt><dd>{{ j.problem }}</dd></div>
            @if (j.completionReport) { <div class="wide"><dt>Completion report</dt><dd>{{ j.completionReport }} <span class="hint">({{ dateTime(j.completedAt) }})</span></dd></div> }
          </dl>
        </div>
      </section>

      <div class="two-col">
        <section class="panel">
          <div class="panel-heading">
            <h3>Progress notes <span class="count">{{ j.notes.length }}</span></h3>
            @if (j.actions?.edit) { <button type="button" class="btn btn-light btn-sm" (click)="openNote(null)"><i class="fa-solid fa-plus"></i> Add note</button> }
          </div>
          <ol class="timeline">
            @for (n of j.notes; track n.id) {
              <li>
                {{ n.text }} @if (n.statusChangedTo) { <span [class]="'pill ' + statusPill[n.statusChangedTo]">{{ statusLabel[n.statusChangedTo] }}</span> }
                <div class="hint">{{ dateTime(n.at) }}{{ n.by ? ' · ' + n.by : '' }}</div>
              </li>
            }
          </ol>
        </section>
        <section class="panel">
          <div class="panel-heading"><h3>Service visits <span class="count">{{ j.visits.length }}</span></h3></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Date</th><th>Type</th><th>Engineer</th><th>Remarks</th></tr></thead>
              <tbody>
                @for (v of j.visits; track v.id) {
                  <tr><td class="nowrap">{{ date(v.visitDate) }}</td><td>{{ visitLabel[v.type] }}</td><td>{{ v.engineer || '—' }}</td><td>{{ v.remarks || '—' }}</td></tr>
                } @empty { <tr class="empty"><td colspan="4">No visits recorded yet.</td></tr> }
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <app-documents ownerType="ServiceJob" [ownerId]="j.id" />

      @if (dialog() === 'assign') {
        <app-modal title="Assign an engineer" (closed)="dialog.set(null)">
          <form (ngSubmit)="assign()">
            <div class="panel-body form-grid two">
              <div class="field full">
                <label for="eEngineer">Engineer<span class="req">*</span></label>
                <select id="eEngineer" name="eEngineer" class="input" [(ngModel)]="assignForm.engineerUserId">
                  <option [ngValue]="null">Choose…</option>
                  @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="ePlanned">Planned visit</label>
                <input id="ePlanned" name="ePlanned" class="input" type="date" [(ngModel)]="assignForm.plannedDate">
              </div>
              @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Assign</button>
            </div>
          </form>
        </app-modal>
      }

      @if (dialog() === 'note') {
        <app-modal [title]="noteStatus === 'InProgress' ? 'Start the job' : noteStatus === 'OnHold' ? 'Put the job on hold' : 'Add a note'" (closed)="dialog.set(null)">
          <form (ngSubmit)="saveNote()">
            <div class="panel-body">
              <div class="field">
                <label for="nText">{{ noteStatus === 'OnHold' ? 'Why is it on hold?' : 'Note' }}<span class="req">*</span></label>
                <textarea id="nText" name="nText" class="input" rows="3" maxlength="2000" [(ngModel)]="noteText"></textarea>
                @if (dialogError()) { <span class="field-error">{{ dialogError() }}</span> }
              </div>
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Save</button>
            </div>
          </form>
        </app-modal>
      }

      @if (dialog() === 'complete') {
        <app-modal title="Complete the job" (closed)="dialog.set(null)">
          <form (ngSubmit)="complete()">
            <div class="panel-body form-grid two">
              <div class="field">
                <label for="cDate">Visit date<span class="req">*</span></label>
                <input id="cDate" name="cDate" class="input" type="date" [max]="today" [(ngModel)]="completeForm.visitDate">
              </div>
              <div class="field">
                <label for="cType">Work done<span class="req">*</span></label>
                <select id="cType" name="cType" class="input" [(ngModel)]="completeForm.visitType">
                  @for (t of completionTypes; track t) { <option [value]="t">{{ visitLabel[t] }}</option> }
                </select>
              </div>
              <div class="field full">
                <label for="cReport">Completion report<span class="req">*</span></label>
                <textarea id="cReport" name="cReport" class="input" rows="4" maxlength="2000" [(ngModel)]="completeForm.report"></textarea>
                <span class="hint">A preventive or AMC service restarts the service interval for the asset.</span>
              </div>
              @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Complete job</button>
            </div>
          </form>
        </app-modal>
      }
    } @else {
      <div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading the job…</div>
    }
  `,
  styles: `
    .two-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .timeline { list-style: none; margin: 0; padding: 8px 12px; max-height: 420px; overflow-y: auto; }
    .timeline li { padding: 8px 0; border-bottom: 1px solid #eee; }
    @media (max-width: 991px) { .two-col { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class JobView implements OnInit {
  readonly id = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly date = formatDate;
  protected readonly dateTime = formatDateTime;
  protected readonly today = todayIso();
  protected readonly statusLabel = JOB_STATUS_LABELS;
  protected readonly statusPill = JOB_STATUS_PILL;
  protected readonly priorityPill = PRIORITY_PILL;
  protected readonly visitLabel = VISIT_TYPE_LABELS;
  protected readonly completionTypes: ServiceVisitType[] = ['Breakdown', 'PreventiveMaintenance', 'Amc', 'Installation', 'Other'];
  protected readonly job = signal<JobDetail | null>(null);
  protected readonly engineers = signal<Option[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly dialog = signal<'assign' | 'note' | 'complete' | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected assignForm = { engineerUserId: null as number | null, plannedDate: '' };
  protected noteStatus: JobStatus | null = null;
  protected noteText = '';
  protected completeForm = { visitDate: todayIso(), visitType: 'Breakdown' as ServiceVisitType, report: '' };

  ngOnInit(): void {
    this.load();
  }

  protected openAssign(j: JobDetail): void {
    this.assignForm = { engineerUserId: j.engineerUserId, plannedDate: j.plannedDate ?? '' };
    if (!this.engineers().length) this.lookups.engineers(j.customerId).subscribe((u) => this.engineers.set(u));
    this.dialogError.set(null);
    this.dialog.set('assign');
  }

  protected assign(): void {
    if (!this.assignForm.engineerUserId) return this.dialogError.set('Choose the engineer.');
    this.post('assign', { engineerUserId: this.assignForm.engineerUserId, plannedDate: this.assignForm.plannedDate || null }, 'Engineer assigned.');
  }

  protected openNote(status: JobStatus | null): void {
    this.noteStatus = status;
    this.noteText = status === 'InProgress' ? 'Work started' : '';
    this.dialogError.set(null);
    this.dialog.set('note');
  }

  protected saveNote(): void {
    if (this.noteText.trim().length < 2) return this.dialogError.set('Write a short note.');
    const done = this.noteStatus ? `Job is now ${JOB_STATUS_LABELS[this.noteStatus].toLowerCase()}.` : 'Note added.';
    this.post('notes', { text: this.noteText.trim(), status: this.noteStatus }, done);
  }

  protected openComplete(): void {
    this.completeForm = { visitDate: todayIso(), visitType: this.job()?.source === 'Reminder' ? 'PreventiveMaintenance' : 'Breakdown', report: '' };
    this.dialogError.set(null);
    this.dialog.set('complete');
  }

  protected complete(): void {
    if (this.completeForm.report.trim().length < 5) return this.dialogError.set('Describe the work done.');
    this.post('complete', { ...this.completeForm, report: this.completeForm.report.trim() }, 'Job completed.');
  }

  protected close(): void {
    this.post('close', {}, 'Job closed.');
  }

  private post(action: string, body: object, done: string): void {
    this.busy.set(true);
    this.dialogError.set(null);
    this.http.post<JobDetail>(`/api/jobs/${this.id()}/${action}`, body).subscribe({
      next: (j) => {
        this.busy.set(false);
        this.dialog.set(null);
        this.job.set(j);
        this.toast.show(done);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const message = Object.values(fieldErrors(err))[0] ?? problemMessage(err);
        if (this.dialog()) this.dialogError.set(message);
        else this.toast.show(message, 'error');
      },
    });
  }

  private load(): void {
    this.http.get<JobDetail>(`/api/jobs/${this.id()}`).subscribe({
      next: (j) => this.job.set(j),
      error: (err: unknown) => this.error.set(problemMessage(err, 'This job could not be loaded.')),
    });
  }
}
