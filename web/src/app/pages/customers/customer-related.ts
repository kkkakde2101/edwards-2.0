import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { P, PagedResult } from '../../core/models';
import { LEAD_PILL, LeadListItem, OpportunityListItem, STAGE_PILL, TransferItem, VisitListItem } from '../../core/sales-models';
import { AssetListItem, COVERAGE_LABELS, COVERAGE_PILL } from '../../core/service-models';
import { formatDate, formatMoney } from '../../core/support';
import { CanDirective } from '../../shared/ui';
import { DocumentsPanel } from '../../shared/documents';

type Tab = 'opportunities' | 'leads' | 'visits' | 'assets' | 'documents' | 'transfers';

/** Everything linked to one customer, each tab shown only to roles that may see it. */
@Component({
  selector: 'app-customer-related',
  imports: [RouterLink, CanDirective, DocumentsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs" role="tablist">
      @for (t of tabs(); track t.key) {
        <button type="button" role="tab" [class.active]="tab() === t.key" [attr.aria-selected]="tab() === t.key" (click)="open(t.key)">{{ t.label }}</button>
      }
    </div>

    @switch (tab()) {
      @case ('opportunities') {
        <section class="panel">
          <div class="panel-heading"><h3>Opportunities</h3>
            <a *appCan="P.opportunitiesCreate" class="btn btn-primary btn-sm" routerLink="/opportunities/new" [queryParams]="{ customerId: customerId() }"><i class="fa-solid fa-plus"></i> Add opportunity</a></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Opportunity</th><th>Type</th><th>Status</th><th class="num">Value</th><th>Expected closing</th><th>Dealer</th></tr></thead>
            <tbody>
              @for (o of opportunities(); track o.id) {
                <tr><td><a [routerLink]="['/opportunities', o.id]">{{ o.name }}</a></td><td>{{ o.type }}</td><td><span [class]="'pill ' + stagePill[o.stage]">{{ o.stage }}</span></td>
                  <td class="num nowrap">{{ money(o.value) }}</td><td class="nowrap">{{ date(o.expectedCloseDate) || '—' }}</td><td>{{ o.dealer }}</td></tr>
              } @empty { <tr class="empty"><td colspan="6">No opportunities.</td></tr> }
            </tbody>
          </table></div>
        </section>
      }
      @case ('leads') {
        <section class="panel">
          <div class="panel-heading"><h3>Leads</h3></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Lead</th><th>Source</th><th>Status</th><th>Engineer</th><th>Created</th></tr></thead>
            <tbody>
              @for (l of leads(); track l.id) {
                <tr><td><a [routerLink]="['/leads', l.id]">{{ l.name }}</a></td><td>{{ l.source }}</td><td><span [class]="'pill ' + leadPill[l.status]">{{ l.status }}</span></td>
                  <td>{{ l.dealerUser || '—' }}</td><td class="nowrap">{{ date(l.createdAt) }}</td></tr>
              } @empty { <tr class="empty"><td colspan="5">No leads.</td></tr> }
            </tbody>
          </table></div>
        </section>
      }
      @case ('visits') {
        <section class="panel">
          <div class="panel-heading"><h3>Visits</h3>
            <a *appCan="P.visitsCreate" class="btn btn-primary btn-sm" routerLink="/visits/new"><i class="fa-solid fa-plus"></i> Record visit</a></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Date</th><th>Type</th><th>Engineer</th><th>Potential</th><th>Product range</th></tr></thead>
            <tbody>
              @for (v of visits(); track v.id) {
                <tr><td class="nowrap"><a [routerLink]="['/visits', v.id]">{{ date(v.visitDate) }}</a></td><td>{{ v.visitType }}</td><td>{{ v.dealerUser || '—' }}</td>
                  <td>{{ v.hasPotential ? 'Yes' : 'No' }}</td><td>{{ v.productRange || '—' }}</td></tr>
              } @empty { <tr class="empty"><td colspan="5">No visits.</td></tr> }
            </tbody>
          </table></div>
        </section>
      }
      @case ('assets') {
        <section class="panel">
          <div class="panel-heading"><h3>Assets</h3>
            <a *appCan="P.assetsCreate" class="btn btn-primary btn-sm" routerLink="/assets/new" [queryParams]="{ customerId: customerId() }"><i class="fa-solid fa-plus"></i> Register asset</a></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Serial number</th><th>Model</th><th>Site</th><th>Coverage</th><th>Next service</th></tr></thead>
            <tbody>
              @for (a of assets(); track a.id) {
                <tr><td class="nowrap"><a [routerLink]="['/assets', a.id]">{{ a.serialNumber }}</a></td><td>{{ a.model || '—' }}</td><td>{{ a.city }}</td>
                  <td><span [class]="'pill ' + coveragePill[a.coverage]">{{ coverage[a.coverage] }}</span></td><td class="nowrap">{{ date(a.nextServiceDate) || '—' }}</td></tr>
              } @empty { <tr class="empty"><td colspan="5">No assets registered.</td></tr> }
            </tbody>
          </table></div>
        </section>
      }
      @case ('documents') {
        <app-documents ownerType="Customer" [ownerId]="customerId()" [allForCustomer]="true" />
      }
      @case ('transfers') {
        <section class="panel">
          <div class="panel-heading"><h3>Dealer transfers</h3>
            <a *appCan="P.transfersRequest" class="btn btn-primary btn-sm" routerLink="/transfers"><i class="fa-solid fa-right-left"></i> Request transfer</a></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>From</th><th>To</th><th>Effective</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              @for (t of transfers(); track t.id) {
                <tr><td>{{ t.fromDealer }}</td><td>{{ t.toDealer }}</td><td class="nowrap">{{ date(t.effectiveDate) }}</td><td>{{ t.status }}</td><td>{{ t.reason }}</td></tr>
              } @empty { <tr class="empty"><td colspan="5">This customer has always been with its dealer.</td></tr> }
            </tbody>
          </table></div>
        </section>
      }
    }
  `,
  styles: `
    .tabs { display: flex; flex-wrap: wrap; gap: 2px; margin: 4px 0 12px; border-bottom: 2px solid var(--edw-border); }
    .tabs button { border: 0; background: none; padding: 8px 16px; font: inherit; color: var(--edw-muted); cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
    .tabs button.active { color: var(--edw-red-dark); border-bottom-color: var(--edw-red); font-weight: 600; }
  `,
})
export class CustomerRelated implements OnInit {
  readonly customerId = input.required<number>();
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly money = formatMoney;
  protected readonly stagePill = STAGE_PILL;
  protected readonly leadPill = LEAD_PILL;
  protected readonly coverage = COVERAGE_LABELS;
  protected readonly coveragePill = COVERAGE_PILL;
  protected readonly tabs = computed(() => {
    const all: { key: Tab; label: string; permission: string }[] = [
      { key: 'opportunities', label: 'Opportunities', permission: P.opportunitiesView },
      { key: 'leads', label: 'Leads', permission: P.leadsView },
      { key: 'visits', label: 'Visits', permission: P.visitsView },
      { key: 'assets', label: 'Assets', permission: P.assetsView },
      { key: 'documents', label: 'Documents', permission: P.documentsView },
      { key: 'transfers', label: 'Transfers', permission: P.transfersView },
    ];
    const granted = this.auth.permissions();
    return all.filter((t) => granted.has(t.permission));
  });
  protected readonly tab = signal<Tab | null>(null);
  protected readonly opportunities = signal<OpportunityListItem[]>([]);
  protected readonly leads = signal<LeadListItem[]>([]);
  protected readonly visits = signal<VisitListItem[]>([]);
  protected readonly assets = signal<AssetListItem[]>([]);
  protected readonly transfers = signal<TransferItem[]>([]);
  private readonly loaded = new Set<Tab>();

  ngOnInit(): void {
    const first = this.tabs()[0];
    if (first) this.open(first.key);
  }

  protected open(tab: Tab): void {
    this.tab.set(tab);
    if (this.loaded.has(tab) || tab === 'documents') return;
    this.loaded.add(tab);
    const params = { customerId: this.customerId(), pageSize: 100 };
    const get = <T>(url: string, extra: Record<string, string> = {}) => this.http.get<PagedResult<T>>(url, { params: { ...params, ...extra } });
    if (tab === 'opportunities') get<OpportunityListItem>('/api/opportunities', { stage: '', sort: 'created' }).subscribe((r) => this.opportunities.set(r.items));
    if (tab === 'leads') get<LeadListItem>('/api/leads').subscribe((r) => this.leads.set(r.items));
    if (tab === 'visits') get<VisitListItem>('/api/visits').subscribe((r) => this.visits.set(r.items));
    if (tab === 'assets') get<AssetListItem>('/api/assets', { status: 'all' }).subscribe((r) => this.assets.set(r.items));
    if (tab === 'transfers') get<TransferItem>('/api/transfers').subscribe((r) => this.transfers.set(r.items));
  }
}
