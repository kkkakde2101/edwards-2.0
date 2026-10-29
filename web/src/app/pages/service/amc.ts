import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Option, P } from '../../core/models';
import { AmcItem, AmcState, AssetListItem, COVERAGE_LABELS, COVERAGE_PILL } from '../../core/service-models';
import { addDays, daysFromToday, fieldErrors, formatDate, formatMoney, LookupService, PagedList, problemMessage, todayIso, ToastService } from '../../core/support';
import { CustomerPicker } from '../../shared/pickers';
import { CanDirective, Modal, Pager } from '../../shared/ui';

const STATE_PILL: Record<AmcState, string> = { Upcoming: 'pill-info', Active: 'pill-active', Ending: 'pill-warn', Expired: 'pill-red', Cancelled: 'pill-inactive' };

/** Warranty and AMC: what is covered, what ends soon, and the AMC contracts themselves. */
@Component({
  selector: 'app-amc',
  imports: [FormsModule, RouterLink, Pager, CanDirective, Modal, CustomerPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Warranty and AMC</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Service</span><span>/</span><span>Warranty and AMC</span></div>
      </div>
      <button *appCan="P.amcEdit" type="button" class="btn btn-primary" (click)="openNew()"><i class="fa-solid fa-plus"></i> Add AMC contract</button>
    </div>

    <div class="tabs" role="tablist">
      <button type="button" role="tab" [class.active]="tab() === 'coverage'" [attr.aria-selected]="tab() === 'coverage'" (click)="tab.set('coverage'); loadAssets(1)">Coverage of assets</button>
      <button type="button" role="tab" [class.active]="tab() === 'contracts'" [attr.aria-selected]="tab() === 'contracts'" (click)="tab.set('contracts'); loadContracts(1)">AMC contracts</button>
    </div>

    @if (tab() === 'coverage') {
      <section class="panel">
        <div class="panel-heading">
          <h3>Assets @if (assets.result(); as r) { <span class="count">{{ r.total }}</span> }</h3>
          <div class="actions">
            <label for="cov" class="sr-only">Coverage</label>
            <select id="cov" class="input narrow" [(ngModel)]="coverage" (ngModelChange)="loadAssets(1)">
              <option value="ending">Ending in 60 days</option>
              <option value="warranty">In warranty</option>
              <option value="amc">Under AMC</option>
              <option value="expired">Not covered</option>
              <option value="">All</option>
            </select>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Asset</th><th>Customer</th><th>Dealer</th><th>Coverage</th><th>Warranty end</th><th>AMC end</th><th>Next service</th></tr></thead>
            <tbody>
              @for (a of assets.result()?.items ?? []; track a.id) {
                <tr>
                  <td class="nowrap"><a [routerLink]="['/assets', a.id]">{{ a.serialNumber }}</a><div class="hint">{{ a.model }}</div></td>
                  <td>{{ a.customer }}</td>
                  <td>{{ a.dealer }}</td>
                  <td><span [class]="'pill ' + coveragePill[a.coverage]">{{ coverageLabel[a.coverage] }}</span></td>
                  <td class="nowrap">{{ date(a.warrantyEnd) || '—' }} @if (a.warrantyEnd && left(a.warrantyEnd) >= 0 && left(a.warrantyEnd) <= 60) { <div class="hint">{{ left(a.warrantyEnd) }} days left</div> }</td>
                  <td class="nowrap">{{ date(a.amcEnd) || '—' }}</td>
                  <td class="nowrap">{{ date(a.nextServiceDate) || '—' }}</td>
                </tr>
              } @empty {
                <tr class="empty"><td colspan="7">{{ assets.loading() ? 'Loading…' : 'No assets in this group.' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (assets.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="loadAssets($event)" /> }
      </section>
    } @else {
      <section class="panel">
        <div class="panel-heading">
          <h3>Contracts @if (contracts.result(); as r) { <span class="count">{{ r.total }}</span> }</h3>
          <div class="actions">
            <label for="cst" class="sr-only">Status</label>
            <select id="cst" class="input narrow" [(ngModel)]="state" (ngModelChange)="loadContracts(1)">
              <option value="current">Running now</option>
              <option value="ending">Ending in 60 days</option>
              <option value="upcoming">Starting later</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Asset</th><th>Customer</th><th>Type</th><th>Period</th><th class="num">Visits / year</th><th class="num">Value</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              @for (c of contracts.result()?.items ?? []; track c.id) {
                <tr>
                  <td class="nowrap"><a [routerLink]="['/assets', c.assetId]">{{ c.serialNumber }}</a><div class="hint">{{ c.model }}</div></td>
                  <td>{{ c.customer }}<div class="hint">{{ c.dealer }}</div></td>
                  <td>{{ c.amcType || '—' }}</td>
                  <td class="nowrap">{{ date(c.startDate) }} – {{ date(c.endDate) }}</td>
                  <td class="num">{{ c.visitsPerYear }}</td>
                  <td class="num nowrap">{{ c.value !== null ? money(c.value) : '—' }}</td>
                  <td><span [class]="'pill ' + statePill[c.state]">{{ c.state }}</span></td>
                  <td class="row-actions">
                    @if (c.state !== 'Cancelled') {
                      <ng-container *appCan="P.amcEdit">
                        <button type="button" class="icon-btn" (click)="openEdit(c)" [attr.aria-label]="'Edit contract for ' + c.serialNumber" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" class="icon-btn" (click)="cancel(c)" [attr.aria-label]="'Cancel contract for ' + c.serialNumber" title="Cancel"><i class="fa-solid fa-ban"></i></button>
                      </ng-container>
                    }
                  </td>
                </tr>
              } @empty {
                <tr class="empty"><td colspan="8">{{ contracts.loading() ? 'Loading…' : 'No contracts in this group.' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (contracts.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="loadContracts($event)" /> }
      </section>
    }

    @if (editing(); as e) {
      <app-modal [title]="e === 'new' ? 'Add AMC contract' : 'Edit AMC contract'" (closed)="editing.set(null)">
        <form (ngSubmit)="save()">
          <div class="panel-body form-grid two">
            @if (e === 'new') {
              <div class="field full">
                <label for="mCustomer">Customer<span class="req">*</span></label>
                <app-customer-picker inputId="mCustomer" (picked)="customerPicked($event)" />
              </div>
              <div class="field full">
                <label for="mAsset">Asset<span class="req">*</span></label>
                <select id="mAsset" name="mAsset" class="input" [(ngModel)]="form.assetId">
                  <option [ngValue]="null">Choose…</option>
                  @for (a of customerAssets(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
                </select>
              </div>
            }
            <div class="field">
              <label for="mType">AMC type</label>
              <select id="mType" name="mType" class="input" [(ngModel)]="form.amcTypeId">
                <option [ngValue]="null">Not set</option>
                @for (t of types(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
              </select>
            </div>
            <div class="field">
              <label for="mVisits">Visits a year</label>
              <input id="mVisits" name="mVisits" class="input" type="number" min="0" max="12" [(ngModel)]="form.visitsPerYear">
            </div>
            <div class="field">
              <label for="mStart">Starts<span class="req">*</span></label>
              <input id="mStart" name="mStart" class="input" type="date" [(ngModel)]="form.startDate">
            </div>
            <div class="field">
              <label for="mEnd">Ends<span class="req">*</span></label>
              <input id="mEnd" name="mEnd" class="input" type="date" [(ngModel)]="form.endDate">
            </div>
            <div class="field">
              <label for="mValue">Value (₹)</label>
              <input id="mValue" name="mValue" class="input" type="number" min="0" [(ngModel)]="form.value">
            </div>
            <div class="field full">
              <label for="mRemark">Remarks</label>
              <input id="mRemark" name="mRemark" class="input" maxlength="1000" [(ngModel)]="form.remark">
            </div>
            @if (formError()) { <div class="field full"><span class="field-error">{{ formError() }}</span></div> }
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="editing.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Save contract</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styles: `
    .tabs { display: flex; gap: 2px; margin-bottom: 12px; border-bottom: 2px solid var(--edw-border); }
    .tabs button { border: 0; background: none; padding: 8px 16px; font: inherit; color: var(--edw-muted); cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
    .tabs button.active { color: var(--edw-red-dark); border-bottom-color: var(--edw-red); font-weight: 600; }
    .narrow { width: 190px; height: 28px; }
  `,
})
export class Amc {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly money = formatMoney;
  protected readonly coverageLabel = COVERAGE_LABELS;
  protected readonly coveragePill = COVERAGE_PILL;
  protected readonly statePill = STATE_PILL;
  protected readonly types = toSignal(this.lookups.master('amc-types'), { initialValue: [] });
  protected readonly tab = signal<'coverage' | 'contracts'>('coverage');
  protected readonly assets = new PagedList<AssetListItem>(this.http, '/api/assets', 'Assets could not be loaded.');
  protected readonly contracts = new PagedList<AmcItem>(this.http, '/api/amc', 'Contracts could not be loaded.');
  protected readonly editing = signal<AmcItem | 'new' | null>(null);
  protected readonly customerAssets = signal<Option[]>([]);
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected coverage = 'ending';
  protected state = 'current';
  protected form = this.blank();

  constructor() {
    this.loadAssets(1);
  }

  protected left(date: string): number {
    return daysFromToday(date) ?? 0;
  }

  protected loadAssets(page: number): void {
    this.assets.load({ coverage: this.coverage, page, pageSize: 25 });
  }

  protected loadContracts(page: number): void {
    this.contracts.load({ status: this.state, page, pageSize: 25 });
  }

  protected openNew(): void {
    this.form = this.blank();
    this.customerAssets.set([]);
    this.formError.set(null);
    this.editing.set('new');
  }

  protected openEdit(c: AmcItem): void {
    this.form = { assetId: c.assetId, amcTypeId: c.amcTypeId, startDate: c.startDate, endDate: c.endDate, visitsPerYear: c.visitsPerYear,
      value: c.value, remark: c.remark ?? '' };
    this.formError.set(null);
    this.editing.set(c);
  }

  protected customerPicked(c: Option | null): void {
    this.form.assetId = null;
    this.customerAssets.set([]);
    if (c) this.lookups.customerAssets(c.id).subscribe((a) => this.customerAssets.set(a));
  }

  protected save(): void {
    const e = this.editing();
    if (!e) return;
    if (!this.form.assetId) return this.formError.set('Choose the asset.');
    const body = { ...this.form, remark: this.form.remark.trim() || null };
    const request = e === 'new' ? this.http.post<AmcItem>('/api/amc', body) : this.http.put<AmcItem>(`/api/amc/${e.id}`, body);
    this.busy.set(true);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set(null);
        this.toast.show(e === 'new' ? 'AMC contract added.' : 'AMC contract saved.');
        this.tab.set('contracts');
        this.loadContracts(1);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.formError.set(Object.values(fieldErrors(err))[0] ?? problemMessage(err));
      },
    });
  }

  protected cancel(c: AmcItem): void {
    this.http.post<AmcItem>(`/api/amc/${c.id}/cancel`, {}).subscribe({
      next: () => {
        this.toast.show('Contract cancelled.');
        this.loadContracts(this.contracts.result()?.page ?? 1);
      },
      error: (err: unknown) => this.toast.show(problemMessage(err), 'error'),
    });
  }

  private blank() {
    return { assetId: null as number | null, amcTypeId: null as number | null, startDate: todayIso(), endDate: addDays(todayIso(), 364),
      visitsPerYear: 2, value: null as number | null, remark: '' };
  }
}
