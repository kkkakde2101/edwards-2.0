import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { P } from '../../core/models';
import { DealerTargetRow, TargetSheet } from '../../core/sales-models';
import { fieldErrors, formatMoney, LookupService, problemMessage, ToastService } from '../../core/support';
import { CanDirective, Modal } from '../../shared/ui';

/** Edwards' fiscal year runs April to March and is named by the year it starts in. */
function currentFiscalYear(): number {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

function label(year: number): string {
  return `FY ${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

@Component({
  selector: 'app-targets',
  imports: [FormsModule, RouterLink, CanDirective, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Dealer targets</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Sales</span><span>/</span><span>Dealer targets</span></div>
      </div>
      <div class="actions">
        <label for="fy" class="sr-only">Fiscal year</label>
        <select id="fy" class="input fy" [ngModel]="year()" (ngModelChange)="year.set(+$event); load()">
          @for (y of years; track y) { <option [ngValue]="y">{{ fyLabel(y) }}</option> }
        </select>
      </div>
    </div>

    @if (sheet(); as s) {
      <div class="tiles">
        <div class="tile"><span>Target</span><strong>{{ money(totals().target) }}</strong></div>
        <div class="tile"><span>Achieved (won)</span><strong>{{ money(totals().achieved) }}</strong></div>
        <div class="tile"><span>Achievement</span><strong>{{ totals().target ? (totals().achieved / totals().target * 100).toFixed(1) + '%' : '—' }}</strong></div>
        <div class="tile"><span>Won opportunities</span><strong>{{ totals().won }}</strong></div>
      </div>

      <section class="panel">
        <div class="panel-heading"><h3>{{ s.label }} <span class="count">{{ s.dealers.length }} dealers</span></h3></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Dealer</th><th>Zone</th><th class="num">Target</th><th class="num">Achieved</th><th>Progress</th><th class="num">Won</th><th class="num">Ranges</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              @for (d of s.dealers; track d.dealerId) {
                <tr>
                  <td><button type="button" class="link-btn" (click)="toggle(d.dealerId)" [attr.aria-expanded]="expanded() === d.dealerId">{{ d.dealer }}</button></td>
                  <td>{{ d.zone }}</td>
                  <td class="num nowrap">{{ d.targetValue ? money(d.targetValue) : '—' }}</td>
                  <td class="num nowrap">{{ money(d.achievedValue) }}</td>
                  <td class="progress-cell">
                    @if (d.targetValue) {
                      <div class="bar" role="img" [attr.aria-label]="percent(d) + '% of target'"><span [style.width.%]="Math.min(100, percent(d))"></span></div>
                      <small>{{ percent(d) }}%</small>
                    } @else { <span class="muted">No target</span> }
                  </td>
                  <td class="num">{{ d.wonCount }}</td>
                  <td class="num">{{ d.ranges.length }}</td>
                  <td class="row-actions">
                    <button *appCan="P.targetsEdit" type="button" class="icon-btn" (click)="edit(d)" [attr.aria-label]="'Set target for ' + d.dealer" title="Set target"><i class="fa-solid fa-pen"></i></button>
                  </td>
                </tr>
                @if (expanded() === d.dealerId) {
                  <tr class="detail-row">
                    <td colspan="8">
                      @if (d.ranges.length) {
                        <table class="table inner">
                          <thead><tr><th>Product range</th><th class="num">Target qty</th><th class="num">Achieved qty</th><th class="num">Target value</th><th class="num">Achieved value</th></tr></thead>
                          <tbody>
                            @for (r of d.ranges; track r.productRangeId) {
                              <tr><td>{{ r.productRange }}</td><td class="num">{{ r.targetQuantity }}</td><td class="num">{{ r.achievedQuantity }}</td><td class="num">{{ money(r.targetValue) }}</td><td class="num">{{ money(r.achievedValue) }}</td></tr>
                            }
                          </tbody>
                        </table>
                      } @else { <span class="muted">No product range targets or wins this year.</span> }
                    </td>
                  </tr>
                }
              } @empty {
                <tr class="empty"><td colspan="8">No dealers in your scope.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (error()) {
      <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div>
    } @else {
      <div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading targets…</div>
    }

    @if (editing(); as d) {
      <app-modal [title]="'Target for ' + d.dealer + ', ' + fyLabel(year())" [wide]="true" (closed)="editing.set(null)">
        <form (ngSubmit)="save(d)">
          <div class="panel-body">
            @if (saveError()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ saveError() }}</div> }
            <div class="field">
              <label for="tValue">Value target for the year (₹)<span class="req">*</span></label>
              <input id="tValue" name="tValue" class="input value" type="number" min="0" [(ngModel)]="targetValue">
            </div>
            <h4 class="sub-title">By product range</h4>
            <table class="table">
              <thead><tr><th>Product range</th><th class="num">Quantity</th><th class="num">Value (₹)</th><th><span class="sr-only">Remove</span></th></tr></thead>
              <tbody>
                @for (r of rangeRows; track $index; let i = $index) {
                  <tr>
                    <td>
                      <select class="input" [name]="'r' + i" [(ngModel)]="r.productRangeId" [attr.aria-label]="'Product range, row ' + (i + 1)">
                        <option [ngValue]="null">Choose…</option>
                        @for (x of ranges(); track x.id) { <option [ngValue]="x.id">{{ x.name }}</option> }
                      </select>
                    </td>
                    <td><input class="input num" type="number" min="0" [name]="'q' + i" [(ngModel)]="r.targetQuantity" [attr.aria-label]="'Quantity, row ' + (i + 1)"></td>
                    <td><input class="input num" type="number" min="0" [name]="'v' + i" [(ngModel)]="r.targetValue" [attr.aria-label]="'Value, row ' + (i + 1)"></td>
                    <td class="row-actions"><button type="button" class="icon-btn" (click)="rangeRows.splice(i, 1)" [attr.aria-label]="'Remove row ' + (i + 1)"><i class="fa-solid fa-xmark"></i></button></td>
                  </tr>
                }
              </tbody>
            </table>
            <button type="button" class="btn btn-light btn-sm" (click)="rangeRows.push({ productRangeId: null, targetQuantity: 0, targetValue: 0 })"><i class="fa-solid fa-plus"></i> Add range</button>
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="editing.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Save target</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styles: `
    .fy { width: 150px; }
    .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .tile { background: #fff; border: 1px solid var(--edw-border); border-top: 3px solid var(--edw-red); padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
    .tile span { font-size: 12px; color: var(--edw-muted); text-transform: uppercase; letter-spacing: .04em; }
    .tile strong { font-size: 18px; color: var(--edw-slate); }
    .progress-cell { min-width: 140px; }
    .bar { display: inline-block; width: 100px; height: 8px; background: #eceeef; vertical-align: middle; margin-right: 6px; }
    .bar span { display: block; height: 100%; background: var(--edw-green); }
    .detail-row > td { background: #fafafa; }
    .inner { margin: 4px 0; }
    .value { max-width: 240px; }
    .sub-title { margin: 16px 0 8px; font-size: 15px; color: var(--edw-slate); }
    .table .input.num { text-align: right; }
    @media (max-width: 767px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `,
})
export class Targets {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  protected readonly P = P;
  protected readonly Math = Math;
  protected readonly money = formatMoney;
  protected readonly fyLabel = label;
  protected readonly years = [currentFiscalYear() + 1, currentFiscalYear(), currentFiscalYear() - 1, currentFiscalYear() - 2, currentFiscalYear() - 3];
  protected readonly ranges = toSignal(inject(LookupService).master('product-ranges'), { initialValue: [] });
  protected readonly year = signal(currentFiscalYear());
  protected readonly sheet = signal<TargetSheet | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<number | null>(null);
  protected readonly editing = signal<DealerTargetRow | null>(null);
  protected readonly busy = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly totals = computed(() => {
    const rows = this.sheet()?.dealers ?? [];
    return {
      target: rows.reduce((n, d) => n + d.targetValue, 0),
      achieved: rows.reduce((n, d) => n + d.achievedValue, 0),
      won: rows.reduce((n, d) => n + d.wonCount, 0),
    };
  });
  protected targetValue = 0;
  protected rangeRows: { productRangeId: number | null; targetQuantity: number; targetValue: number }[] = [];

  constructor() {
    this.load();
  }

  protected load(): void {
    this.sheet.set(null);
    this.error.set(null);
    this.http.get<TargetSheet>('/api/targets', { params: { fiscalYear: this.year() } }).subscribe({
      next: (s) => this.sheet.set(s),
      error: (err: unknown) => this.error.set(problemMessage(err, 'Targets could not be loaded.')),
    });
  }

  protected percent(d: DealerTargetRow): number {
    return d.targetValue ? Math.round((d.achievedValue / d.targetValue) * 1000) / 10 : 0;
  }

  protected toggle(dealerId: number): void {
    this.expanded.set(this.expanded() === dealerId ? null : dealerId);
  }

  protected edit(d: DealerTargetRow): void {
    this.targetValue = d.targetValue;
    this.rangeRows = d.ranges.filter((r) => r.targetQuantity || r.targetValue)
      .map((r) => ({ productRangeId: r.productRangeId, targetQuantity: r.targetQuantity, targetValue: r.targetValue }));
    this.saveError.set(null);
    this.editing.set(d);
  }

  protected save(d: DealerTargetRow): void {
    const ranges = this.rangeRows.filter((r) => r.productRangeId !== null)
      .map((r) => ({ productRangeId: r.productRangeId!, targetQuantity: Number(r.targetQuantity) || 0, targetValue: Number(r.targetValue) || 0 }));
    this.busy.set(true);
    this.http.put<void>(`/api/targets/${d.dealerId}/${this.year()}`, { targetValue: Number(this.targetValue) || 0, ranges }).subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set(null);
        this.toast.show(`Target saved for ${d.dealer}.`);
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.saveError.set(Object.values(fieldErrors(err))[0] ?? problemMessage(err));
      },
    });
  }
}
