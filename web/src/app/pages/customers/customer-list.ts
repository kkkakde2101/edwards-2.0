import { HttpClient, HttpParams } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CustomerListItem, P, PagedResult } from '../../core/models';
import { formatDate, LookupService, problemMessage } from '../../core/support';
import { CanDirective, Pager } from '../../shared/ui';

interface CustomerFilters {
  search: string;
  businessLineId: number | null;
  dealerId: number | null;
  status: 'active' | 'inactive' | 'all';
  sort: string;
  page: number;
  pageSize: number;
}

const DEFAULT_FILTERS: CustomerFilters = {
  search: '', businessLineId: null, dealerId: null, status: 'active', sort: '-date', page: 1, pageSize: 25,
};

/** Keeps the list filters while the user opens a customer and comes back. */
@Injectable({ providedIn: 'root' })
export class CustomerListState {
  readonly filters = signal<CustomerFilters>({ ...DEFAULT_FILTERS });
}

@Component({
  selector: 'app-customer-list',
  imports: [FormsModule, RouterLink, Pager, CanDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Customers</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Customers</span></div>
      </div>
      <a *appCan="P.customersCreate" class="btn btn-primary" routerLink="/customers/new">
        <i class="fa-solid fa-plus"></i> Create customer
      </a>
    </div>

    <form class="panel" (ngSubmit)="search()">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="q">Name, GST, city or pincode</label>
          <input id="q" name="q" class="input" type="search" [(ngModel)]="draft.search" placeholder="Type to search">
        </div>
        <div class="field">
          <label for="bl">Business line</label>
          <select id="bl" name="bl" class="input" [(ngModel)]="draft.businessLineId">
            <option [ngValue]="null">All</option>
            @for (b of businessLines(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="dealer">Dealer</label>
          <select id="dealer" name="dealer" class="input" [(ngModel)]="draft.dealerId">
            <option [ngValue]="null">All</option>
            @for (d of dealers(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="status">Status</label>
          <select id="status" name="status" class="input" [(ngModel)]="draft.status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-primary">Search</button>
          <button type="button" class="btn btn-dark" (click)="reset()">Reset</button>
        </div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading">
        <h3>Customer list @if (result(); as r) { <span class="count">{{ r.total }}</span> }</h3>
      </div>
      @if (error()) {
        <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div></div>
      }
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="sortable" (click)="sortBy('name')" [attr.aria-sort]="ariaSort('name')">Customer {{ sortMark('name') }}</th>
              <th>City</th>
              <th>District / state</th>
              <th>Pincode</th>
              <th>GST number</th>
              <th>Segment</th>
              <th>Business line</th>
              <th>Dealer</th>
              <th>Dealer engineer</th>
              <th class="num">Contacts</th>
              <th class="sortable" (click)="sortBy('date')" [attr.aria-sort]="ariaSort('date')">Date {{ sortMark('date') }}</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @if (loading() && !result()) {
              <tr class="empty"><td colspan="12"><i class="fa-solid fa-spinner fa-spin"></i> Loading customers…</td></tr>
            }
            @for (c of result()?.items ?? []; track c.id) {
              <tr class="clickable" (click)="open(c.id)">
                <td><a [routerLink]="['/customers', c.id]" (click)="$event.stopPropagation()">{{ c.name }}</a></td>
                <td>@if (c.city) { {{ c.city }} } @else { <span class="pill pill-warn">Not set</span> }</td>
                <td>{{ c.district }}{{ c.state ? ', ' + c.state : '' }}</td>
                <td class="nowrap">{{ c.pinCode }}</td>
                <td class="nowrap">{{ c.gst || '—' }}</td>
                <td>{{ c.segment }}</td>
                <td>{{ c.businessLine || '—' }}</td>
                <td>{{ c.dealer }}</td>
                <td>{{ c.dealerUser || '—' }}</td>
                <td class="num">{{ c.contacts }}</td>
                <td class="nowrap">{{ date(c.customerDate) }}</td>
                <td><span class="pill" [class.pill-active]="c.isActive" [class.pill-inactive]="!c.isActive">{{ c.isActive ? 'Active' : 'Inactive' }}</span></td>
              </tr>
            } @empty {
              @if (!loading()) {
                <tr class="empty"><td colspan="12">No customers match these filters.</td></tr>
              }
            }
          </tbody>
        </table>
      </div>
      @if (result(); as r) {
        <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="goTo($event)" />
      }
    </section>
  `,
})
export class CustomerList {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly state = inject(CustomerListState);
  private readonly lookups = inject(LookupService);

  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly businessLines = toSignal(this.lookups.master('business-lines'), { initialValue: [] });
  protected readonly dealers = toSignal(this.lookups.dealers(), { initialValue: [] });
  protected readonly result = signal<PagedResult<CustomerListItem> | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Values in the search form; applied when the user presses Search. */
  protected draft: CustomerFilters = { ...this.state.filters() };

  constructor() {
    this.load();
  }

  protected search(): void {
    this.apply({ ...this.draft, page: 1 });
  }

  protected reset(): void {
    this.draft = { ...DEFAULT_FILTERS };
    this.apply({ ...DEFAULT_FILTERS });
  }

  protected goTo(page: number): void {
    this.apply({ ...this.state.filters(), page });
  }

  protected sortBy(column: 'name' | 'date'): void {
    const current = this.state.filters().sort;
    const sort = current === column ? `-${column}` : current === `-${column}` ? column : column === 'date' ? '-date' : 'name';
    this.apply({ ...this.state.filters(), sort, page: 1 });
  }

  protected sortMark(column: string): string {
    const sort = this.state.filters().sort;
    return sort === column ? '▲' : sort === `-${column}` ? '▼' : '';
  }

  protected ariaSort(column: string): string | null {
    const sort = this.state.filters().sort;
    return sort === column ? 'ascending' : sort === `-${column}` ? 'descending' : null;
  }

  protected open(id: number): void {
    void this.router.navigate(['/customers', id]);
  }

  private apply(filters: CustomerFilters): void {
    this.state.filters.set(filters);
    this.load();
  }

  private load(): void {
    const f = this.state.filters();
    let params = new HttpParams()
      .set('status', f.status)
      .set('sort', f.sort)
      .set('page', f.page)
      .set('pageSize', f.pageSize);
    if (f.search.trim()) params = params.set('search', f.search.trim());
    if (f.businessLineId !== null) params = params.set('businessLineId', f.businessLineId);
    if (f.dealerId !== null) params = params.set('dealerId', f.dealerId);

    this.loading.set(true);
    this.error.set(null);
    this.http.get<PagedResult<CustomerListItem>>('/api/customers', { params }).subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(problemMessage(err, 'Customers could not be loaded.'));
      },
    });
  }
}
