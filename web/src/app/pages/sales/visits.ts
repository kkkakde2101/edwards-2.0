import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, Injectable, input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { CustomerDetail, Option, P } from '../../core/models';
import { LeadListItem, VisitDetail, VisitInput, VisitListItem } from '../../core/sales-models';
import { controlError, fieldErrors, formatDate, LookupService, PagedList, problemMessage, todayIso, ToastService } from '../../core/support';
import { CustomerPicker } from '../../shared/pickers';
import { CanDirective, Pager } from '../../shared/ui';

interface VisitFilters {
  search: string;
  dealerId: number | null;
  visitTypeId: number | null;
  from: string;
  to: string;
  page: number;
}

const NO_FILTERS: VisitFilters = { search: '', dealerId: null, visitTypeId: null, from: '', to: '', page: 1 };

@Injectable({ providedIn: 'root' })
export class VisitListState {
  readonly filters = signal<VisitFilters>({ ...NO_FILTERS });
}

@Component({
  selector: 'app-visit-list',
  imports: [FormsModule, RouterLink, Pager, CanDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Visits</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Sales</span><span>/</span><span>Visits</span></div>
      </div>
      <a *appCan="P.visitsCreate" class="btn btn-primary" routerLink="/visits/new"><i class="fa-solid fa-plus"></i> Record visit</a>
    </div>

    <form class="panel" (ngSubmit)="apply({ ...draft, page: 1 })">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="vq">Customer</label>
          <input id="vq" name="q" class="input" type="search" [(ngModel)]="draft.search" placeholder="Customer name">
        </div>
        <div class="field">
          <label for="vt">Visit type</label>
          <select id="vt" name="vt" class="input" [(ngModel)]="draft.visitTypeId">
            <option [ngValue]="null">All</option>
            @for (t of visitTypes(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="vd">Dealer</label>
          <select id="vd" name="vd" class="input" [(ngModel)]="draft.dealerId">
            <option [ngValue]="null">All</option>
            @for (d of dealers(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="vf">From</label>
          <input id="vf" name="vf" class="input" type="date" [(ngModel)]="draft.from">
        </div>
        <div class="field">
          <label for="vto">To</label>
          <input id="vto" name="vto" class="input" type="date" [(ngModel)]="draft.to">
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-primary">Search</button>
          <button type="button" class="btn btn-dark" (click)="draft = { ...noFilters }; apply({ ...noFilters })">Reset</button>
        </div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>Visit list @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      @if (list.error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ list.error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Date</th><th>Customer</th><th>Visit type</th><th>Dealer</th><th>Engineer</th><th>Application</th><th>Potential</th><th>Lead type</th><th>Product range</th><th>Lead</th><th class="num">Competitors</th></tr>
          </thead>
          <tbody>
            @for (v of list.result()?.items ?? []; track v.id) {
              <tr class="clickable" (click)="router.navigate(['/visits', v.id])">
                <td class="nowrap"><a [routerLink]="['/visits', v.id]" (click)="$event.stopPropagation()">{{ date(v.visitDate) }}</a></td>
                <td>{{ v.customer }}</td>
                <td>{{ v.visitType }}</td>
                <td>{{ v.dealer }}</td>
                <td>{{ v.dealerUser || '—' }}</td>
                <td>{{ v.application || '—' }}</td>
                <td>@if (v.hasPotential) { <span class="pill pill-active">Yes</span> } @else { <span class="muted">No</span> }</td>
                <td>{{ v.leadType || '—' }}</td>
                <td>{{ v.productRange || '—' }}</td>
                <td>@if (v.leadId) { <a [routerLink]="['/leads', v.leadId]" (click)="$event.stopPropagation()">Lead {{ v.leadId }}</a> } @else { — }</td>
                <td class="num">{{ v.competitors }}</td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="11">{{ list.loading() ? 'Loading visits…' : 'No visits match these filters.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="apply({ ...state.filters(), page: $event })" /> }
    </section>
  `,
})
export class VisitList {
  protected readonly router = inject(Router);
  protected readonly state = inject(VisitListState);
  private readonly lookups = inject(LookupService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly noFilters = NO_FILTERS;
  protected readonly list = new PagedList<VisitListItem>(inject(HttpClient), '/api/visits', 'Visits could not be loaded.');
  protected readonly visitTypes = toSignal(this.lookups.master('visit-types'), { initialValue: [] });
  protected readonly dealers = toSignal(this.lookups.dealers(), { initialValue: [] });
  protected draft: VisitFilters = { ...this.state.filters() };

  constructor() {
    this.apply(this.state.filters());
  }

  protected apply(f: VisitFilters): void {
    this.state.filters.set(f);
    this.list.load({ ...f, pageSize: 25 });
  }
}

@Component({
  selector: 'app-visit-form',
  imports: [ReactiveFormsModule, RouterLink, CustomerPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>{{ id() ? 'Edit visit' : 'Record visit' }}</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><a routerLink="/visits">Visits</a><span>/</span><span>{{ id() ? 'Edit' : 'New' }}</span></div>
      </div>
    </div>

    <form class="panel" [formGroup]="form" (ngSubmit)="save()" novalidate>
      <div class="panel-heading"><h3>Visit details</h3></div>
      <div class="panel-body">
        @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
        <div class="form-grid">
          <div class="field">
            <label for="visitDate">Visit date<span class="req">*</span></label>
            <input id="visitDate" class="input" type="date" [max]="today" formControlName="visitDate" [class.invalid]="err('visitDate')">
            @if (err('visitDate'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="visitTypeId">Visit type<span class="req">*</span></label>
            <select id="visitTypeId" class="input" formControlName="visitTypeId" [class.invalid]="err('visitTypeId')">
              <option [ngValue]="null">Choose…</option>
              @for (t of visitTypes(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
            </select>
            @if (err('visitTypeId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="customer">Customer<span class="req">*</span></label>
            <app-customer-picker inputId="customer" formControlName="customerId" [invalid]="!!err('customerId')" (picked)="customerPicked($event)" />
            @if (err('customerId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          @if (!ownScope) {
            <div class="field">
              <label for="dealerUserId">Dealer engineer<span class="req">*</span></label>
              <select id="dealerUserId" class="input" formControlName="dealerUserId" [class.invalid]="err('dealerUserId')">
                <option [ngValue]="null">Choose…</option>
                @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
              </select>
              @if (err('dealerUserId'); as m) { <span class="field-error">{{ m }}</span> }
            </div>
          }
          <div class="field">
            <label for="applicationId">Application<span class="req">*</span></label>
            <select id="applicationId" class="input" formControlName="applicationId" [class.invalid]="err('applicationId')">
              <option [ngValue]="null">Choose…</option>
              @for (a of applications(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
            </select>
            @if (err('applicationId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="customerProduct">Customer's end product</label>
            <input id="customerProduct" class="input" maxlength="100" formControlName="customerProduct">
          </div>
          <div class="field">
            <label for="leadTypeId">Lead type<span class="req">*</span></label>
            <select id="leadTypeId" class="input" formControlName="leadTypeId" [class.invalid]="err('leadTypeId')">
              <option [ngValue]="null">Choose…</option>
              @for (t of leadTypes(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
            </select>
            @if (err('leadTypeId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="productRangeId">Product range</label>
            <select id="productRangeId" class="input" formControlName="productRangeId" (change)="rangeChanged()">
              <option [ngValue]="null">Not known yet</option>
              @for (r of ranges(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="productModelId">Product model</label>
            <select id="productModelId" class="input" formControlName="productModelId" [class.invalid]="err('productModelId')">
              <option [ngValue]="null">Not known yet</option>
              @for (m of models(); track m.id) { <option [ngValue]="m.id">{{ m.name }}</option> }
            </select>
            @if (err('productModelId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          @if (openLeads().length) {
            <div class="field">
              <label for="leadId">Follow-up of lead</label>
              <select id="leadId" class="input" formControlName="leadId">
                <option [ngValue]="null">Not a follow-up</option>
                @for (l of openLeads(); track l.id) { <option [ngValue]="l.id">{{ l.name }}</option> }
              </select>
            </div>
          }
          <div class="field">
            <label>Sales potential</label>
            <label class="check"><input type="checkbox" formControlName="hasPotential"> The customer has a requirement</label>
            <span class="hint">A new lead or a video call with potential creates a lead automatically.</span>
          </div>
          <div class="field full">
            <label for="remark">Remarks</label>
            <textarea id="remark" class="input" rows="3" maxlength="2000" formControlName="remark"></textarea>
          </div>
        </div>

        <h4 class="sub-title">Competition seen at the customer</h4>
        <div class="table-wrap">
          <table class="table" formArrayName="competitors">
            <thead><tr><th>Make</th><th>Model</th><th class="num">Quantity</th><th class="num">Working</th><th class="num">Standby</th><th>Technology</th><th><span class="sr-only">Remove</span></th></tr></thead>
            <tbody>
              @for (row of competitors.controls; track row; let i = $index) {
                <tr [formGroupName]="i">
                  <td>
                    <select class="input" formControlName="competitionMakeId" [attr.aria-label]="'Make, line ' + (i + 1)">
                      <option [ngValue]="null">—</option>
                      @for (m of makes(); track m.id) { <option [ngValue]="m.id">{{ m.name }}</option> }
                    </select>
                  </td>
                  <td><input class="input" maxlength="100" formControlName="model" [attr.aria-label]="'Model, line ' + (i + 1)"></td>
                  <td><input class="input num" type="number" min="0" formControlName="quantity" [attr.aria-label]="'Quantity, line ' + (i + 1)"></td>
                  <td><input class="input num" type="number" min="0" formControlName="working" [attr.aria-label]="'Working, line ' + (i + 1)"></td>
                  <td><input class="input num" type="number" min="0" formControlName="standby" [attr.aria-label]="'Standby, line ' + (i + 1)"></td>
                  <td>
                    <select class="input" formControlName="pumpTechnologyId" [attr.aria-label]="'Technology, line ' + (i + 1)">
                      <option [ngValue]="null">—</option>
                      @for (t of technologies(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
                    </select>
                  </td>
                  <td class="row-actions"><button type="button" class="icon-btn" (click)="competitors.removeAt(i)" [attr.aria-label]="'Remove line ' + (i + 1)"><i class="fa-solid fa-xmark"></i></button></td>
                </tr>
              } @empty {
                <tr class="empty"><td colspan="7">No competitor pumps recorded.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <button type="button" class="btn btn-light btn-sm add-line" (click)="addCompetitor()"><i class="fa-solid fa-plus"></i> Add competitor line</button>
      </div>
      <div class="panel-footer">
        <a class="btn btn-light" [routerLink]="id() ? ['/visits', id()] : ['/visits']">Cancel</a>
        <button type="submit" class="btn btn-primary" [disabled]="busy()">Save visit</button>
      </div>
    </form>
  `,
  styles: `
    .sub-title { margin: 20px 0 8px; font-size: 15px; color: var(--edw-slate); }
    .add-line { margin-top: 8px; }
    .table .input { height: 30px; min-width: 90px; }
    .table .input.num { text-align: right; }
  `,
})
export class VisitForm implements OnInit {
  readonly id = input<string>();

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  private readonly fb = inject(FormBuilder);

  protected readonly today = todayIso();
  protected readonly ownScope = inject(AuthService).me()?.scope === 'Own';
  protected readonly visitTypes = toSignal(this.lookups.master('visit-types'), { initialValue: [] });
  protected readonly applications = toSignal(this.lookups.master('applications'), { initialValue: [] });
  protected readonly leadTypes = toSignal(this.lookups.master('lead-types'), { initialValue: [] });
  protected readonly ranges = toSignal(this.lookups.master('product-ranges'), { initialValue: [] });
  protected readonly makes = toSignal(this.lookups.master('competition-makes'), { initialValue: [] });
  protected readonly technologies = toSignal(this.lookups.master('pump-technologies'), { initialValue: [] });
  protected readonly models = signal<Option[]>([]);
  protected readonly engineers = signal<Option[]>([]);
  protected readonly openLeads = signal<LeadListItem[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly submitted = signal(false);
  private readonly server = signal<Record<string, string>>({});

  protected readonly form = this.fb.group({
    visitDate: [todayIso(), Validators.required],
    visitTypeId: [null as number | null, Validators.required],
    customerId: [null as number | null, Validators.required],
    dealerUserId: [null as number | null],
    applicationId: [null as number | null, Validators.required],
    customerProduct: [''],
    hasPotential: [false],
    leadTypeId: [null as number | null, Validators.required],
    productRangeId: [null as number | null],
    productModelId: [null as number | null],
    leadId: [null as number | null],
    remark: [''],
    competitors: this.fb.array<FormGroup>([]),
  });

  protected get competitors(): FormArray {
    return this.form.controls.competitors as FormArray;
  }

  ngOnInit(): void {
    if (!this.ownScope) this.form.controls.dealerUserId.addValidators(Validators.required);
    const id = this.id();
    if (!id) return;
    this.http.get<VisitDetail>(`/api/visits/${id}`).subscribe({
      next: (v) => {
        this.form.patchValue({
          visitDate: v.visitDate, visitTypeId: v.visitTypeId, customerId: v.customerId, dealerUserId: v.dealerUserId,
          applicationId: v.applicationId, customerProduct: v.customerProduct ?? '', hasPotential: v.hasPotential, leadTypeId: v.leadTypeId,
          productRangeId: v.productRangeId, productModelId: v.productModelId, leadId: v.leadId, remark: v.remark ?? '',
        });
        for (const c of v.competitors) this.competitors.push(this.competitorGroup(c));
        if (v.productRangeId) this.lookups.productModels(v.productRangeId).subscribe((m) => this.models.set(m));
        this.loadCustomerContext(v.customerId, false);
      },
      error: (err: unknown) => this.error.set(problemMessage(err, 'This visit could not be loaded.')),
    });
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server(), { required: 'This field is required.' });
  }

  protected customerPicked(customer: Option | null): void {
    this.engineers.set([]);
    this.openLeads.set([]);
    this.form.patchValue({ dealerUserId: null, leadId: null });
    if (customer) this.loadCustomerContext(customer.id, true);
  }

  protected rangeChanged(): void {
    this.form.controls.productModelId.setValue(null);
    const range = this.form.controls.productRangeId.value;
    if (range) this.lookups.productModels(range).subscribe((m) => this.models.set(m));
    else this.models.set([]);
  }

  protected addCompetitor(): void {
    this.competitors.push(this.competitorGroup());
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
    const body: VisitInput = {
      visitDate: v.visitDate!, visitTypeId: v.visitTypeId, customerId: v.customerId, dealerUserId: v.dealerUserId,
      applicationId: v.applicationId, customerProduct: v.customerProduct?.trim() || null, hasPotential: !!v.hasPotential,
      leadTypeId: v.leadTypeId, productRangeId: v.productRangeId, productModelId: v.productModelId, remark: v.remark?.trim() || null,
      leadId: v.leadId,
      competitors: (v.competitors as VisitInput['competitors']).map((c) => ({
        ...c, quantity: c.quantity ?? null, working: c.working ?? null, standby: c.standby ?? null, model: c.model?.trim() || null,
      })),
    };
    const id = this.id();
    const request = id ? this.http.put<VisitDetail>(`/api/visits/${id}`, body) : this.http.post<VisitDetail>('/api/visits', body);
    this.busy.set(true);
    request.subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.toast.show(!id && saved.leadId ? 'Visit saved. A lead was created for the sales team.' : 'Visit saved.');
        void this.router.navigate(['/visits', saved.id]);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.server.set(fields);
        this.error.set(Object.keys(fields).length ? 'Some fields need attention.' : problemMessage(err, 'The visit could not be saved.'));
      },
    });
  }

  private competitorGroup(c?: VisitDetail['competitors'][number]) {
    return this.fb.group({
      competitionMakeId: [c?.competitionMakeId ?? null as number | null],
      model: [c?.model ?? ''],
      quantity: [c?.quantity ?? null as number | null, Validators.min(0)],
      working: [c?.working ?? null as number | null, Validators.min(0)],
      standby: [c?.standby ?? null as number | null, Validators.min(0)],
      pumpTechnologyId: [c?.pumpTechnologyId ?? null as number | null],
    });
  }

  /** Engineers of the customer's dealer, and the customer's open leads for follow-up visits. */
  private loadCustomerContext(customerId: number, setDefaultEngineer: boolean): void {
    if (!this.ownScope) {
      this.http.get<CustomerDetail>(`/api/customers/${customerId}`).subscribe((c) => {
        this.lookups.dealerUsers(c.dealerId).subscribe((list) => {
          this.engineers.set(list);
          if (setDefaultEngineer && c.dealerUserId && list.some((u) => u.id === c.dealerUserId)) {
            this.form.controls.dealerUserId.setValue(c.dealerUserId);
          }
        });
      });
    }
    this.http.get<{ items: LeadListItem[] }>('/api/leads', { params: { customerId, pageSize: 50 } }).subscribe((r) =>
      this.openLeads.set(r.items.filter((l) => l.status === 'New' || l.status === 'Qualified' || l.id === this.form.controls.leadId.value)),
    );
  }
}

@Component({
  selector: 'app-visit-view',
  imports: [RouterLink, CanDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="page-header"><h1>Visit</h1></div>
      <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div>
    } @else if (visit(); as v) {
      <div class="page-header">
        <div>
          <h1>Visit on {{ date(v.visitDate) }}</h1>
          <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><a routerLink="/visits">Visits</a><span>/</span><span>{{ v.customer }}</span></div>
        </div>
        <div class="actions">
          <a class="btn btn-dark" routerLink="/visits"><i class="fa-solid fa-arrow-left"></i> Back</a>
          <a *appCan="P.visitsEdit" class="btn btn-primary" [routerLink]="['/visits', v.id, 'edit']"><i class="fa-solid fa-pen"></i> Edit</a>
        </div>
      </div>
      <section class="panel">
        <div class="panel-heading"><h3>Visit details</h3></div>
        <div class="panel-body">
          <dl class="details">
            <div><dt>Customer</dt><dd><a [routerLink]="['/customers', v.customerId]">{{ v.customer }}</a></dd></div>
            <div><dt>Visit type</dt><dd>{{ v.visitType }}</dd></div>
            <div><dt>Dealer</dt><dd>{{ v.dealer }}</dd></div>
            <div><dt>Engineer</dt><dd>{{ v.dealerUser || '—' }}</dd></div>
            <div><dt>Application</dt><dd>{{ v.application || '—' }}</dd></div>
            <div><dt>Customer's end product</dt><dd>{{ v.customerProduct || '—' }}</dd></div>
            <div><dt>Lead type</dt><dd>{{ v.leadType || '—' }}</dd></div>
            <div><dt>Sales potential</dt><dd>{{ v.hasPotential ? 'Yes' : 'No' }}</dd></div>
            <div><dt>Product range</dt><dd>{{ v.productRange || '—' }}</dd></div>
            <div><dt>Product model</dt><dd>{{ v.productModel || '—' }}</dd></div>
            <div class="wide"><dt>Lead</dt><dd>@if (v.leadId) { <a [routerLink]="['/leads', v.leadId]">{{ v.lead }}</a> } @else { — }</dd></div>
            <div class="wide"><dt>Remarks</dt><dd>{{ v.remark || '—' }}</dd></div>
          </dl>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h3>Competition <span class="count">{{ v.competitors.length }}</span></h3></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Make</th><th>Model</th><th class="num">Quantity</th><th class="num">Working</th><th class="num">Standby</th><th>Technology</th></tr></thead>
            <tbody>
              @for (c of v.competitors; track $index) {
                <tr><td>{{ c.competitionMake || '—' }}</td><td>{{ c.model || '—' }}</td><td class="num">{{ c.quantity ?? '—' }}</td><td class="num">{{ c.working ?? '—' }}</td><td class="num">{{ c.standby ?? '—' }}</td><td>{{ c.pumpTechnology || '—' }}</td></tr>
              } @empty {
                <tr class="empty"><td colspan="6">No competitor pumps recorded.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else {
      <div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading the visit…</div>
    }
  `,
})
export class VisitView implements OnInit {
  readonly id = input.required<string>();
  private readonly http = inject(HttpClient);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly visit = signal<VisitDetail | null>(null);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.http.get<VisitDetail>(`/api/visits/${this.id()}`).subscribe({
      next: (v) => this.visit.set(v),
      error: (err: unknown) => this.error.set(problemMessage(err, 'This visit could not be loaded.')),
    });
  }
}

