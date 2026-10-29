import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Injectable, input, OnInit, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { CustomerDetail, Option, P } from '../../core/models';
import {
  FollowUpMode, OpportunityDetail, OpportunityInput, OpportunityListItem, OpportunityStage, OpportunityType, QUOTE_PILL, QuotationItem,
  STAGE_PILL,
} from '../../core/sales-models';
import {
  addDays, controlError, daysFromToday, fieldErrors, formatDate, formatDateTime, formatMoney, LookupService, PagedList, problemMessage,
  todayIso, ToastService,
} from '../../core/support';
import { DocumentsPanel } from '../../shared/documents';
import { CustomerPicker } from '../../shared/pickers';
import { CanDirective, Modal, Pager } from '../../shared/ui';
import { QuotationEditor } from './quotation-editor';

interface OpportunityFilters {
  search: string;
  stage: string;
  type: OpportunityType | null;
  dealerId: number | null;
  overdue: boolean;
  sort: string;
  page: number;
}

const NO_FILTERS: OpportunityFilters = { search: '', stage: 'open', type: null, dealerId: null, overdue: false, sort: 'closing', page: 1 };

@Injectable({ providedIn: 'root' })
export class OpportunityListState {
  readonly filters = signal<OpportunityFilters>({ ...NO_FILTERS });
}

