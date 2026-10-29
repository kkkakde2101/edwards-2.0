import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, Injectable, input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CustomerDetail, Option, P } from '../../core/models';
import { AssetDetail, AssetInput, AssetListItem, COVERAGE_LABELS, COVERAGE_PILL, JOB_STATUS_LABELS, JOB_STATUS_PILL, JobPriority } from '../../core/service-models';
import {
  addDays, controlError, daysFromToday, fieldErrors, formatDate, formatDateTime, formatMoney, LookupService, PagedList, problemMessage,
  todayIso, ToastService,
} from '../../core/support';
import { DocumentsPanel } from '../../shared/documents';
import { CustomerPicker } from '../../shared/pickers';
import { CanDirective, Modal, Pager } from '../../shared/ui';

interface AssetFilters {
  search: string;
  coverage: string;
  serviceDue: boolean;
  status: string;
  page: number;
}

const NO_FILTERS: AssetFilters = { search: '', coverage: '', serviceDue: false, status: 'active', page: 1 };

@Injectable({ providedIn: 'root' })
export class AssetListState {
  readonly filters = signal<AssetFilters>({ ...NO_FILTERS });
}

@Component({
  selector: 'app-asset-list',
  imports: [FormsModule, RouterLink, Pager, CanDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Assets</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Service</span><span>/</span><span>Assets</span></div>
      </div>
      <a *appCan="P.assetsCreate" class="btn btn-primary" routerLink="/assets/new"><i class="fa-solid fa-plus"></i> Register asset</a>
    </div>

    <form class="panel" (ngSubmit)="apply({ ...draft, page: 1 })">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="aq">Serial, model, customer or city</label>
          <input id="aq" name="q" class="input" type="search" [(ngModel)]="draft.search" placeholder="Type to search">
        </div>
        <div class="field">
          <label for="ac">Coverage</label>
          <select id="ac" name="ac" class="input" [(ngModel)]="draft.coverage">
            <option value="">All</option>
            <option value="warranty">In warranty</option>
            <option value="amc">Under AMC</option>
            <option value="ending">Ending in 60 days</option>
            <option value="expired">Not covered</option>
            <option value="none">No dates yet</option>
          </select>
        </div>
        <div class="field">
          <label for="ast">Status</label>
          <select id="ast" name="ast" class="input" [(ngModel)]="draft.status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <label class="check"><input type="checkbox" name="due" [(ngModel)]="draft.serviceDue"> Service due in 30 days</label>
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-primary">Search</button>
          <button type="button" class="btn btn-dark" (click)="draft = { ...noFilters }; apply({ ...noFilters })">Reset</button>
        </div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>Asset list @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      @if (list.error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ list.error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Serial number</th><th>Model</th><th>Customer</th><th>Dealer</th><th>City</th><th>Commissioned</th><th>Coverage</th><th>Next service</th><th>Engineer</th></tr></thead>
          <tbody>
            @for (a of list.result()?.items ?? []; track a.id) {
              <tr class="clickable" (click)="router.navigate(['/assets', a.id])">
                <td class="nowrap"><a [routerLink]="['/assets', a.id]" (click)="$event.stopPropagation()">{{ a.serialNumber }}</a> @if (!a.isActive) { <span class="pill pill-inactive">Inactive</span> }</td>
                <td>{{ a.model || '—' }}<div class="hint">{{ a.range }}</div></td>
                <td>{{ a.customer }}</td>
                <td>{{ a.dealer }}</td>
                <td>{{ a.city }}</td>
                <td class="nowrap">{{ date(a.commissioningDate) || '—' }}</td>
                <td><span [class]="'pill ' + coveragePill[a.coverage]">{{ coverage[a.coverage] }}</span>
                  @if (a.amcEnd || a.warrantyEnd) { <div class="hint">until {{ date(a.amcEnd && a.coverage.startsWith('Amc') ? a.amcEnd : a.warrantyEnd) }}</div> }</td>
                <td class="nowrap" [class.overdue]="(days(a.nextServiceDate) ?? 1) < 0">{{ date(a.nextServiceDate) || '—' }}</td>
                <td>{{ a.engineer || '—' }}</td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="9">{{ list.loading() ? 'Loading assets…' : 'No assets match these filters.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="apply({ ...state.filters(), page: $event })" /> }
    </section>
  `,
  styles: `.overdue { color: var(--edw-error); font-weight: 600; }`,
})
export class AssetList {
  protected readonly router = inject(Router);
  protected readonly state = inject(AssetListState);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly days = daysFromToday;
  protected readonly coverage = COVERAGE_LABELS;
  protected readonly coveragePill = COVERAGE_PILL;
  protected readonly noFilters = NO_FILTERS;
  protected readonly list = new PagedList<AssetListItem>(inject(HttpClient), '/api/assets', 'Assets could not be loaded.');
  protected draft: AssetFilters = { ...this.state.filters() };

  constructor() {
    this.apply(this.state.filters());
  }

  protected apply(f: AssetFilters): void {
    this.state.filters.set(f);
    this.list.load({ ...f, pageSize: 25 });
  }
}

@Component({
  selector: 'app-asset-form',
  imports: [ReactiveFormsModule, RouterLink, CustomerPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>{{ id() ? 'Edit asset' : 'Register asset' }}</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><a routerLink="/assets">Assets</a><span>/</span><span>{{ id() ? 'Edit' : 'New' }}</span></div>
      </div>
    </div>
    <form class="panel" [formGroup]="form" (ngSubmit)="save()" novalidate>
      <div class="panel-heading"><h3>Asset details</h3></div>
      <div class="panel-body">
        @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
        <div class="form-grid">
          <div class="field">
            <label for="aCustomer">Customer<span class="req">*</span></label>
            <app-customer-picker inputId="aCustomer" formControlName="customerId" [invalid]="!!err('customerId')" (picked)="customerPicked($event)" />
            @if (err('customerId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aRange">Product range<span class="req">*</span></label>
            <select id="aRange" class="input" formControlName="productRangeId" (change)="rangeChanged()" [class.invalid]="err('productRangeId')">
              <option [ngValue]="null">Choose…</option>
              @for (r of ranges(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }
            </select>
            @if (err('productRangeId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aModel">Product model<span class="req">*</span></label>
            <select id="aModel" class="input" formControlName="productModelId" [class.invalid]="err('productModelId')">
              <option [ngValue]="null">Choose…</option>
              @for (m of models(); track m.id) { <option [ngValue]="m.id">{{ m.name }}</option> }
            </select>
            @if (err('productModelId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aSerial">Serial number<span class="req">*</span></label>
            <input id="aSerial" class="input" maxlength="100" formControlName="serialNumber" [class.invalid]="err('serialNumber')">
            @if (err('serialNumber'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aSite">Site or unit</label>
            <input id="aSite" class="input" maxlength="200" formControlName="siteName" placeholder="Plant, building or line">
          </div>
          <div class="field">
            <label for="aCity">City<span class="req">*</span></label>
            <input id="aCity" class="input" maxlength="100" formControlName="city" [class.invalid]="err('city')">
            @if (err('city'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aPin">PIN code<span class="req">*</span></label>
            <input id="aPin" class="input" maxlength="6" inputmode="numeric" formControlName="pinCode" [class.invalid]="err('pinCode')">
            @if (err('pinCode'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aInterval">Service every (months)<span class="req">*</span></label>
            <input id="aInterval" class="input" type="number" min="1" max="24" formControlName="serviceIntervalMonths">
          </div>
          <div class="field">
            <label for="aEngineer">Service engineer</label>
            <select id="aEngineer" class="input" formControlName="engineerUserId" [class.invalid]="err('engineerUserId')">
              <option [ngValue]="null">Not assigned</option>
              @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
            </select>
            @if (err('engineerUserId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aOpp">Sold through</label>
            <select id="aOpp" class="input" formControlName="sourceOpportunityId" [class.invalid]="err('sourceOpportunityId')">
              <option [ngValue]="null">Not linked</option>
              @for (o of wonOpportunities(); track o.id) { <option [ngValue]="o.id">{{ o.name }}</option> }
            </select>
            @if (err('sourceOpportunityId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field wide">
            <label for="aDesc">Description</label>
            <input id="aDesc" class="input" maxlength="300" formControlName="description">
          </div>
        </div>

        <h4 class="sub-title">Already installed?</h4>
        <p class="hint">Fill these only for units installed before Edwards 2.0. New units get them when commissioning is completed.</p>
        <div class="form-grid">
          <div class="field">
            <label for="aComm">Commissioning date</label>
            <input id="aComm" class="input" type="date" [max]="today" formControlName="commissioningDate" [class.invalid]="err('commissioningDate')">
            @if (err('commissioningDate'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aWs">Warranty start</label>
            <input id="aWs" class="input" type="date" formControlName="warrantyStart" [class.invalid]="err('warrantyStart')">
            @if (err('warrantyStart'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aWe">Warranty end</label>
            <input id="aWe" class="input" type="date" formControlName="warrantyEnd" [class.invalid]="err('warrantyEnd')">
            <span class="hint">12 months from commissioning if empty.</span>
            @if (err('warrantyEnd'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aLast">Last service</label>
            <input id="aLast" class="input" type="date" [max]="today" formControlName="lastServiceDate" [class.invalid]="err('lastServiceDate')">
            @if (err('lastServiceDate'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="aNext">Next service</label>
            <input id="aNext" class="input" type="date" formControlName="nextServiceDate">
            <span class="hint">Worked out from the last service if empty.</span>
          </div>
        </div>
      </div>
      <div class="panel-footer">
        <a class="btn btn-light" [routerLink]="id() ? ['/assets', id()] : ['/assets']">Cancel</a>
        <button type="submit" class="btn btn-primary" [disabled]="busy()">Save asset</button>
      </div>
    </form>
  `,
  styles: `.sub-title { margin: 20px 0 4px; font-size: 15px; color: var(--edw-slate); }`,
})
export class AssetForm implements OnInit {
  readonly id = input<string>();
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly today = todayIso();
  protected readonly ranges = toSignal(this.lookups.master('product-ranges'), { initialValue: [] });
  protected readonly models = signal<Option[]>([]);
  protected readonly engineers = signal<Option[]>([]);
  protected readonly wonOpportunities = signal<Option[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly submitted = signal(false);
  private readonly server = signal<Record<string, string>>({});
  protected readonly form = inject(FormBuilder).group({
    customerId: [null as number | null, Validators.required],
    productRangeId: [null as number | null, Validators.required],
    productModelId: [null as number | null, Validators.required],
    serialNumber: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    description: [''],
    siteName: [''],
    city: ['', Validators.required],
    pinCode: ['', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]],
    serviceIntervalMonths: [6, [Validators.required, Validators.min(1), Validators.max(24)]],
    engineerUserId: [null as number | null],
    sourceOpportunityId: [null as number | null],
    commissioningDate: [null as string | null],
    warrantyStart: [null as string | null],
    warrantyEnd: [null as string | null],
    lastServiceDate: [null as string | null],
    nextServiceDate: [null as string | null],
  });

  ngOnInit(): void {
    const id = this.id();
    if (id) {
      this.http.get<AssetDetail>(`/api/assets/${id}`).subscribe({
        next: (a) => {
          this.form.patchValue({
            customerId: a.customerId, productRangeId: a.productRangeId, productModelId: a.productModelId, serialNumber: a.serialNumber,
            description: a.description ?? '', siteName: a.siteName ?? '', city: a.city, pinCode: a.pinCode,
            serviceIntervalMonths: a.serviceIntervalMonths, engineerUserId: a.engineerUserId, sourceOpportunityId: a.sourceOpportunityId,
            commissioningDate: a.commissioningDate, warrantyStart: a.warrantyStart, warrantyEnd: a.warrantyEnd,
            lastServiceDate: a.lastServiceDate, nextServiceDate: a.nextServiceDate,
          });
          this.form.controls.customerId.disable();
          if (a.productRangeId) this.lookups.productModels(a.productRangeId).subscribe((m) => this.models.set(m));
          this.loadCustomer(a.customerId, false);
        },
        error: (err: unknown) => this.error.set(problemMessage(err, 'This asset could not be loaded.')),
      });
      return;
    }
    const query = this.route.snapshot.queryParamMap;
    const customerId = Number(query.get('customerId')) || null;
    if (customerId) {
      this.form.controls.customerId.setValue(customerId);
      this.loadCustomer(customerId, true);
      this.form.controls.sourceOpportunityId.setValue(Number(query.get('opportunityId')) || null);
    }
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server(), { pattern: 'Enter a 6-digit PIN code.' });
  }

  protected customerPicked(c: Option | null): void {
    this.engineers.set([]);
    this.wonOpportunities.set([]);
    this.form.patchValue({ engineerUserId: null, sourceOpportunityId: null });
    if (c) this.loadCustomer(c.id, true);
  }

  protected rangeChanged(): void {
    this.form.controls.productModelId.setValue(null);
    const range = this.form.controls.productRangeId.value;
    if (range) this.lookups.productModels(range).subscribe((m) => this.models.set(m));
    else this.models.set([]);
  }

  protected save(): void {
    this.submitted.set(true);
    this.server.set({});
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body: AssetInput = {
      customerId: v.customerId, productRangeId: v.productRangeId, productModelId: v.productModelId, serialNumber: v.serialNumber!.trim(),
      description: v.description?.trim() || null, siteName: v.siteName?.trim() || null, city: v.city!.trim(), pinCode: v.pinCode!.trim(),
      serviceIntervalMonths: Number(v.serviceIntervalMonths) || 6, engineerUserId: v.engineerUserId, sourceOpportunityId: v.sourceOpportunityId,
      commissioningDate: v.commissioningDate || null, warrantyStart: v.warrantyStart || null, warrantyEnd: v.warrantyEnd || null,
      lastServiceDate: v.lastServiceDate || null, nextServiceDate: v.nextServiceDate || null,
    };
    const id = this.id();
    const request = id ? this.http.put<AssetDetail>(`/api/assets/${id}`, body) : this.http.post<AssetDetail>('/api/assets', body);
    this.busy.set(true);
    request.subscribe({
      next: (a) => {
        this.busy.set(false);
        this.toast.show(id ? 'Asset saved.' : `${a.serialNumber} registered.`);
        void this.router.navigate(['/assets', a.id]);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.server.set(fields);
        this.error.set(Object.keys(fields).length ? 'Some fields need attention.' : problemMessage(err, 'The asset could not be saved.'));
      },
    });
  }

  private loadCustomer(customerId: number, prefill: boolean): void {
    this.lookups.engineers(customerId).subscribe((list) => this.engineers.set(list));
    this.lookups.wonOpportunities(customerId).subscribe((list) => this.wonOpportunities.set(list));
    if (!prefill) return;
    this.http.get<CustomerDetail>(`/api/customers/${customerId}`).subscribe((c) => {
      if (!this.form.controls.city.value) this.form.controls.city.setValue(c.city ?? c.district ?? '');
      if (!this.form.controls.pinCode.value) this.form.controls.pinCode.setValue(c.pinCode);
    });
  }
}

@Component({
  selector: 'app-asset-view',
  imports: [FormsModule, RouterLink, CanDirective, Modal, DocumentsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="page-header"><h1>Asset</h1></div>
      <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div>
    } @else if (asset(); as a) {
      <div class="page-header">
        <div>
          <h1>{{ a.serialNumber }} <span class="muted">{{ a.productModel }}</span> <span [class]="'pill ' + coveragePill[a.coverage]">{{ coverage[a.coverage] }}</span>
            @if (!a.isActive) { <span class="pill pill-inactive">Inactive</span> }</h1>
          <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><a routerLink="/assets">Assets</a><span>/</span><span>{{ a.customer }}</span></div>
        </div>
        <div class="actions">
          <a class="btn btn-dark" routerLink="/assets"><i class="fa-solid fa-arrow-left"></i> Back</a>
          @if (a.actions?.edit) { <a class="btn btn-light" [routerLink]="['/assets', a.id, 'edit']"><i class="fa-solid fa-pen"></i> Edit</a> }
          @if (a.actions?.commission) { <button type="button" class="btn btn-light" (click)="openPlan()"><i class="fa-solid fa-play"></i> Plan commissioning</button> }
          @if (a.actions?.addAmc) { <button type="button" class="btn btn-light" (click)="openAmc(a)"><i class="fa-solid fa-file-contract"></i> Add AMC</button> }
          @if (a.actions?.raiseJob) { <button type="button" class="btn btn-primary" (click)="openJob()"><i class="fa-solid fa-screwdriver-wrench"></i> Raise service job</button> }
          @if (a.actions?.edit) {
            <button type="button" class="btn btn-light" (click)="setActive(!a.isActive)" [disabled]="busy()">{{ a.isActive ? 'Deactivate' : 'Reactivate' }}</button>
          }
        </div>
      </div>

      <section class="panel">
        <div class="panel-heading"><h3>Asset details</h3></div>
        <div class="panel-body">
          <dl class="details">
            <div><dt>Customer</dt><dd><a [routerLink]="['/customers', a.customerId]">{{ a.customer }}</a></dd></div>
            <div><dt>Dealer</dt><dd>{{ a.dealer }}</dd></div>
            <div><dt>Product</dt><dd>{{ a.productRange }} · {{ a.productModel }}</dd></div>
            <div><dt>Site</dt><dd>{{ a.siteName ? a.siteName + ', ' : '' }}{{ a.city }} {{ a.pinCode }}</dd></div>
            <div><dt>Commissioned</dt><dd>{{ date(a.commissioningDate) || 'Not yet' }}</dd></div>
            <div><dt>Warranty</dt><dd>@if (a.warrantyEnd) { {{ date(a.warrantyStart) }} – {{ date(a.warrantyEnd) }} } @else { — }</dd></div>
            <div><dt>AMC until</dt><dd>{{ date(a.amcEnd) || '—' }}</dd></div>
            <div><dt>Service engineer</dt><dd>{{ a.engineer || '—' }}</dd></div>
            <div><dt>Service interval</dt><dd>Every {{ a.serviceIntervalMonths }} months</dd></div>
            <div><dt>Last service</dt><dd>{{ date(a.lastServiceDate) || '—' }}</dd></div>
            <div><dt>Next service</dt><dd [class.overdue]="(days(a.nextServiceDate) ?? 1) < 0">{{ date(a.nextServiceDate) || '—' }}</dd></div>
            <div><dt>Sold through</dt><dd>@if (a.sourceOpportunityId) { <a [routerLink]="['/opportunities', a.sourceOpportunityId]">Opportunity {{ a.sourceOpportunityId }}</a> } @else { — }</dd></div>
            @if (a.description) { <div class="wide"><dt>Description</dt><dd>{{ a.description }}</dd></div> }
          </dl>
        </div>
      </section>

      <div class="two-col">
        <section class="panel">
          <div class="panel-heading"><h3>History <span class="count">{{ a.timeline.length }}</span></h3></div>
          <ol class="timeline">
            @for (e of a.timeline; track e.id) {
              <li>
                <span class="kind">{{ e.kind }}</span>
                <div>
                  @if (e.link) { <a [routerLink]="e.link">{{ e.text }}</a> } @else { {{ e.text }} }
                  <div class="hint">{{ dateTime(e.at) }}{{ e.by ? ' · ' + e.by : '' }}</div>
                </div>
              </li>
            } @empty { <li class="muted">No history yet.</li> }
          </ol>
        </section>
        <div>
          <section class="panel">
            <div class="panel-heading"><h3>Service jobs <span class="count">{{ a.jobs.length }}</span></h3></div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Job</th><th>Problem</th><th>Status</th><th>Raised</th></tr></thead>
                <tbody>
                  @for (j of a.jobs; track j.id) {
                    <tr><td class="nowrap"><a [routerLink]="['/jobs', j.id]">{{ j.number }}</a></td><td>{{ j.problem }}</td><td><span [class]="'pill ' + jobPill[j.status]">{{ jobStatus[j.status] }}</span></td><td class="nowrap">{{ date(j.createdAt) }}</td></tr>
                  } @empty { <tr class="empty"><td colspan="4">No jobs yet.</td></tr> }
                </tbody>
              </table>
            </div>
          </section>
          <section class="panel">
            <div class="panel-heading"><h3>AMC contracts <span class="count">{{ a.amc.length }}</span></h3></div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Period</th><th>Type</th><th class="num">Visits / year</th><th class="num">Value</th></tr></thead>
                <tbody>
                  @for (c of a.amc; track c.id) {
                    <tr [class.muted]="!c.isActive"><td class="nowrap">{{ date(c.startDate) }} – {{ date(c.endDate) }} @if (!c.isActive) { <span class="pill pill-inactive">Cancelled</span> }</td><td>{{ c.type || '—' }}</td><td class="num">{{ c.visitsPerYear }}</td><td class="num">{{ c.value !== null ? money(c.value) : '—' }}</td></tr>
                  } @empty { <tr class="empty"><td colspan="4">No AMC contracts.</td></tr> }
                </tbody>
              </table>
            </div>
          </section>
          @if (a.commissionings.length) {
            <section class="panel">
              <div class="panel-heading"><h3>Commissioning</h3></div>
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Planned</th><th>Status</th><th>Completed</th><th>Engineer</th></tr></thead>
                  <tbody>
                    @for (c of a.commissionings; track c.id) {
                      <tr><td class="nowrap">{{ date(c.plannedDate) }}</td><td>{{ c.status }}</td><td class="nowrap">{{ date(c.completedDate) || '—' }}</td><td>{{ c.engineer || '—' }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }
        </div>
      </div>

      <app-documents ownerType="Asset" [ownerId]="a.id" />

      @if (dialog() === 'job') {
        <app-modal title="Raise a service job" (closed)="dialog.set(null)">
          <form (ngSubmit)="raiseJob(a)">
            <div class="panel-body form-grid two">
              <div class="field full">
                <label for="jProblem">Problem reported<span class="req">*</span></label>
                <textarea id="jProblem" name="jProblem" class="input" rows="3" maxlength="1000" [(ngModel)]="job.problem"></textarea>
              </div>
              <div class="field">
                <label for="jPriority">Priority</label>
                <select id="jPriority" name="jPriority" class="input" [(ngModel)]="job.priority">
                  <option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
                </select>
              </div>
              <div class="field">
                <label for="jPlanned">Planned visit</label>
                <input id="jPlanned" name="jPlanned" class="input" type="date" [(ngModel)]="job.plannedDate">
              </div>
              <ng-container *appCan="P.jobsAssign">
                <div class="field full">
                  <label for="jEngineer">Engineer</label>
                  <select id="jEngineer" name="jEngineer" class="input" [(ngModel)]="job.engineerUserId">
                    <option [ngValue]="null">Assign later</option>
                    @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                  </select>
                </div>
              </ng-container>
              @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Raise job</button>
            </div>
          </form>
        </app-modal>
      }

      @if (dialog() === 'amc') {
        <app-modal title="Add an AMC contract" (closed)="dialog.set(null)">
          <form (ngSubmit)="saveAmc(a)">
            <div class="panel-body form-grid two">
              <div class="field">
                <label for="cType">AMC type</label>
                <select id="cType" name="cType" class="input" [(ngModel)]="amc.amcTypeId">
                  <option [ngValue]="null">Not set</option>
                  @for (t of amcTypes(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="cVisits">Visits a year</label>
                <input id="cVisits" name="cVisits" class="input" type="number" min="0" max="12" [(ngModel)]="amc.visitsPerYear">
              </div>
              <div class="field">
                <label for="cStart">Starts<span class="req">*</span></label>
                <input id="cStart" name="cStart" class="input" type="date" [(ngModel)]="amc.startDate">
              </div>
              <div class="field">
                <label for="cEnd">Ends<span class="req">*</span></label>
                <input id="cEnd" name="cEnd" class="input" type="date" [(ngModel)]="amc.endDate">
              </div>
              <div class="field">
                <label for="cValue">Contract value (₹)</label>
                <input id="cValue" name="cValue" class="input" type="number" min="0" [(ngModel)]="amc.value">
              </div>
              <div class="field full">
                <label for="cRemark">Remarks</label>
                <input id="cRemark" name="cRemark" class="input" maxlength="1000" [(ngModel)]="amc.remark">
              </div>
              @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Add contract</button>
            </div>
          </form>
        </app-modal>
      }

      @if (dialog() === 'plan') {
        <app-modal title="Plan commissioning" (closed)="dialog.set(null)">
          <form (ngSubmit)="plan(a)">
            <div class="panel-body form-grid two">
              <div class="field">
                <label for="pDate">Planned date<span class="req">*</span></label>
                <input id="pDate" name="pDate" class="input" type="date" [(ngModel)]="planForm.plannedDate">
              </div>
              <div class="field">
                <label for="pMonths">Warranty months</label>
                <input id="pMonths" name="pMonths" class="input" type="number" min="1" max="60" [(ngModel)]="planForm.warrantyMonths">
              </div>
              <div class="field full">
                <label for="pEngineer">Engineer</label>
                <select id="pEngineer" name="pEngineer" class="input" [(ngModel)]="planForm.engineerUserId">
                  <option [ngValue]="null">Assign later</option>
                  @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                </select>
              </div>
              @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Plan</button>
            </div>
          </form>
        </app-modal>
      }
    } @else {
      <div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading the asset…</div>
    }
  `,
  styles: `
    .two-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .timeline { list-style: none; margin: 0; padding: 8px 12px; max-height: 520px; overflow-y: auto; }
    .timeline li { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #eee; }
    .timeline .kind { flex: 0 0 100px; font-size: 12px; font-weight: 600; color: var(--edw-red-dark); text-transform: uppercase; letter-spacing: .03em; }
    .overdue { color: var(--edw-error); font-weight: 600; }
    @media (max-width: 991px) { .two-col { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AssetView implements OnInit {
  readonly id = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly dateTime = formatDateTime;
  protected readonly money = formatMoney;
  protected readonly days = daysFromToday;
  protected readonly coverage = COVERAGE_LABELS;
  protected readonly coveragePill = COVERAGE_PILL;
  protected readonly jobStatus = JOB_STATUS_LABELS;
  protected readonly jobPill = JOB_STATUS_PILL;
  protected readonly amcTypes = toSignal(this.lookups.master('amc-types'), { initialValue: [] });
  protected readonly asset = signal<AssetDetail | null>(null);
  protected readonly engineers = signal<Option[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly dialog = signal<'job' | 'amc' | 'plan' | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected job = { problem: '', priority: 'Medium' as JobPriority, plannedDate: '', engineerUserId: null as number | null };
  protected amc = { amcTypeId: null as number | null, startDate: todayIso(), endDate: addDays(todayIso(), 364), visitsPerYear: 2, value: null as number | null, remark: '' };
  protected planForm = { plannedDate: addDays(todayIso(), 7), warrantyMonths: 12, engineerUserId: null as number | null };

  ngOnInit(): void {
    this.load();
  }

  protected openJob(): void {
    this.job = { problem: '', priority: 'Medium', plannedDate: '', engineerUserId: this.asset()?.engineerUserId ?? null };
    this.loadEngineers();
    this.dialogError.set(null);
    this.dialog.set('job');
  }

  protected raiseJob(a: AssetDetail): void {
    if (this.job.problem.trim().length < 5) return this.dialogError.set('Describe the problem in a few words.');
    this.busy.set(true);
    this.http.post<{ id: number; number: string }>('/api/jobs', {
      assetId: a.id, problem: this.job.problem.trim(), priority: this.job.priority, plannedDate: this.job.plannedDate || null,
      engineerUserId: this.job.engineerUserId,
    }).subscribe({
      next: (j) => {
        this.busy.set(false);
        this.toast.show(`Job ${j.number} raised.`);
        void this.router.navigate(['/jobs', j.id]);
      },
      error: (err: unknown) => this.failed(err),
    });
  }

  protected openAmc(a: AssetDetail): void {
    const start = a.amcEnd && (daysFromToday(a.amcEnd) ?? 0) >= 0 ? addDays(a.amcEnd, 1)
      : a.warrantyEnd && (daysFromToday(a.warrantyEnd) ?? 0) >= 0 ? addDays(a.warrantyEnd, 1) : todayIso();
    this.amc = { amcTypeId: null, startDate: start, endDate: addDays(start, 364), visitsPerYear: 2, value: null, remark: '' };
    this.dialogError.set(null);
    this.dialog.set('amc');
  }

  protected saveAmc(a: AssetDetail): void {
    this.busy.set(true);
    this.http.post('/api/amc', { ...this.amc, assetId: a.id, remark: this.amc.remark.trim() || null }).subscribe({
      next: () => this.done('AMC contract added.'),
      error: (err: unknown) => this.failed(err),
    });
  }

  protected openPlan(): void {
    this.planForm = { plannedDate: addDays(todayIso(), 7), warrantyMonths: 12, engineerUserId: this.asset()?.engineerUserId ?? null };
    this.loadEngineers();
    this.dialogError.set(null);
    this.dialog.set('plan');
  }

  protected plan(a: AssetDetail): void {
    this.busy.set(true);
    this.http.post('/api/commissioning', { ...this.planForm, assetId: a.id }).subscribe({
      next: () => this.done('Commissioning planned.'),
      error: (err: unknown) => this.failed(err),
    });
  }

  protected setActive(active: boolean): void {
    this.busy.set(true);
    this.http.post<AssetDetail>(`/api/assets/${this.id()}/${active ? 'activate' : 'deactivate'}`, {}).subscribe({
      next: (a) => {
        this.busy.set(false);
        this.asset.set(a);
        this.toast.show(active ? 'Asset reactivated.' : 'Asset deactivated.');
      },
      error: (err: unknown) => this.failed(err),
    });
  }

  private loadEngineers(): void {
    const a = this.asset();
    if (a && !this.engineers().length) this.lookups.engineers(a.customerId).subscribe((list) => this.engineers.set(list));
  }

  private done(message: string): void {
    this.busy.set(false);
    this.dialog.set(null);
    this.toast.show(message);
    this.load();
  }

  private failed(err: unknown): void {
    this.busy.set(false);
    const message = Object.values(fieldErrors(err))[0] ?? problemMessage(err);
    if (this.dialog()) this.dialogError.set(message);
    else this.toast.show(message, 'error');
  }

  private load(): void {
    this.http.get<AssetDetail>(`/api/assets/${this.id()}`).subscribe({
      next: (a) => this.asset.set(a),
      error: (err: unknown) => this.error.set(problemMessage(err, 'This asset could not be loaded.')),
    });
  }
}
