import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { WorkSummary } from '../core/admin-models';
import { DashboardSummary, NameCount, P, SCOPE_LABELS } from '../core/models';
import { formatDate, formatMoneyShort, formatNumber, problemMessage } from '../core/support';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p class="sub">Showing {{ scope() }}.</p>
      </div>
    </div>

    @if (error()) {
      <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div>
    }

    @if (work(); as w) {
      @if (w.myWork.length) {
        <section class="panel">
          <div class="panel-heading"><h3>Waiting for you <span class="count">{{ w.myWork.length }}</span></h3></div>
          <ul class="work">
            @for (item of w.myWork; track $index) {
              <li>
                <span class="kind">{{ item.kind }}</span>
                <a [routerLink]="item.link">{{ item.title }}</a>
                <span class="muted">{{ item.detail }}</span>
                <span class="due" [class.late]="late(item.due)">{{ item.due ? date(item.due) : '' }}</span>
              </li>
            }
          </ul>
        </section>
      }

      @if (w.sales; as s) {
        <h2 class="section">Sales · {{ w.fiscalYear }}</h2>
        <div class="tiles">
          <a class="tile" routerLink="/opportunities"><span class="label">Open pipeline</span><span class="value">{{ money(s.pipelineValue) }}</span><span class="note">{{ s.openOpportunities }} opportunities · {{ s.openLeads }} open leads</span><i class="fa-solid fa-chart-line"></i></a>
          <div class="tile"><span class="label">Won this year</span><span class="value">{{ money(s.wonValue) }}</span><span class="note">{{ s.wonCount }} won{{ s.targetValue ? ' · ' + pct(s.wonValue, s.targetValue) + ' of ' + money(s.targetValue) + ' target' : '' }}</span><i class="fa-solid fa-trophy"></i></div>
          <div class="tile"><span class="label">Quotations to review</span><span class="value">{{ s.quotationsAwaiting }}</span><span class="note">{{ s.awaitingAcceptance }} opportunities not yet accepted by the dealer</span><i class="fa-solid fa-file-invoice"></i></div>
          <div class="tile"><span class="label">Follow-ups overdue</span><span class="value">{{ s.followUpsOverdue }}</span><span class="note">Open opportunities past their next follow-up date</span><i class="fa-solid fa-bell"></i></div>
        </div>
        <div class="grid">
          <section class="panel">
            <div class="panel-heading"><h3>Opportunities by status</h3></div>
            <div class="panel-body">
              @for (row of s.byStage; track row.stage) {
                <div class="bar-row" [title]="row.stage + ': ' + row.count + ' opportunities, ' + money(row.value)">
                  <span class="bar-label">{{ row.stage }}</span>
                  <span class="bar-track"><span class="bar-fill" [style.width.%]="shareOf(row.count, s.byStage)"></span></span>
                  <span class="bar-value">{{ row.count }}</span>
                </div>
              } @empty { <p class="muted">No opportunities yet.</p> }
            </div>
          </section>
          <section class="panel">
            <div class="panel-heading"><h3>Won value by month</h3></div>
            <div class="panel-body">
              <div class="columns" role="img" [attr.aria-label]="'Won value by month: ' + monthsText(s.wonByMonth)">
                @for (m of s.wonByMonth; track m.month) {
                  <div class="col" [title]="m.month + ': ' + money(m.value) + ' from ' + m.count + ' won'">
                    <span class="col-value">{{ m.value ? money(m.value) : '' }}</span>
                    <span class="col-track"><span class="col-fill" [style.height.%]="monthShare(m.value, s.wonByMonth)"></span></span>
                    <span class="col-label">{{ m.month }}</span>
                  </div>
                }
              </div>
            </div>
          </section>
        </div>
      }

      @if (w.service; as v) {
        <h2 class="section">Service</h2>
        <div class="tiles">
          <a class="tile" routerLink="/jobs"><span class="label">Open service jobs</span><span class="value">{{ v.openJobs }}</span><span class="note">{{ v.highPriorityJobs }} high priority · {{ v.commissioningOpen }} commissioning planned</span><i class="fa-solid fa-screwdriver-wrench"></i></a>
          <a class="tile" routerLink="/reminders"><span class="label">Service due in 30 days</span><span class="value">{{ v.remindersDue }}</span><span class="note">Reminders to follow up</span><i class="fa-solid fa-calendar-check"></i></a>
          <a class="tile" routerLink="/amc"><span class="label">Warranty ending</span><span class="value">{{ v.warrantyEnding }}</span><span class="note">In 60 days, no AMC yet · {{ v.amcEnding }} AMC ending</span><i class="fa-solid fa-shield-halved"></i></a>
          <a class="tile" routerLink="/assets"><span class="label">Installed assets</span><span class="value">{{ num(v.assets) }}</span><span class="note">Active units in your scope</span><i class="fa-solid fa-gears"></i></a>
        </div>
      }
    }

    @if (data(); as d) {
      <h2 class="section">Customers</h2>
      <div class="tiles">
        <div class="tile">
          <span class="label">Active customers</span>
          <span class="value">{{ d.activeCustomers }}</span>
          <i class="fa-solid fa-building"></i>
        </div>
        <div class="tile">
          <span class="label">Contacts</span>
          <span class="value">{{ d.contacts }}</span>
          <i class="fa-solid fa-address-book"></i>
        </div>
        <div class="tile">
          <span class="label">New in the last 30 days</span>
          <span class="value">{{ d.newLast30Days }}</span>
          <i class="fa-solid fa-calendar-plus"></i>
        </div>
        <div class="tile">
          <span class="label">Customers without a city</span>
          <span class="value">{{ d.missingCity }}</span>
          <i class="fa-solid fa-location-dot"></i>
        </div>
      </div>
      @if (d.missingCity > 0) {
        <div class="alert alert-info">
          <i class="fa-solid fa-circle-info"></i>
          <span>City is a new required field. Customers moved from today's system do not have one yet; it is asked for the next time each customer is edited.</span>
        </div>
      }

      <div class="grid">
        <section class="panel">
          <div class="panel-heading"><h3>Customers by business line</h3></div>
          <div class="panel-body">
            @for (row of d.byBusinessLine; track row.name) {
              <div class="bar-row">
                <span class="bar-label">{{ row.name }}</span>
                <span class="bar-track"><span class="bar-fill" [style.width.%]="share(row, d.byBusinessLine)"></span></span>
                <span class="bar-value">{{ row.count }}</span>
              </div>
            } @empty {
              <p class="muted">No customers yet.</p>
            }
          </div>
        </section>
        <section class="panel">
          <div class="panel-heading"><h3>Top segments</h3></div>
          <div class="panel-body">
            @for (row of d.bySegment; track row.name) {
              <div class="bar-row">
                <span class="bar-label">{{ row.name }}</span>
                <span class="bar-track"><span class="bar-fill" [style.width.%]="share(row, d.bySegment)"></span></span>
                <span class="bar-value">{{ row.count }}</span>
              </div>
            } @empty {
              <p class="muted">No customers yet.</p>
            }
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="panel-heading">
          <h3>Recently added customers</h3>
          @if (canSeeCustomers()) { <a routerLink="/customers" class="btn btn-light btn-sm">All customers</a> }
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Customer</th><th>City</th><th>Dealer</th><th>Added</th></tr></thead>
            <tbody>
              @for (c of d.recent; track c.id) {
                <tr class="clickable" [routerLink]="['/customers', c.id]">
                  <td>{{ c.name }}</td>
                  <td>{{ c.city || '—' }}</td>
                  <td>{{ c.dealer }}</td>
                  <td class="nowrap">{{ date(c.customerDate) }}</td>
                </tr>
              } @empty {
                <tr class="empty"><td colspan="4">No customers yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (!error()) {
      <div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading the dashboard…</div>
    }
  `,
  styles: `
    .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
    .tile { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; min-height: 92px; overflow: hidden; color: #fff; background: var(--edw-gradient); }
    .tile .label { font-size: 13px; font-weight: 600; opacity: .9; }
    .tile .value { font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .tile i { position: absolute; right: 14px; bottom: 10px; font-size: 40px; opacity: .2; }
    a.tile { text-decoration: none; }
    .tile .note { font-size: 12px; opacity: .85; margin-top: 2px; }
    .section { font-size: 16px; font-weight: 600; color: var(--edw-slate); margin: 6px 0 10px; }
    .work { list-style: none; margin: 0; padding: 0; }
    .work li { display: grid; grid-template-columns: 130px minmax(0, 1fr) minmax(0, 1fr) 100px; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #eee; }
    .work .kind { font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--edw-red-dark); }
    .work .due { text-align: right; font-size: 13px; color: var(--edw-muted); }
    .work .due.late { color: var(--edw-error); font-weight: 600; }
    .columns { display: flex; align-items: flex-end; gap: 6px; height: 180px; }
    .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; min-width: 0; }
    .col-value { font-size: 10px; color: var(--edw-muted); white-space: nowrap; height: 14px; }
    .col-track { flex: 1; width: 100%; max-width: 32px; display: flex; align-items: flex-end; }
    .col-fill { display: block; width: 100%; background: var(--edw-red); border-radius: 4px 4px 0 0; min-height: 0; }
    .col-label { font-size: 12px; color: var(--edw-muted); }
    @media (max-width: 767px) { .work li { grid-template-columns: minmax(0, 1fr); gap: 2px; } .work .due { text-align: left; } }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
    .bar-row { display: grid; grid-template-columns: minmax(90px, 160px) minmax(0, 1fr) 44px; gap: 10px; align-items: center; padding: 5px 0; font-size: 13px; }
    .bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { height: 12px; background: #eef0f1; }
    .bar-fill { display: block; height: 100%; background: var(--edw-gradient); }
    .bar-value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    @media (max-width: 991px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class Dashboard {
  private readonly auth = inject(AuthService);
  protected readonly data = signal<DashboardSummary | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly scope = computed(() => {
    const me = this.auth.me();
    if (!me) return '';
    return me.scope === 'Dealer' && me.dealerName ? `${me.dealerName} customers` : SCOPE_LABELS[me.scope].toLowerCase();
  });
  protected readonly canSeeCustomers = computed(() => this.auth.can(P.customersView));
  protected readonly date = formatDate;

  protected readonly work = signal<WorkSummary | null>(null);
  protected readonly money = formatMoneyShort;
  protected readonly num = formatNumber;

  constructor() {
    const http = inject(HttpClient);
    http.get<WorkSummary>('/api/dashboard/work').subscribe({ next: (w) => this.work.set(w), error: () => this.work.set(null) });
    http
      .get<DashboardSummary>('/api/dashboard/summary')
      .subscribe({
        next: (d) => this.data.set(d),
        error: (err: unknown) => this.error.set(problemMessage(err, 'The dashboard could not be loaded.')),
      });
  }

  protected late(due: string | null): boolean {
    return !!due && due < new Date().toISOString().slice(0, 10);
  }

  protected pct(part: number, whole: number): string {
    return `${Math.round((part / whole) * 100)}%`;
  }

  protected shareOf(count: number, rows: { count: number }[]): number {
    const max = Math.max(...rows.map((r) => r.count), 1);
    return Math.max(2, (count / max) * 100);
  }

  protected monthShare(value: number, months: { value: number }[]): number {
    const max = Math.max(...months.map((m) => m.value), 1);
    return value ? Math.max(3, (value / max) * 100) : 0;
  }

  protected monthsText(months: { month: string; value: number }[]): string {
    return months.map((m) => `${m.month} ${formatMoneyShort(m.value)}`).join(', ');
  }

  protected share(row: NameCount, rows: NameCount[]): number {
    const max = Math.max(...rows.map((r) => r.count), 1);
    return Math.max(2, (row.count / max) * 100);
  }
}
