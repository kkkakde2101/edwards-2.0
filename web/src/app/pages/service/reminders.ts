import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { P } from '../../core/models';
import { ReminderItem, ReminderStatus } from '../../core/service-models';
import { daysFromToday, formatDate, PagedList, problemMessage, ToastService } from '../../core/support';
import { CanDirective, Modal, Pager } from '../../shared/ui';

const STATUS_PILL: Record<ReminderStatus, string> = { Pending: 'pill-warn', Contacted: 'pill-info', Converted: 'pill-active', Dismissed: 'pill-inactive' };

/**
 * Service reminders raised 30 days before an asset's next service. The dealer calls the customer, then raises a job
 * (covered by warranty or AMC) or a paid service opportunity, or dismisses the reminder with a reason.
 */
@Component({
  selector: 'app-reminders',
  imports: [FormsModule, RouterLink, Pager, CanDirective, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Service reminders</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Service</span><span>/</span><span>Service reminders</span></div>
      </div>
    </div>

    <form class="panel" (ngSubmit)="load(1)">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="rq">Serial or customer</label>
          <input id="rq" name="q" class="input" type="search" [(ngModel)]="search" placeholder="Type to search">
        </div>
        <div class="field">
          <label for="rs">Status</label>
          <select id="rs" name="rs" class="input" [(ngModel)]="status">
            <option value="open">To follow up</option>
            <option value="">All</option>
            <option value="Pending">Not contacted</option>
            <option value="Contacted">Contacted</option>
            <option value="Converted">Converted</option>
            <option value="Dismissed">Dismissed</option>
          </select>
        </div>
        <div class="field">
          <label for="rd">Due</label>
          <select id="rd" name="rd" class="input" [(ngModel)]="due">
            <option value="">Any time</option>
            <option value="overdue">Overdue</option>
            <option value="week">In the next 7 days</option>
          </select>
        </div>
        <div class="actions"><button type="submit" class="btn btn-primary">Search</button></div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>Reminders @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      @if (list.error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ list.error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Due</th><th>Asset</th><th>Customer</th><th>Last service</th><th>Cover</th><th>Status</th><th>Notes</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            @for (r of list.result()?.items ?? []; track r.id) {
              <tr>
                <td class="nowrap" [class.overdue]="left(r.dueDate) < 0 && open(r)">{{ date(r.dueDate) }}
                  @if (open(r)) { <div class="hint">{{ left(r.dueDate) < 0 ? -left(r.dueDate) + ' days overdue' : 'in ' + left(r.dueDate) + ' days' }}</div> }</td>
                <td class="nowrap"><a [routerLink]="['/assets', r.assetId]">{{ r.serialNumber }}</a><div class="hint">{{ r.model }}</div></td>
                <td>{{ r.customer }}<div class="hint">{{ r.city }} · {{ r.dealer }}</div></td>
                <td class="nowrap">{{ date(r.lastServiceDate) || '—' }}</td>
                <td>@if (r.covered) { <span class="pill pill-active">Warranty / AMC</span> } @else { <span class="pill pill-warn">Chargeable</span> }</td>
                <td><span [class]="'pill ' + pill[r.status]">{{ r.status }}</span>
                  @if (r.serviceJobId) { <div><a [routerLink]="['/jobs', r.serviceJobId]">Service job</a></div> }
                  @if (r.opportunityId) { <div><a [routerLink]="['/opportunities', r.opportunityId]">Opportunity</a></div> }</td>
                <td class="notes">{{ r.notes || r.dismissReason || '—' }}</td>
                <td class="row-actions">
                  @if (open(r)) {
                    <ng-container *appCan="P.remindersEdit">
                      <button type="button" class="btn btn-light btn-sm" (click)="openNote(r, 'contacted')">Log call</button>
                      @if (can(P.jobsCreate)) { <button type="button" class="btn btn-primary btn-sm" (click)="raise(r, 'job')" [disabled]="busy()">Raise job</button> }
                      @if (can(P.opportunitiesCreate) && !r.covered) { <button type="button" class="btn btn-light btn-sm" (click)="raise(r, 'opportunity')" [disabled]="busy()">Quote service</button> }
                      <button type="button" class="btn btn-light btn-sm" (click)="openNote(r, 'dismiss')">Dismiss</button>
                    </ng-container>
                  }
                </td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="8">{{ list.loading() ? 'Loading reminders…' : 'No reminders to show.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="load($event)" /> }
    </section>

    @if (noting(); as n) {
      <app-modal [title]="n.action === 'contacted' ? 'Log the call with ' + n.reminder.customer : 'Dismiss the reminder'" (closed)="noting.set(null)">
        <form (ngSubmit)="saveNote()">
          <div class="panel-body">
            <div class="field">
              <label for="rText">{{ n.action === 'contacted' ? 'What did the customer say?' : 'Why is no service needed?' }}<span class="req">*</span></label>
              <textarea id="rText" name="rText" class="input" rows="3" maxlength="500" [(ngModel)]="text"></textarea>
              @if (noteError()) { <span class="field-error">{{ noteError() }}</span> }
            </div>
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="noting.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ n.action === 'contacted' ? 'Save' : 'Dismiss' }}</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styles: `
    .overdue { color: var(--edw-error); font-weight: 600; }
    .notes { white-space: pre-line; max-width: 280px; }
    .row-actions { white-space: normal !important; min-width: 220px; }
    .row-actions .btn { margin: 2px; }
  `,
})
export class Reminders {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly pill = STATUS_PILL;
  protected readonly list = new PagedList<ReminderItem>(this.http, '/api/reminders', 'Reminders could not be loaded.');
  protected readonly noting = signal<{ reminder: ReminderItem; action: 'contacted' | 'dismiss' } | null>(null);
  protected readonly noteError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected search = '';
  protected status = 'open';
  protected due = '';
  protected text = '';

  constructor() {
    this.load(1);
  }

  protected can(permission: string): boolean {
    return this.auth.can(permission);
  }

  protected open(r: ReminderItem): boolean {
    return r.status === 'Pending' || r.status === 'Contacted';
  }

  protected left(date: string): number {
    return daysFromToday(date) ?? 0;
  }

  protected load(page: number): void {
    this.list.load({ search: this.search, status: this.status, due: this.due, page, pageSize: 25 });
  }

  protected openNote(reminder: ReminderItem, action: 'contacted' | 'dismiss'): void {
    this.text = '';
    this.noteError.set(null);
    this.noting.set({ reminder, action });
  }

  protected saveNote(): void {
    const n = this.noting();
    if (!n) return;
    if (this.text.trim().length < 3) {
      this.noteError.set('Write a few words.');
      return;
    }
    this.busy.set(true);
    this.http.post(`/api/reminders/${n.reminder.id}/${n.action}`, { text: this.text.trim() }).subscribe({
      next: () => {
        this.busy.set(false);
        this.noting.set(null);
        this.toast.show(n.action === 'contacted' ? 'Call logged.' : 'Reminder dismissed.');
        this.load(this.list.result()?.page ?? 1);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.noteError.set(problemMessage(err));
      },
    });
  }

  protected raise(r: ReminderItem, kind: 'job' | 'opportunity'): void {
    this.busy.set(true);
    this.http.post<{ serviceJobId: number | null; opportunityId: number | null }>(`/api/reminders/${r.id}/${kind}`, {}).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.toast.show(kind === 'job' ? 'Service job raised.' : 'Service opportunity created.');
        void this.router.navigate(kind === 'job' ? ['/jobs', res.serviceJobId] : ['/opportunities', res.opportunityId]);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.toast.show(problemMessage(err), 'error');
      },
    });
  }
}