@Component({
  selector: 'app-opportunity-list',
  imports: [FormsModule, RouterLink, Pager, CanDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Opportunities</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Sales</span><span>/</span><span>Opportunities</span></div>
      </div>
      <a *appCan="P.opportunitiesCreate" class="btn btn-primary" routerLink="/opportunities/new"><i class="fa-solid fa-plus"></i> Add opportunity</a>
    </div>

    <form class="panel" (ngSubmit)="apply({ ...draft, page: 1 })">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="oq">Opportunity or customer</label>
          <input id="oq" name="q" class="input" type="search" [(ngModel)]="draft.search" placeholder="Type to search">
        </div>
        <div class="field">
          <label for="os">Status</label>
          <select id="os" name="os" class="input" [(ngModel)]="draft.stage">
            <option value="open">Open and postponed</option>
            <option value="">All</option>
            @for (s of stages; track s) { <option [value]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="ot">Type</label>
          <select id="ot" name="ot" class="input" [(ngModel)]="draft.type">
            <option [ngValue]="null">All</option>
            <option value="Equipment">Equipment</option>
            <option value="Spare">Spares</option>
            <option value="Service">Service</option>
          </select>
        </div>
        <div class="field">
          <label for="od">Dealer</label>
          <select id="od" name="od" class="input" [(ngModel)]="draft.dealerId">
            <option [ngValue]="null">All</option>
            @for (d of dealers(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="osort">Sort by</label>
          <select id="osort" name="osort" class="input" [(ngModel)]="draft.sort">
            <option value="closing">Expected closing</option>
            <option value="value">Value, highest first</option>
            <option value="created">Newest first</option>
          </select>
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <label class="check"><input type="checkbox" name="overdue" [(ngModel)]="draft.overdue"> Past expected closing</label>
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-primary">Search</button>
          <button type="button" class="btn btn-dark" (click)="draft = { ...noFilters }; apply({ ...noFilters })">Reset</button>
        </div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>Opportunity list @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      @if (list.error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ list.error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Opportunity</th><th>Customer</th><th>Type</th><th>Status</th><th class="num">Value</th><th>Expected closing</th><th>Phase</th><th class="num">Chance</th><th>Dealer</th><th>Engineer</th><th>Next follow-up</th></tr></thead>
          <tbody>
            @for (o of list.result()?.items ?? []; track o.id) {
              <tr class="clickable" (click)="router.navigate(['/opportunities', o.id])">
                <td>
                  <a [routerLink]="['/opportunities', o.id]" (click)="$event.stopPropagation()">{{ o.name }}</a>
                  @if (!o.dealerAccepted && (o.stage === 'Open' || o.stage === 'Postponed')) { <span class="pill pill-warn">Awaiting dealer</span> }
                </td>
                <td>{{ o.customer }}</td>
                <td>{{ o.type }}</td>
                <td><span [class]="'pill ' + pill[o.stage]">{{ o.stage }}</span></td>
                <td class="num nowrap">{{ money(o.value) }}</td>
                <td class="nowrap" [class.overdue]="late(o.expectedCloseDate) && (o.stage === 'Open' || o.stage === 'Postponed')">{{ date(o.expectedCloseDate) || '—' }}</td>
                <td>{{ o.salesPhase || '—' }}</td>
                <td class="num">{{ o.chance !== null ? o.chance + '%' : '—' }}</td>
                <td>{{ o.dealer }}</td>
                <td>{{ o.dealerUser || '—' }}</td>
                <td class="nowrap" [class.overdue]="late(o.nextFollowUpDate)">{{ date(o.nextFollowUpDate) || '—' }}</td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="11">{{ list.loading() ? 'Loading opportunities…' : 'No opportunities match these filters.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="apply({ ...state.filters(), page: $event })" /> }
    </section>
  `,
  styles: `.overdue { color: var(--edw-error); font-weight: 600; }`,
})
export class OpportunityList {
  protected readonly router = inject(Router);
  protected readonly state = inject(OpportunityListState);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly money = formatMoney;
  protected readonly pill = STAGE_PILL;
  protected readonly stages: OpportunityStage[] = ['Open', 'Postponed', 'Won', 'Lost', 'Dropped'];
  protected readonly noFilters = NO_FILTERS;
  protected readonly list = new PagedList<OpportunityListItem>(inject(HttpClient), '/api/opportunities', 'Opportunities could not be loaded.');
  protected readonly dealers = toSignal(inject(LookupService).dealers(), { initialValue: [] });
  protected draft: OpportunityFilters = { ...this.state.filters() };

  constructor() {
    this.apply(this.state.filters());
  }

  protected late(date: string | null): boolean {
    return (daysFromToday(date) ?? 0) < 0;
  }

  protected apply(f: OpportunityFilters): void {
    this.state.filters.set(f);
    this.list.load({ ...f, pageSize: 25 });
  }
}

/** The opportunity form, used for new opportunities (page) and edits (dialog on the opportunity page). */
@Component({
  selector: 'app-opportunity-fields',
  imports: [ReactiveFormsModule, CustomerPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <div class="panel-body">
        @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
        <div class="form-grid">
          <div class="field wide">
            <label for="oName">Opportunity name<span class="req">*</span></label>
            <input id="oName" class="input" maxlength="250" formControlName="name" [class.invalid]="err('name')">
            @if (err('name'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="oType">Type<span class="req">*</span></label>
            <select id="oType" class="input" formControlName="type">
              <option value="Equipment">Equipment</option>
              <option value="Spare">Spares</option>
              <option value="Service">Service</option>
            </select>
          </div>
          <div class="field">
            <label for="oCustomer">Customer<span class="req">*</span></label>
            <app-customer-picker inputId="oCustomer" formControlName="customerId" [invalid]="!!err('customerId')" (picked)="customerPicked($event)" />
            @if (err('customerId'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          @if (form.controls.type.value !== 'Equipment') {
            <div class="field">
              <label for="oAsset">Asset<span class="req">*</span></label>
              <select id="oAsset" class="input" formControlName="assetId" [class.invalid]="err('assetId')">
                <option [ngValue]="null">Choose…</option>
                @for (a of assets(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
              </select>
              @if (err('assetId'); as m) { <span class="field-error">{{ m }}</span> }
            </div>
          }
          @if (!ownScope) {
            <div class="field">
              <label for="oEngineer">Dealer engineer</label>
              <select id="oEngineer" class="input" formControlName="dealerUserId" [class.invalid]="err('dealerUserId')">
                <option [ngValue]="null">Not assigned</option>
                @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
              </select>
              @if (err('dealerUserId'); as m) { <span class="field-error">{{ m }}</span> }
            </div>
          }
          <div class="field">
            <label for="oOwner">Edwards owner</label>
            <select id="oOwner" class="input" formControlName="ownerUserId">
              <option [ngValue]="null">Not assigned</option>
              @for (u of owners(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="oPhase">Sales phase</label>
            <select id="oPhase" class="input" formControlName="salesPhaseId">
              <option [ngValue]="null">Not set</option>
              @for (x of phases(); track x.id) { <option [ngValue]="x.id">{{ x.name }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="oChance">Chance of winning</label>
            <select id="oChance" class="input" formControlName="winningChanceId">
              <option [ngValue]="null">Not set</option>
              @for (x of chances(); track x.id) { <option [ngValue]="x.id">{{ x.name }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="oMode">Created through</label>
            <select id="oMode" class="input" formControlName="opportunityModeId">
              <option [ngValue]="null">Not set</option>
              @for (x of modes(); track x.id) { <option [ngValue]="x.id">{{ x.name }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="oClose">Expected closing</label>
            <input id="oClose" class="input" type="date" formControlName="expectedCloseDate" [class.invalid]="err('expectedCloseDate')">
            @if (err('expectedCloseDate'); as m) { <span class="field-error">{{ m }}</span> }
          </div>
          <div class="field">
            <label for="oComp">Competition price (₹)</label>
            <input id="oComp" class="input" type="number" min="0" formControlName="competitionPrice">
          </div>
          <div class="field full">
            <label for="oRemark">Remarks</label>
            <textarea id="oRemark" class="input" rows="3" maxlength="2000" formControlName="remark"></textarea>
          </div>
        </div>
      </div>
      <div class="panel-footer">
        <button type="button" class="btn btn-light" (click)="cancelled.emit()">Cancel</button>
        <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ opportunity() ? 'Save opportunity' : 'Add opportunity' }}</button>
      </div>
    </form>
  `,
})
export class OpportunityFields implements OnInit {
  readonly opportunity = input<OpportunityDetail | null>(null);
  readonly customerId = input<number | null>(null);
  readonly cancelled = output<void>();
  readonly saved = output<OpportunityDetail>();

  private readonly http = inject(HttpClient);
  private readonly lookups = inject(LookupService);
  protected readonly ownScope = inject(AuthService).me()?.scope === 'Own';
  protected readonly phases = toSignal(this.lookups.master('sales-phases'), { initialValue: [] });
  protected readonly chances = toSignal(this.lookups.master('winning-chances'), { initialValue: [] });
  protected readonly modes = toSignal(this.lookups.master('opportunity-modes'), { initialValue: [] });
  protected readonly owners = toSignal(this.lookups.users('sales,admin'), { initialValue: [] });
  protected readonly engineers = signal<Option[]>([]);
  protected readonly assets = signal<Option[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly submitted = signal(false);
  private readonly server = signal<Record<string, string>>({});
  protected readonly form = inject(FormBuilder).group({
    name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(250)]],
    type: ['Equipment' as OpportunityType],
    customerId: [null as number | null, Validators.required],
    assetId: [null as number | null],
    dealerUserId: [null as number | null],
    ownerUserId: [null as number | null],
    salesPhaseId: [null as number | null],
    winningChanceId: [null as number | null],
    opportunityModeId: [null as number | null],
    expectedCloseDate: [addDays(todayIso(), 60) as string | null],
    competitionPrice: [null as number | null, Validators.min(0)],
    remark: [''],
  });

  ngOnInit(): void {
    const o = this.opportunity();
    if (o) {
      this.form.patchValue({
        name: o.name, type: o.type, customerId: o.customerId, assetId: o.assetId, dealerUserId: o.dealerUserId, ownerUserId: o.ownerUserId,
        salesPhaseId: o.salesPhaseId, winningChanceId: o.winningChanceId, opportunityModeId: o.opportunityModeId,
        expectedCloseDate: o.expectedCloseDate, competitionPrice: o.competitionPrice, remark: o.remark ?? '',
      });
      this.form.controls.customerId.disable();
      this.loadCustomer(o.customerId, false);
    } else if (this.customerId()) {
      this.form.controls.customerId.setValue(this.customerId());
      this.loadCustomer(this.customerId()!, true);
    }
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server());
  }

  protected customerPicked(c: Option | null): void {
    this.engineers.set([]);
    this.assets.set([]);
    this.form.patchValue({ dealerUserId: null, assetId: null });
    if (c) this.loadCustomer(c.id, true);
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
    const body: OpportunityInput = {
      name: v.name!.trim(), type: v.type!, customerId: v.customerId, assetId: v.type === 'Equipment' ? null : v.assetId,
      dealerUserId: v.dealerUserId, ownerUserId: v.ownerUserId, salesPhaseId: v.salesPhaseId, winningChanceId: v.winningChanceId,
      opportunityModeId: v.opportunityModeId, expectedCloseDate: v.expectedCloseDate || null,
      competitionPrice: v.competitionPrice === null || (v.competitionPrice as unknown) === '' ? null : Number(v.competitionPrice),
      remark: v.remark?.trim() || null,
    };
    const o = this.opportunity();
    const request = o
      ? this.http.put<OpportunityDetail>(`/api/opportunities/${o.id}`, body)
      : this.http.post<OpportunityDetail>('/api/opportunities', body);
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
        this.error.set(Object.keys(fields).length ? 'Some fields need attention.' : problemMessage(err, 'The opportunity could not be saved.'));
      },
    });
  }

  private loadCustomer(customerId: number, setDefault: boolean): void {
    this.lookups.customerAssets(customerId).subscribe((a) => this.assets.set(a));
    if (this.ownScope) return;
    this.http.get<CustomerDetail>(`/api/customers/${customerId}`).subscribe((c) =>
      this.lookups.dealerUsers(c.dealerId).subscribe((list) => {
        this.engineers.set(list);
        if (setDefault && c.dealerUserId && list.some((u) => u.id === c.dealerUserId)) this.form.controls.dealerUserId.setValue(c.dealerUserId);
      }),
    );
  }
}

@Component({
  selector: 'app-opportunity-new',
  imports: [RouterLink, OpportunityFields],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Add opportunity</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><a routerLink="/opportunities">Opportunities</a><span>/</span><span>New</span></div>
      </div>
    </div>
    <section class="panel">
      <div class="panel-heading"><h3>Opportunity details</h3></div>
      <app-opportunity-fields [customerId]="customerId" (cancelled)="router.navigate(['/opportunities'])" (saved)="created($event)" />
    </section>
  `,
})
export class OpportunityNew {
  protected readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly customerId = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('customerId')) || null;

  protected created(o: OpportunityDetail): void {
    this.toast.show(o.dealerAccepted ? 'Opportunity added.' : 'Opportunity added. The dealer has been asked to accept it.');
    void this.router.navigate(['/opportunities', o.id]);
  }
}

@Component({
  selector: 'app-opportunity-view',
  imports: [FormsModule, RouterLink, CanDirective, Modal, OpportunityFields, QuotationEditor, DocumentsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="page-header"><h1>Opportunity</h1></div>
      <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div>
    } @else if (opp(); as o) {
      <div class="page-header">
        <div>
          <h1>{{ o.name }} <span [class]="'pill ' + pill[o.stage]">{{ o.stage }}</span></h1>
          <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><a routerLink="/opportunities">Opportunities</a><span>/</span><span>{{ o.customer }}</span></div>
        </div>
        <div class="actions">
          <a class="btn btn-dark" routerLink="/opportunities"><i class="fa-solid fa-arrow-left"></i> Back</a>
          @if (o.actions?.accept) { <button type="button" class="btn btn-primary" (click)="accept()" [disabled]="busy()"><i class="fa-solid fa-check"></i> Accept</button> }
          @if (o.actions?.edit) { <button type="button" class="btn btn-light" (click)="dialog.set('edit')"><i class="fa-solid fa-pen"></i> Edit</button> }
          @if (o.actions?.assign) { <button type="button" class="btn btn-light" (click)="openAssign(o)"><i class="fa-solid fa-user-tag"></i> Assign</button> }
          @if (o.actions?.changeStatus && open(o)) { <button type="button" class="btn btn-primary" (click)="openStatus()"><i class="fa-solid fa-flag-checkered"></i> Change status</button> }
          @if (o.actions?.reopen) { <button type="button" class="btn btn-light" (click)="reopen()" [disabled]="busy()"><i class="fa-solid fa-rotate-left"></i> Reopen</button> }
          @if (o.stage === 'Won' && o.type === 'Equipment') {
            <a *appCan="P.assetsCreate" class="btn btn-light" routerLink="/assets/new" [queryParams]="{ customerId: o.customerId, opportunityId: o.id }"><i class="fa-solid fa-gears"></i> Register asset</a>
          }
        </div>
      </div>

      @if (!o.dealerAccepted && open(o)) {
        <div class="alert alert-warning"><i class="fa-solid fa-hourglass-half"></i><span>Waiting for {{ o.dealer }} to accept this opportunity.</span></div>
      }

      <div class="tiles">
        <div class="tile"><span>Value</span><strong>{{ money(o.value) }}</strong></div>
        <div class="tile"><span>Expected closing</span><strong>{{ date(o.expectedCloseDate) || '—' }}</strong></div>
        <div class="tile"><span>Chance of winning</span><strong>{{ o.winningChance || '—' }}</strong></div>
        <div class="tile"><span>Next follow-up</span><strong [class.overdue]="(days(o.nextFollowUpDate) ?? 0) < 0">{{ date(o.nextFollowUpDate) || '—' }}</strong></div>
      </div>

      <section class="panel">
        <div class="panel-heading"><h3>Opportunity details</h3></div>
        <div class="panel-body">
          <dl class="details">
            <div><dt>Customer</dt><dd><a [routerLink]="['/customers', o.customerId]">{{ o.customer }}</a></dd></div>
            <div><dt>Type</dt><dd>{{ o.type }} @if (o.assetId) { · <a [routerLink]="['/assets', o.assetId]">{{ o.asset }}</a> }</dd></div>
            <div><dt>Source</dt><dd>{{ o.source }} @if (o.leadId) { · <a [routerLink]="['/leads', o.leadId]">lead</a> }</dd></div>
            <div><dt>Sales phase</dt><dd>{{ o.salesPhase || '—' }}</dd></div>
            <div><dt>Dealer</dt><dd>{{ o.dealer }}</dd></div>
            <div><dt>Dealer engineer</dt><dd>{{ o.dealerUser || '—' }}</dd></div>
            <div><dt>Edwards owner</dt><dd>{{ o.owner || '—' }}</dd></div>
            <div><dt>Created through</dt><dd>{{ o.opportunityMode || '—' }}</dd></div>
            <div><dt>Competition price</dt><dd>{{ o.competitionPrice !== null ? money(o.competitionPrice) : '—' }}</dd></div>
            <div><dt>Created</dt><dd>{{ date(o.createdAt) }}</dd></div>
            @if (o.closedDate) { <div><dt>Closed</dt><dd>{{ date(o.closedDate) }}</dd></div> }
            @if (o.poNumber) { <div><dt>Customer PO</dt><dd>{{ o.poNumber }} · {{ date(o.poDate) }}</dd></div> }
            @if (o.winningReason) { <div><dt>Won because</dt><dd>{{ o.winningReason }}</dd></div> }
            @if (o.losingReason) { <div><dt>Lost because</dt><dd>{{ o.losingReason }}</dd></div> }
            @if (o.closeRemark) { <div class="wide"><dt>Closing remark</dt><dd>{{ o.closeRemark }}</dd></div> }
            <div class="wide"><dt>Remarks</dt><dd>{{ o.remark || '—' }}</dd></div>
          </dl>
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <h3>Quotations <span class="count">{{ quotations().length }}</span></h3>
          @if (o.actions?.quote && !hasDraft()) {
            <button type="button" class="btn btn-primary btn-sm" (click)="editQuote(null)"><i class="fa-solid fa-plus"></i> New quotation</button>
          }
        </div>
        @for (q of quotations(); track q.id) {
          <div class="quote" [class.current]="$first">
            <div class="quote-head">
              <strong>{{ q.number }}</strong>
              <span [class]="'pill ' + quotePill[q.status]">{{ q.status }}</span>
              <span class="muted">{{ date(q.quoteDate) }}</span>
              <span class="spacer"></span>
              <strong>{{ money(q.total) }}</strong>
              @if (q.status === 'Draft' && o.actions?.quote) {
                <button type="button" class="btn btn-light btn-sm" (click)="editQuote(q)">Edit</button>
                <button type="button" class="btn btn-primary btn-sm" (click)="quoteAction(q, 'submit')" [disabled]="busy()">Submit</button>
              }
              @if (q.status === 'Submitted' && o.actions?.approveQuote) {
                <button type="button" class="btn btn-light btn-sm" (click)="decide(q, false)">Reject</button>
                <button type="button" class="btn btn-primary btn-sm" (click)="decide(q, true)">Accept</button>
              }
              @if ($first && q.status !== 'Draft' && o.actions?.quote) {
                <button type="button" class="btn btn-light btn-sm" (click)="quoteAction(q, 'revise')" [disabled]="busy()"><i class="fa-solid fa-copy"></i> Revise</button>
              }
            </div>
            <table class="table">
              <thead><tr><th>Type</th><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Total</th></tr></thead>
              <tbody>
                @for (l of q.lines; track l.id) {
                  <tr>
                    <td>{{ l.type }}</td>
                    <td>{{ l.type === 'Equipment' ? (l.productRange + ' · ' + l.productModel) : l.description }}</td>
                    <td class="num">{{ l.quantity }}</td>
                    <td class="num nowrap">{{ money(l.unitPrice) }}</td>
                    <td class="num nowrap">{{ money(l.lineTotal!) }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <div class="quote-foot muted">
              @if (q.submittedAt) { Submitted {{ dateTime(q.submittedAt) }} by {{ q.submittedBy || '—' }}. }
              @if (q.decidedAt) { {{ q.status === 'Rejected' ? 'Rejected' : 'Accepted' }} {{ dateTime(q.decidedAt) }} by {{ q.decidedBy || '—' }}@if (q.decisionRemark) {: “{{ q.decisionRemark }}”}. }
              @if (q.remark) { Terms: {{ q.remark }} }
            </div>
          </div>
        } @empty {
          <div class="panel-body muted">No quotations yet.</div>
        }
      </section>

      <section class="panel">
        <div class="panel-heading">
          <h3>Follow-ups <span class="count">{{ o.followUps.length }}</span></h3>
          @if (o.actions?.edit) { <button type="button" class="btn btn-primary btn-sm" (click)="openFollowUp()"><i class="fa-solid fa-plus"></i> Log follow-up</button> }
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Date</th><th>Mode</th><th>What happened</th><th>Next follow-up</th><th>By</th></tr></thead>
            <tbody>
              @for (f of o.followUps; track f.id) {
                <tr><td class="nowrap">{{ date(f.date) }}</td><td>{{ f.mode }}</td><td>{{ f.remark }}</td><td class="nowrap">{{ date(f.nextDate) || '—' }}</td><td>{{ f.by || '—' }}</td></tr>
              } @empty {
                <tr class="empty"><td colspan="5">No follow-ups logged yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <app-documents ownerType="Opportunity" [ownerId]="o.id" />

      @if (dialog() === 'edit') {
        <app-modal title="Edit opportunity" [wide]="true" (closed)="dialog.set(null)">
          <app-opportunity-fields [opportunity]="o" (cancelled)="dialog.set(null)" (saved)="replaced($event, 'Opportunity saved.')" />
        </app-modal>
      }

      @if (dialog() === 'quote') {
        <app-quotation-editor [opportunityId]="o.id" [quotation]="editingQuote()" (dismissed)="dialog.set(null)" (saved)="quoteSaved()" />
      }

      @if (dialog() === 'followup') {
        <app-modal title="Log a follow-up" (closed)="dialog.set(null)">
          <form (ngSubmit)="saveFollowUp()">
            <div class="panel-body form-grid two">
              <div class="field">
                <label for="fDate">Date<span class="req">*</span></label>
                <input id="fDate" name="fDate" class="input" type="date" [max]="today" [(ngModel)]="followUp.date">
              </div>
              <div class="field">
                <label for="fMode">How</label>
                <select id="fMode" name="fMode" class="input" [(ngModel)]="followUp.mode">
                  @for (m of modes; track m) { <option [value]="m">{{ m }}</option> }
                </select>
              </div>
              <div class="field full">
                <label for="fRemark">What happened<span class="req">*</span></label>
                <textarea id="fRemark" name="fRemark" class="input" rows="3" maxlength="1000" [(ngModel)]="followUp.remark"></textarea>
              </div>
              <div class="field">
                <label for="fNext">Next follow-up</label>
                <input id="fNext" name="fNext" class="input" type="date" [(ngModel)]="followUp.nextDate">
              </div>
              @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Save follow-up</button>
            </div>
          </form>
        </app-modal>
      }

      @if (dialog() === 'assign') {
        <app-modal title="Assign the opportunity" (closed)="dialog.set(null)">
          <form (ngSubmit)="assign()">
            <div class="panel-body form-grid two">
              <div class="field">
                <label for="aDealer">Dealer</label>
                <select id="aDealer" name="aDealer" class="input" [(ngModel)]="assignForm.dealerId" (ngModelChange)="assignDealerChanged($event)">
                  @for (d of dealers(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="aEngineer">Dealer engineer</label>
                <select id="aEngineer" name="aEngineer" class="input" [(ngModel)]="assignForm.dealerUserId">
                  <option [ngValue]="null">Not assigned</option>
                  @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="aOwner">Edwards owner</label>
                <select id="aOwner" name="aOwner" class="input" [(ngModel)]="assignForm.ownerUserId">
                  <option [ngValue]="null">Not assigned</option>
                  @for (u of owners(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                </select>
              </div>
              <p class="hint field full">A new dealer or engineer has to accept the opportunity again.</p>
              @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Assign</button>
            </div>
          </form>
        </app-modal>
      }

      @if (dialog() === 'status') {
        <app-modal title="Change status" (closed)="dialog.set(null)">
          <form (ngSubmit)="saveStatus()">
            <div class="panel-body form-grid two">
              <div class="field full">
                <label for="sStage">New status<span class="req">*</span></label>
                <select id="sStage" name="sStage" class="input" [(ngModel)]="status.stage">
                  @for (s of nextStages(); track s) { <option [value]="s">{{ s }}</option> }
                </select>
              </div>
              @if (status.stage === 'Won') {
                <div class="field">
                  <label for="sPo">Customer PO number<span class="req">*</span></label>
                  <input id="sPo" name="sPo" class="input" maxlength="100" [(ngModel)]="status.poNumber">
                </div>
                <div class="field">
                  <label for="sPoDate">PO date</label>
                  <input id="sPoDate" name="sPoDate" class="input" type="date" [(ngModel)]="status.poDate">
                </div>
                <div class="field full">
                  <label for="sWin">Why we won</label>
                  <select id="sWin" name="sWin" class="input" [(ngModel)]="status.winningReasonId">
                    <option [ngValue]="null">Not given</option>
                    @for (r of winReasons(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }
                  </select>
                </div>
              }
              @if (status.stage === 'Lost') {
                <div class="field full">
                  <label for="sLose">Why we lost<span class="req">*</span></label>
                  <select id="sLose" name="sLose" class="input" [(ngModel)]="status.losingReasonId">
                    <option [ngValue]="null">Choose…</option>
                    @for (r of loseReasons(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }
                  </select>
                </div>
              }
              @if (status.stage === 'Won' || status.stage === 'Lost' || status.stage === 'Dropped') {
                <div class="field">
                  <label for="sClosed">Closed on</label>
                  <input id="sClosed" name="sClosed" class="input" type="date" [max]="today" [(ngModel)]="status.closedDate">
                </div>
              }
              <div class="field full">
                <label for="sRemark">Remark @if (status.stage === 'Dropped') { <span class="req">*</span> }</label>
                <textarea id="sRemark" name="sRemark" class="input" rows="3" maxlength="1000" [(ngModel)]="status.remark"></textarea>
              </div>
              <p class="hint field full">Everyone working on the opportunity is told about the change.</p>
              @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Save status</button>
            </div>
          </form>
        </app-modal>
      }

      @if (deciding(); as d) {
        <app-modal [title]="(d.accept ? 'Accept ' : 'Reject ') + d.quotation.number" (closed)="deciding.set(null)">
          <form (ngSubmit)="saveDecision()">
            <div class="panel-body">
              <div class="field">
                <label for="dRemark">Remark @if (!d.accept) { <span class="req">*</span> }</label>
                <textarea id="dRemark" name="dRemark" class="input" rows="3" maxlength="500" [(ngModel)]="decisionRemark"></textarea>
                @if (dialogError()) { <span class="field-error">{{ dialogError() }}</span> }
              </div>
            </div>
            <div class="panel-footer">
              <button type="button" class="btn btn-light" (click)="deciding.set(null)">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ d.accept ? 'Accept quotation' : 'Reject quotation' }}</button>
            </div>
          </form>
        </app-modal>
      }
    } @else {
      <div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading the opportunity…</div>
    }
  `,
  styles: `
    .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .tile { background: #fff; border: 1px solid var(--edw-border); border-top: 3px solid var(--edw-red); padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
    .tile span { font-size: 12px; color: var(--edw-muted); text-transform: uppercase; letter-spacing: .04em; }
    .tile strong { font-size: 18px; color: var(--edw-slate); }
    .overdue { color: var(--edw-error) !important; }
    .quote { border-top: 1px solid var(--edw-border); padding: 10px 12px; }
    .quote:not(.current) { opacity: .8; }
    .quote-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
    .quote-head .spacer { flex: 1; }
    .quote-foot { font-size: 12px; margin-top: 6px; }
    @media (max-width: 767px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `,
})
export class OpportunityView implements OnInit {
  readonly id = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly dateTime = formatDateTime;
  protected readonly money = formatMoney;
  protected readonly days = daysFromToday;
  protected readonly pill = STAGE_PILL;
  protected readonly quotePill = QUOTE_PILL;
  protected readonly today = todayIso();
  protected readonly modes: FollowUpMode[] = ['Call', 'Visit', 'Email', 'Meeting', 'Other'];
  protected readonly opp = signal<OpportunityDetail | null>(null);
  protected readonly quotations = signal<QuotationItem[]>([]);
  protected readonly hasDraft = computed(() => this.quotations().some((q) => q.status === 'Draft'));
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly dialog = signal<'edit' | 'quote' | 'followup' | 'assign' | 'status' | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly editingQuote = signal<QuotationItem | null>(null);
  protected readonly deciding = signal<{ quotation: QuotationItem; accept: boolean } | null>(null);
  protected readonly dealers = toSignal(this.lookups.dealers(), { initialValue: [] });
  protected readonly owners = toSignal(this.lookups.users('sales,admin'), { initialValue: [] });
  protected readonly winReasons = toSignal(this.lookups.master('winning-reasons'), { initialValue: [] });
  protected readonly loseReasons = toSignal(this.lookups.master('losing-reasons'), { initialValue: [] });
  protected readonly engineers = signal<Option[]>([]);
  protected readonly nextStages = computed<OpportunityStage[]>(() => {
    const stage = this.opp()?.stage;
    return (['Won', 'Lost', 'Postponed', 'Open', 'Dropped'] as OpportunityStage[]).filter((s) => s !== stage);
  });
  protected followUp = { date: todayIso(), mode: 'Call' as FollowUpMode, remark: '', nextDate: addDays(todayIso(), 7) };
  protected assignForm = { dealerId: null as number | null, dealerUserId: null as number | null, ownerUserId: null as number | null };
  protected status = this.blankStatus();
  protected decisionRemark = '';

  ngOnInit(): void {
    this.load();
  }

  protected open(o: OpportunityDetail): boolean {
    return o.stage === 'Open' || o.stage === 'Postponed';
  }

  protected replaced(o: OpportunityDetail, message: string): void {
    this.dialog.set(null);
    this.opp.set(o);
    this.toast.show(message);
  }

  protected accept(): void {
    this.post('accept', {}, 'Opportunity accepted.');
  }

  protected reopen(): void {
    this.post('status', { stage: 'Open' }, 'Opportunity reopened.');
  }

  protected openFollowUp(): void {
    this.followUp = { date: todayIso(), mode: 'Call', remark: '', nextDate: addDays(todayIso(), 7) };
    this.dialogError.set(null);
    this.dialog.set('followup');
  }

  protected saveFollowUp(): void {
    if (this.followUp.remark.trim().length < 3) {
      this.dialogError.set('Describe what happened.');
      return;
    }
    this.post('follow-ups', { ...this.followUp, remark: this.followUp.remark.trim(), nextDate: this.followUp.nextDate || null }, 'Follow-up logged.');
  }

  protected openAssign(o: OpportunityDetail): void {
    this.assignForm = { dealerId: o.dealerId, dealerUserId: o.dealerUserId, ownerUserId: o.ownerUserId };
    this.lookups.dealerUsers(o.dealerId).subscribe((u) => this.engineers.set(u));
    this.dialogError.set(null);
    this.dialog.set('assign');
  }

  protected assignDealerChanged(dealerId: number): void {
    this.assignForm.dealerUserId = null;
    this.lookups.dealerUsers(dealerId).subscribe((u) => this.engineers.set(u));
  }

  protected assign(): void {
    this.post('assign', this.assignForm, 'Opportunity assigned.');
  }

  protected openStatus(): void {
    this.status = this.blankStatus();
    this.status.stage = this.nextStages()[0];
    this.dialogError.set(null);
    this.dialog.set('status');
  }

  protected saveStatus(): void {
    const s = this.status;
    if (s.stage === 'Won' && !s.poNumber.trim()) return this.dialogError.set("Enter the customer's PO number.");
    if (s.stage === 'Lost' && !s.losingReasonId) return this.dialogError.set('Choose why the opportunity was lost.');
    if (s.stage === 'Dropped' && !s.remark.trim()) return this.dialogError.set('Explain why the project was dropped.');
    this.post('status', {
      stage: s.stage, poNumber: s.poNumber.trim() || null, poDate: s.poDate || null, winningReasonId: s.winningReasonId,
      losingReasonId: s.losingReasonId, closedDate: s.closedDate || null, remark: s.remark.trim() || null,
    }, `Opportunity marked ${s.stage.toLowerCase()}.`, true);
  }

  protected editQuote(q: QuotationItem | null): void {
    this.editingQuote.set(q);
    this.dialog.set('quote');
  }

  protected quoteSaved(): void {
    this.dialog.set(null);
    this.toast.show('Quotation draft saved.');
    this.load();
  }

  protected quoteAction(q: QuotationItem, action: 'submit' | 'revise'): void {
    this.busy.set(true);
    this.http.post<QuotationItem>(`/api/quotations/${q.id}/${action}`, {}).subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.toast.show(action === 'submit' ? `${saved.number} submitted for review.` : `${saved.number} created as a draft.`);
        this.load();
        if (action === 'revise') this.editQuote(saved);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.toast.show(problemMessage(err), 'error');
      },
    });
  }

  protected decide(q: QuotationItem, accept: boolean): void {
    this.decisionRemark = '';
    this.dialogError.set(null);
    this.deciding.set({ quotation: q, accept });
  }

  protected saveDecision(): void {
    const d = this.deciding();
    if (!d) return;
    if (!d.accept && this.decisionRemark.trim().length < 3) {
      this.dialogError.set('Explain why the quotation is rejected.');
      return;
    }
    this.busy.set(true);
    this.http.post<QuotationItem>(`/api/quotations/${d.quotation.id}/${d.accept ? 'accept' : 'reject'}`, { remark: this.decisionRemark.trim() || null })
      .subscribe({
        next: (saved) => {
          this.busy.set(false);
          this.deciding.set(null);
          this.toast.show(`${saved.number} ${d.accept ? 'accepted' : 'rejected'}.`);
          this.load();
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.dialogError.set(problemMessage(err));
        },
      });
  }

  private blankStatus() {
    return {
      stage: 'Won' as OpportunityStage, poNumber: '', poDate: todayIso(), winningReasonId: null as number | null,
      losingReasonId: null as number | null, closedDate: todayIso(), remark: '',
    };
  }

  private post(action: string, body: object, done: string, reloadQuotes = false): void {
    this.busy.set(true);
    this.dialogError.set(null);
    this.http.post<OpportunityDetail>(`/api/opportunities/${this.id()}/${action}`, body).subscribe({
      next: (o) => {
        this.busy.set(false);
        this.dialog.set(null);
        this.opp.set(o);
        this.toast.show(done);
        if (reloadQuotes) this.loadQuotes();
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
    this.http.get<OpportunityDetail>(`/api/opportunities/${this.id()}`).subscribe({
      next: (o) => this.opp.set(o),
      error: (err: unknown) => this.error.set(problemMessage(err, 'This opportunity could not be loaded.')),
    });
    this.loadQuotes();
  }

  private loadQuotes(): void {
    this.http.get<QuotationItem[]>(`/api/opportunities/${this.id()}/quotations`).subscribe({
      next: (list) => this.quotations.set(list),
      error: () => this.quotations.set([]),
    });
  }
}
