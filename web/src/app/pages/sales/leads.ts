import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, Injectable, input, OnInit, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { CustomerDetail, Option, P } from '../../core/models';
import { LEAD_PILL, LeadDetail, LeadListItem, LeadSource, LeadStatus, OpportunityType } from '../../core/sales-models';
import { addDays, controlError, fieldErrors, formatDate, LookupService, PagedList, problemMessage, todayIso, ToastService } from '../../core/support';
import { CustomerPicker } from '../../shared/pickers';
import { CanDirective, Modal, Pager } from '../../shared/ui';

interface LeadFilters {
  search: string;
  status: LeadStatus | null;
  source: LeadSource | null;
  dealerId: number | null;
  page: number;
}

const NO_FILTERS: LeadFilters = { search: '', status: null, source: null, dealerId: null, page: 1 };

@Injectable({ providedIn: 'root' })
export class LeadListState {
  readonly filters = signal<LeadFilters>({ ...NO_FILTERS, status: 'New' });
}

/** The lead dialog, shared by the list (new lead) and the lead page (edit). */
@Component({
  selector: 'app-lead-dialog',
  imports: [ReactiveFormsModule, Modal, CustomerPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [title]="lead() ? 'Edit lead' : 'Add lead'" (closed)="dismissed.emit()">
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="panel-body">
          @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
          <div class="form-grid two">
            <div class="field full">
              <label for="leadName">Lead name<span class="req">*</span></label>
              <input id="leadName" class="input" maxlength="200" formControlName="name" [class.invalid]="err('name')">
              @if (err('name'); as m) { <span class="field-error">{{ m }}</span> }
            </div>
            <div class="field full">
              <label for="leadCustomer">Customer<span class="req">*</span></label>
              <app-customer-picker inputId="leadCustomer" formControlName="customerId" [invalid]="!!err('customerId')" (picked)="customerPicked($event)" />
              @if (err('customerId'); as m) { <span class="field-error">{{ m }}</span> }
            </div>
            @if (!ownScope) {
              <div class="field">
                <label for="leadEngineer">Dealer engineer</label>
                <select id="leadEngineer" class="input" formControlName="dealerUserId">
                  <option [ngValue]="null">Not assigned</option>
                  @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                </select>
              </div>
            }
            <div class="field">
              <label for="leadOwner">Edwards owner</label>
              <select id="leadOwner" class="input" formControlName="ownerUserId" [class.invalid]="err('ownerUserId')">
                <option [ngValue]="null">Not assigned</option>
                @for (u of owners(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
              </select>
              @if (err('ownerUserId'); as m) { <span class="field-error">{{ m }}</span> }
            </div>
            <div class="field">
              <label for="leadRange">Product range</label>
              <select id="leadRange" class="input" formControlName="productRangeId" (change)="rangeChanged()">
                <option [ngValue]="null">Not known yet</option>
                @for (r of ranges(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }
              </select>
            </div>
            <div class="field">
              <label for="leadModel">Product model</label>
              <select id="leadModel" class="input" formControlName="productModelId">
                <option [ngValue]="null">Not known yet</option>
                @for (m of models(); track m.id) { <option [ngValue]="m.id">{{ m.name }}</option> }
              </select>
            </div>
            <div class="field full">
              <label for="leadRemark">Remarks</label>
              <textarea id="leadRemark" class="input" rows="3" maxlength="2000" formControlName="remark"></textarea>
            </div>
          </div>
        </div>
        <div class="panel-footer">
          <button type="button" class="btn btn-light" (click)="dismissed.emit()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ lead() ? 'Save lead' : 'Add lead' }}</button>
        </div>
      </form>
    </app-modal>
  `,
})
export class LeadDialog implements OnInit {
  readonly lead = input<LeadDetail | null>(null);
  readonly dismissed = output<void>();
  readonly saved = output<LeadDetail>();

  private readonly http = inject(HttpClient);
  private readonly lookups = inject(LookupService);
  protected readonly ownScope = inject(AuthService).me()?.scope === 'Own';
  protected readonly ranges = toSignal(this.lookups.master('product-ranges'), { initialValue: [] });
  protected readonly owners = toSignal(this.lookups.users('sales,admin'), { initialValue: [] });
  protected readonly models = signal<Option[]>([]);
  protected readonly engineers = signal<Option[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly submitted = signal(false);
  private readonly server = signal<Record<string, string>>({});
  protected readonly form = inject(FormBuilder).group({
    name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
    customerId: [null as number | null, Validators.required],
    dealerUserId: [null as number | null],
    ownerUserId: [null as number | null],
    productRangeId: [null as number | null],
    productModelId: [null as number | null],
    remark: [''],
  });

  ngOnInit(): void {
    const l = this.lead();
    if (!l) return;
    this.form.patchValue({
      name: l.name, customerId: l.customerId, dealerUserId: l.dealerUserId, ownerUserId: l.ownerUserId,
      productRangeId: l.productRangeId, productModelId: l.productModelId, remark: l.remark ?? '',
    });
    this.form.controls.customerId.disable();
    if (l.productRangeId) this.lookups.productModels(l.productRangeId).subscribe((m) => this.models.set(m));
    if (l.dealerId && !this.ownScope) this.lookups.dealerUsers(l.dealerId).subscribe((u) => this.engineers.set(u));
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server());
  }

  protected customerPicked(customer: Option | null): void {
    this.engineers.set([]);
    this.form.controls.dealerUserId.setValue(null);
    if (!customer || this.ownScope) return;
    this.http.get<CustomerDetail>(`/api/customers/${customer.id}`).subscribe((c) =>
      this.lookups.dealerUsers(c.dealerId).subscribe((list) => {
        this.engineers.set(list);
        if (c.dealerUserId && list.some((u) => u.id === c.dealerUserId)) this.form.controls.dealerUserId.setValue(c.dealerUserId);
      }),
    );
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
    const body = { ...v, name: v.name!.trim(), remark: v.remark?.trim() || null };
    const l = this.lead();
    const request = l ? this.http.put<LeadDetail>(`/api/leads/${l.id}`, body) : this.http.post<LeadDetail>('/api/leads', body);
    this.busy.set(true);
    request.subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.saved.emit(saved);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.server.set(fields);
        this.error.set(Object.keys(fields).length ? 'Some fields need attention.' : problemMessage(err, 'The lead could not be saved.'));
      },
    });
  }
}

@Component({
  selector: 'app-lead-list',
  imports: [FormsModule, RouterLink, Pager, CanDirective, LeadDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Leads</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Sales</span><span>/</span><span>Leads</span></div>
      </div>
      <button *appCan="P.leadsCreate" type="button" class="btn btn-primary" (click)="adding.set(true)"><i class="fa-solid fa-plus"></i> Add lead</button>
    </div>

    <form class="panel" (ngSubmit)="apply({ ...draft, page: 1 })">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="lq">Lead or customer</label>
          <input id="lq" name="q" class="input" type="search" [(ngModel)]="draft.search" placeholder="Type to search">
        </div>
        <div class="field">
          <label for="ls">Status</label>
          <select id="ls" name="ls" class="input" [(ngModel)]="draft.status">
            <option [ngValue]="null">All</option>
            @for (s of statuses; track s) { <option [ngValue]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="lsrc">Source</label>
          <select id="lsrc" name="lsrc" class="input" [(ngModel)]="draft.source">
            <option [ngValue]="null">All</option>
            @for (s of sources; track s) { <option [ngValue]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="ld">Dealer</label>
          <select id="ld" name="ld" class="input" [(ngModel)]="draft.dealerId">
            <option [ngValue]="null">All</option>
            @for (d of dealers(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
          </select>
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-primary">Search</button>
          <button type="button" class="btn btn-dark" (click)="draft = { ...noFilters }; apply({ ...noFilters })">Reset</button>
        </div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>Lead list @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      @if (list.error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ list.error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Lead</th><th>Customer</th><th>Source</th><th>Status</th><th>Dealer</th><th>Engineer</th><th>Owner</th><th>Product range</th><th>Created</th><th>Opportunity</th></tr></thead>
          <tbody>
            @for (l of list.result()?.items ?? []; track l.id) {
              <tr class="clickable" (click)="router.navigate(['/leads', l.id])">
                <td><a [routerLink]="['/leads', l.id]" (click)="$event.stopPropagation()">{{ l.name }}</a></td>
                <td>{{ l.customer }}</td>
                <td>{{ l.source }}</td>
                <td><span class="pill" [class]="'pill ' + pill[l.status]">{{ l.status }}</span></td>
                <td>{{ l.dealer || '—' }}</td>
                <td>{{ l.dealerUser || '—' }}</td>
                <td>{{ l.owner || '—' }}</td>
                <td>{{ l.productRange || '—' }}</td>
                <td class="nowrap">{{ date(l.createdAt) }}</td>
                <td>@if (l.opportunityId) { <a [routerLink]="['/opportunities', l.opportunityId]" (click)="$event.stopPropagation()">Open</a> } @else { — }</td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="10">{{ list.loading() ? 'Loading leads…' : 'No leads match these filters.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="apply({ ...state.filters(), page: $event })" /> }
    </section>

    @if (adding()) {
      <app-lead-dialog (dismissed)="adding.set(false)" (saved)="added($event)" />
    }
  `,
})
export class LeadList {
  protected readonly router = inject(Router);
  protected readonly state = inject(LeadListState);
  private readonly toast = inject(ToastService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly pill = LEAD_PILL;
  protected readonly statuses: LeadStatus[] = ['New', 'Qualified', 'Converted', 'Disqualified'];
  protected readonly sources: LeadSource[] = ['Visit', 'Manual', 'Reminder', 'Upload', 'Enquiry'];
  protected readonly noFilters = NO_FILTERS;
  protected readonly list = new PagedList<LeadListItem>(inject(HttpClient), '/api/leads', 'Leads could not be loaded.');
  protected readonly dealers = toSignal(inject(LookupService).dealers(), { initialValue: [] });
  protected readonly adding = signal(false);
  protected draft: LeadFilters = { ...this.state.filters() };

  constructor() {
    this.apply(this.state.filters());
  }

  protected apply(f: LeadFilters): void {
    this.state.filters.set(f);
    this.list.load({ ...f, pageSize: 25 });
  }

  protected added(lead: LeadDetail): void {
    this.adding.set(false);
    this.toast.show('Lead added.');
    void this.router.navigate(['/leads', lead.id]);
  }
}

@Component({
  selector: 'app-lead-view',
  imports: [FormsModule, RouterLink, CanDirective, Modal, LeadDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="page-header"><h1>Lead</h1></div>
      <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div>
    } @else if (lead(); as l) {
      <div class="page-header">
        <div>
          <h1>{{ l.name }} <span [class]="'pill ' + pill[l.status]">{{ l.status }}</span></h1>
          <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><a routerLink="/leads">Leads</a><span>/</span><span>{{ l.customer }}</span></div>
        </div>
        <div class="actions">
          <a class="btn btn-dark" routerLink="/leads"><i class="fa-solid fa-arrow-left"></i> Back</a>
          <ng-container *appCan="P.leadsEdit">
            @if (open(l)) {
              <button type="button" class="btn btn-light" (click)="editing.set(true)"><i class="fa-solid fa-pen"></i> Edit</button>
              <button type="button" class="btn btn-light" (click)="openAssign(l)"><i class="fa-solid fa-user-tag"></i> Assign</button>
              @if (l.status === 'New') { <button type="button" class="btn btn-light" (click)="act('qualify')" [disabled]="busy()">Qualify</button> }
              <button type="button" class="btn btn-light" (click)="dialog.set('disqualify')">Disqualify</button>
              <button type="button" class="btn btn-primary" (click)="openConvert(l)"><i class="fa-solid fa-arrow-right"></i> Convert to opportunity</button>
            }
            @if (l.status === 'Disqualified') { <button type="button" class="btn btn-light" (click)="act('reopen')" [disabled]="busy()">Reopen</button> }
          </ng-container>
          @if (l.opportunityId) { <a class="btn btn-primary" [routerLink]="['/opportunities', l.opportunityId]">Open opportunity</a> }
        </div>
      </div>

      <section class="panel">
        <div class="panel-heading"><h3>Lead details</h3></div>
        <div class="panel-body">
          <dl class="details">
            <div><dt>Customer</dt><dd><a [routerLink]="['/customers', l.customerId]">{{ l.customer }}</a></dd></div>
            <div><dt>Source</dt><dd>{{ l.source }} @if (l.visitId) { · <a [routerLink]="['/visits', l.visitId]">visit</a> }</dd></div>
            <div><dt>Dealer</dt><dd>{{ l.dealer || '—' }}</dd></div>
            <div><dt>Dealer engineer</dt><dd>{{ l.dealerUser || '—' }}</dd></div>
            <div><dt>Edwards owner</dt><dd>{{ l.owner || '—' }}</dd></div>
            <div><dt>Product range</dt><dd>{{ l.productRange || '—' }}</dd></div>
            <div><dt>Product model</dt><dd>{{ l.productModel || '—' }}</dd></div>
            <div><dt>Created</dt><dd>{{ date(l.createdAt) }}</dd></div>
            <div class="wide"><dt>Remarks</dt><dd>{{ l.remark || '—' }}</dd></div>
            @if (l.disqualifyReason) { <div class="wide"><dt>Disqualified because</dt><dd>{{ l.disqualifyReason }}</dd></div> }
          </dl>
        </div>
      </section>

      @if (editing()) {
        <app-lead-dialog [lead]="l" (dismissed)="editing.set(false)" (saved)="edited($event)" />
      }

      @if (dialog() === 'disqualify') {
        <app-modal title="Disqualify the lead" (closed)="dialog.set(null)">
          <form (ngSubmit)="disqualify()">
            <div class="panel-body">
              <div class="field">
                <label for="dqReason">Reason<span class="req">*</span></label>
                <textarea id="dqReason" name="reason" class="input" rows="3" maxlength="300" [(ngModel)]="reason" required></textarea>
                @if (dialogError()) { <span class="field-error">{{ dialogError() }}</span> }
              </div>
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Disqualify</button>
            </div>
          </form>
        </app-modal>
      }

      @if (dialog() === 'assign') {
        <app-modal title="Assign the lead" (closed)="dialog.set(null)">
          <form (ngSubmit)="assign()">
            <div class="panel-body form-grid two">
              <div class="field">
                <label for="asDealer">Dealer</label>
                <select id="asDealer" name="dealer" class="input" [(ngModel)]="assignDealer" (ngModelChange)="dealerChanged($event)">
                  @for (d of dealers(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="asEngineer">Dealer engineer</label>
                <select id="asEngineer" name="engineer" class="input" [(ngModel)]="assignEngineer">
                  <option [ngValue]="null">Not assigned</option>
                  @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="asOwner">Edwards owner</label>
                <select id="asOwner" name="owner" class="input" [(ngModel)]="assignOwner">
                  <option [ngValue]="null">Not assigned</option>
                  @for (u of owners(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                </select>
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

      @if (dialog() === 'convert') {
        <app-modal title="Convert to an opportunity" (closed)="dialog.set(null)">
          <form (ngSubmit)="convert()">
            <div class="panel-body form-grid two">
              <div class="field full">
                <label for="cvName">Opportunity name</label>
                <input id="cvName" name="name" class="input" maxlength="250" [(ngModel)]="convertName">
              </div>
              <div class="field">
                <label for="cvType">Type<span class="req">*</span></label>
                <select id="cvType" name="type" class="input" [(ngModel)]="convertType">
                  <option value="Equipment">Equipment</option>
                  <option value="Spare">Spares</option>
                  <option value="Service">Service</option>
                </select>
              </div>
              <div class="field">
                <label for="cvClose">Expected closing</label>
                <input id="cvClose" name="close" class="input" type="date" [(ngModel)]="convertClose">
              </div>
              @if (convertType !== 'Equipment') {
                <div class="field full">
                  <label for="cvAsset">Asset<span class="req">*</span></label>
                  <select id="cvAsset" name="asset" class="input" [(ngModel)]="convertAsset">
                    <option [ngValue]="null">Choose…</option>
                    @for (a of assets(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
                  </select>
                  @if (!assets().length) { <span class="hint">This customer has no registered assets yet.</span> }
                </div>
              }
              @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Create opportunity</button>
            </div>
          </form>
        </app-modal>
      }
    } @else {
      <div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading the lead…</div>
    }
  `,
})
export class LeadView implements OnInit {
  readonly id = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly pill = LEAD_PILL;
  protected readonly lead = signal<LeadDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly editing = signal(false);
  protected readonly dialog = signal<'disqualify' | 'assign' | 'convert' | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly dealers = toSignal(this.lookups.dealers(), { initialValue: [] });
  protected readonly owners = toSignal(this.lookups.users('sales,admin'), { initialValue: [] });
  protected readonly engineers = signal<Option[]>([]);
  protected readonly assets = signal<Option[]>([]);
  protected reason = '';
  protected assignDealer: number | null = null;
  protected assignEngineer: number | null = null;
  protected assignOwner: number | null = null;
  protected convertName = '';
  protected convertType: OpportunityType = 'Equipment';
  protected convertClose = addDays(todayIso(), 30);
  protected convertAsset: number | null = null;

  ngOnInit(): void {
    this.http.get<LeadDetail>(`/api/leads/${this.id()}`).subscribe({
      next: (l) => this.lead.set(l),
      error: (err: unknown) => this.error.set(problemMessage(err, 'This lead could not be loaded.')),
    });
  }

  protected open(l: LeadDetail): boolean {
    return l.status === 'New' || l.status === 'Qualified';
  }

  protected edited(l: LeadDetail): void {
    this.editing.set(false);
    this.lead.set(l);
    this.toast.show('Lead saved.');
  }

  protected act(action: 'qualify' | 'reopen'): void {
    this.post(action, {}, action === 'qualify' ? 'Lead qualified.' : 'Lead reopened.');
  }

  protected disqualify(): void {
    if (this.reason.trim().length < 3) {
      this.dialogError.set('Explain why the lead is disqualified.');
      return;
    }
    this.post('disqualify', { reason: this.reason.trim() }, 'Lead disqualified.');
  }

  protected openAssign(l: LeadDetail): void {
    this.dialogError.set(null);
    this.assignDealer = l.dealerId;
    this.assignEngineer = l.dealerUserId;
    this.assignOwner = l.ownerUserId;
    if (l.dealerId) this.lookups.dealerUsers(l.dealerId).subscribe((u) => this.engineers.set(u));
    this.dialog.set('assign');
  }

  protected dealerChanged(dealerId: number): void {
    this.assignEngineer = null;
    this.lookups.dealerUsers(dealerId).subscribe((u) => this.engineers.set(u));
  }

  protected assign(): void {
    this.post('assign', { dealerId: this.assignDealer, dealerUserId: this.assignEngineer, ownerUserId: this.assignOwner }, 'Lead assigned.');
  }

  protected openConvert(l: LeadDetail): void {
    this.dialogError.set(null);
    this.convertName = l.name;
    this.convertType = 'Equipment';
    this.convertAsset = null;
    this.lookups.customerAssets(l.customerId).subscribe((a) => this.assets.set(a));
    this.dialog.set('convert');
  }

  protected convert(): void {
    if (this.convertType !== 'Equipment' && !this.convertAsset) {
      this.dialogError.set('Spare and service opportunities must name the asset.');
      return;
    }
    this.busy.set(true);
    this.http.post<{ opportunityId: number }>(`/api/leads/${this.id()}/convert`, {
      type: this.convertType, name: this.convertName.trim() || null, assetId: this.convertAsset, expectedCloseDate: this.convertClose || null,
    }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.toast.show('Opportunity created.');
        void this.router.navigate(['/opportunities', r.opportunityId]);
      },
      error: (err: unknown) => this.failed(err),
    });
  }

  private post(action: string, body: object, done: string): void {
    this.busy.set(true);
    this.dialogError.set(null);
    this.http.post<LeadDetail>(`/api/leads/${this.id()}/${action}`, body).subscribe({
      next: (l) => {
        this.busy.set(false);
        this.dialog.set(null);
        this.lead.set(l);
        this.toast.show(done);
      },
      error: (err: unknown) => this.failed(err),
    });
  }

  private failed(err: unknown): void {
    this.busy.set(false);
    const fields = fieldErrors(err);
    const message = Object.values(fields)[0] ?? problemMessage(err);
    if (this.dialog()) this.dialogError.set(message);
    else this.toast.show(message, 'error');
  }
}
