import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ColumnType, ReportDefinition, ReportTable } from '../core/admin-models';
import { P } from '../core/models';
import { formatDate, formatMoney, formatNumber, LookupService, problemMessage, saveFile, toParams, ToastService } from '../core/support';
import { CanDirective } from '../shared/ui';

function currentFiscalYear(): number {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

@Component({
  selector: 'app-report-list',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Reports</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Reports</span></div>
      </div>
    </div>
    @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
    @for (g of groups(); track g.name) {
      <h2 class="group">{{ g.name }}</h2>
      <div class="cards">
        @for (r of g.items; track r.key) {
          <a class="card" [routerLink]="['/reports', r.key]">
            <strong>{{ r.title }}</strong>
            <span>{{ r.description }}</span>
          </a>
        }
      </div>
    }
  `,
  styles: `
    .group { font-size: 15px; font-weight: 600; color: var(--edw-slate); margin: 8px 0 10px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card { display: flex; flex-direction: column; gap: 6px; padding: 14px; background: #fff; border: 1px solid var(--edw-border); border-left: 4px solid var(--edw-red); text-decoration: none; color: var(--edw-text); }
    .card:hover { box-shadow: 0 3px 10px rgba(0,0,0,.08); }
    .card strong { color: var(--edw-slate); }
    .card span { color: var(--edw-muted); font-size: 13px; }
  `,
})
export class ReportList {
  protected readonly reports = signal<ReportDefinition[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly groups = computed(() => {
    const out: { name: string; items: ReportDefinition[] }[] = [];
    for (const r of this.reports()) {
      let g = out.find((x) => x.name === r.group);
      if (!g) out.push((g = { name: r.group, items: [] }));
      g.items.push(r);
    }
    return out;
  });

  constructor() {
    inject(HttpClient).get<ReportDefinition[]>('/api/reports').subscribe({
      next: (list) => this.reports.set(list),
      error: (err: unknown) => this.error.set(problemMessage(err, 'Reports could not be loaded.')),
    });
  }
}

@Component({
  selector: 'app-report-view',
  imports: [FormsModule, RouterLink, CanDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>{{ definition()?.title ?? 'Report' }}</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><a routerLink="/reports">Reports</a><span>/</span><span>{{ definition()?.title }}</span></div>
      </div>
      <div class="actions">
        <a class="btn btn-dark" routerLink="/reports"><i class="fa-solid fa-arrow-left"></i> All reports</a>
        <button *appCan="P.reportsExport" type="button" class="btn btn-primary" (click)="export()" [disabled]="exporting() || !table()"><i class="fa-solid fa-file-excel"></i> Export to Excel</button>
      </div>
    </div>

    @if (definition(); as d) {
      <form class="panel" (ngSubmit)="run()">
        <div class="panel-heading"><h3>{{ d.description }}</h3></div>
        <div class="panel-body filters">
          @if (has('fiscalYear')) {
            <div class="field">
              <label for="rFy">Fiscal year</label>
              <select id="rFy" name="fy" class="input" [(ngModel)]="fiscalYear">
                @for (y of years; track y) { <option [ngValue]="y">FY {{ y }}-{{ (y + 1) % 100 }}</option> }
              </select>
            </div>
          }
          @if (has('dateRange')) {
            <div class="field"><label for="rFrom">From</label><input id="rFrom" name="from" class="input" type="date" [(ngModel)]="from"></div>
            <div class="field"><label for="rTo">To</label><input id="rTo" name="to" class="input" type="date" [(ngModel)]="to"></div>
          }
          @if (has('dealer')) {
            <div class="field">
              <label for="rDealer">Dealer</label>
              <select id="rDealer" name="dealer" class="input" [(ngModel)]="dealerId">
                <option [ngValue]="null">All dealers</option>
                @for (x of dealers(); track x.id) { <option [ngValue]="x.id">{{ x.name }}</option> }
              </select>
            </div>
          }
          @if (has('stage')) {
            <div class="field">
              <label for="rStage">Status</label>
              <select id="rStage" name="stage" class="input" [(ngModel)]="stage">
                <option value="">All</option>
                <option value="open">Open and postponed</option>
                <option value="Won">Won</option>
                <option value="Lost">Lost</option>
                <option value="Dropped">Dropped</option>
              </select>
            </div>
          }
          <div class="actions"><button type="submit" class="btn btn-primary">Run report</button></div>
        </div>
      </form>
    }

    <section class="panel">
      <div class="panel-heading"><h3>{{ table()?.subtitle ?? 'Results' }} @if (table(); as t) { <span class="count">{{ t.rows.length }} rows</span> }</h3></div>
      @if (error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          @if (table(); as t) {
            <thead><tr>@for (c of t.columns; track $index) { <th [class.num]="numeric(c.type)">{{ c.label }}</th> }</tr></thead>
            <tbody>
              @for (row of t.rows; track $index) {
                <tr>@for (c of t.columns; track $index; let i = $index) { <td [class.num]="numeric(c.type)" [class.nowrap]="c.type !== 'Text'">{{ cell(row[i], c.type) }}</td> }</tr>
              } @empty {
                <tr class="empty"><td [attr.colspan]="t.columns.length">No rows for these filters.</td></tr>
              }
            </tbody>
            @if (t.totals && t.rows.length) {
              <tfoot><tr>@for (c of t.columns; track $index; let i = $index) { <th [class.num]="numeric(c.type)">{{ cell(t.totals[i], c.type) }}</th> }</tr></tfoot>
            }
          } @else {
            <tbody><tr class="empty"><td>{{ loading() ? 'Running the report…' : 'Choose filters and run the report.' }}</td></tr></tbody>
          }
        </table>
      </div>
    </section>
  `,
})
export class ReportView implements OnInit {
  readonly key = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  protected readonly P = P;
  protected readonly dealers = toSignal(inject(LookupService).dealers(), { initialValue: [] });
  protected readonly definition = signal<ReportDefinition | null>(null);
  protected readonly table = signal<ReportTable | null>(null);
  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly years = [currentFiscalYear(), currentFiscalYear() - 1, currentFiscalYear() - 2, currentFiscalYear() - 3, currentFiscalYear() - 4];
  protected fiscalYear = currentFiscalYear();
  protected from = `${currentFiscalYear()}-04-01`;
  protected to = '';
  protected dealerId: number | null = null;
  protected stage = '';

  ngOnInit(): void {
    this.http.get<ReportDefinition[]>('/api/reports').subscribe((list) => {
      this.definition.set(list.find((r) => r.key === this.key()) ?? null);
      this.run();
    });
  }

  protected has(filter: string): boolean {
    return this.definition()?.filters.includes(filter) ?? false;
  }

  protected numeric(type: ColumnType): boolean {
    return type === 'Number' || type === 'Money' || type === 'Percent';
  }

  protected cell(value: string | number | null, type: ColumnType): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return type === 'Date' ? formatDate(value) : value;
    if (type === 'Money') return formatMoney(value);
    if (type === 'Percent') return `${(value * 100).toFixed(1)}%`;
    return formatNumber(value);
  }

  protected run(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<ReportTable>(`/api/reports/${this.key()}`, { params: this.params() }).subscribe({
      next: (t) => {
        this.loading.set(false);
        this.table.set(t);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(problemMessage(err, 'The report could not be run.'));
      },
    });
  }

  protected export(): void {
    this.exporting.set(true);
    saveFile(this.http, `/api/reports/${this.key()}/export`, this.params(), `edwards-${this.key()}.xlsx`).subscribe({
      next: () => this.exporting.set(false),
      error: (err: unknown) => {
        this.exporting.set(false);
        this.toast.show(problemMessage(err, 'The export failed.'), 'error');
      },
    });
  }

  private params() {
    return toParams({
      fiscalYear: this.has('fiscalYear') ? this.fiscalYear : null,
      from: this.has('dateRange') ? this.from : null,
      to: this.has('dateRange') ? this.to : null,
      dealerId: this.has('dealer') ? this.dealerId : null,
      stage: this.has('stage') ? this.stage : null,
    });
  }
}
