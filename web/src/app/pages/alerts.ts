import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, of, Subject, switchMap } from 'rxjs';
import { NotificationItem, RecipientOption } from '../core/admin-models';
import { Option, PagedResult } from '../core/models';
import { formatDateTime, LookupService, problemMessage, ToastService } from '../core/support';
import { Pager } from '../shared/ui';

/** Unread count for the header bell, refreshed every minute and after the user reads something. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  readonly unread = signal(0);
  readonly latest = signal<NotificationItem[]>([]);

  refresh(): void {
    this.http.get<{ count: number }>('/api/notifications/unread-count').subscribe({ next: (r) => this.unread.set(r.count), error: () => {} });
  }

  loadLatest(): void {
    this.http.get<PagedResult<NotificationItem>>('/api/notifications', { params: { pageSize: 8 } }).subscribe({
      next: (r) => this.latest.set(r.items),
      error: () => this.latest.set([]),
    });
  }

  markRead(n: NotificationItem): void {
    if (n.readAt) return;
    this.http.post<void>(`/api/notifications/${n.id}/read`, {}).subscribe(() => this.refresh());
  }

  markAllRead(): void {
    this.http.post<void>('/api/notifications/read-all', {}).subscribe(() => {
      this.unread.set(0);
      this.latest.update((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    });
  }
}

@Component({
  selector: 'app-notifications',
  imports: [FormsModule, RouterLink, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Notifications</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Notifications</span></div>
      </div>
      <div class="actions">
        <label class="check"><input type="checkbox" [(ngModel)]="unreadOnly" (ngModelChange)="load(1)"> Unread only</label>
        <button type="button" class="btn btn-light" (click)="readAll()"><i class="fa-solid fa-check-double"></i> Mark all read</button>
      </div>
    </div>
    <section class="panel">
      @for (n of result()?.items ?? []; track n.id) {
        <button type="button" class="note" [class.unread]="!n.readAt" (click)="open(n)">
          <div class="title">{{ n.title }}</div>
          <div class="body">{{ n.body }}</div>
          <div class="hint">{{ dateTime(n.createdAt) }}</div>
        </button>
      } @empty {
        <div class="panel-body muted">{{ loading() ? 'Loading…' : 'No notifications.' }}</div>
      }
      @if (result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="load($event)" /> }
    </section>
  `,
  styles: `
    .note { display: block; width: 100%; text-align: left; padding: 10px 14px; border: 0; border-bottom: 1px solid #eee; background: #fff; cursor: pointer; font: inherit; color: inherit; }
    .note:hover { background: #f7f8f8; }
    .note.unread { border-left: 4px solid var(--edw-red); background: #fdf6f6; }
    .title { font-weight: 600; color: var(--edw-slate); }
    .body { white-space: pre-line; margin: 2px 0; }
  `,
})
export class Notifications {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly service = inject(NotificationService);
  protected readonly dateTime = formatDateTime;
  protected readonly result = signal<PagedResult<NotificationItem> | null>(null);
  protected readonly loading = signal(false);
  protected unreadOnly = false;

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.loading.set(true);
    this.http.get<PagedResult<NotificationItem>>('/api/notifications', { params: { page, pageSize: 20, unread: this.unreadOnly } }).subscribe({
      next: (r) => {
        this.loading.set(false);
        this.result.set(r);
      },
      error: () => this.loading.set(false),
    });
  }

  protected open(n: NotificationItem): void {
    this.service.markRead(n);
    this.result.update((r) => (r ? { ...r, items: r.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) } : r));
    if (n.link) void this.router.navigateByUrl(n.link);
  }

  protected readAll(): void {
    this.service.markAllRead();
    this.result.update((r) => (r ? { ...r, items: r.items.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) } : r));
  }
}

/** Sends a message to chosen users, roles or dealers, in the app and by email. */
@Component({
  selector: 'app-send-alert',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Send alert</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Send alert</span></div>
      </div>
    </div>
    <form class="panel" (ngSubmit)="send()">
      <div class="panel-heading"><h3>Message</h3></div>
      <div class="panel-body">
        @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
        <div class="form-grid two">
          <div class="field full">
            <label for="sUsers">People</label>
            <div class="chips">
              @for (u of users(); track u.id) {
                <span class="chip">{{ u.name }} <button type="button" (click)="removeUser(u.id)" [attr.aria-label]="'Remove ' + u.name"><i class="fa-solid fa-xmark"></i></button></span>
              }
            </div>
            <div class="picker">
              <input id="sUsers" name="sUsers" class="input" type="search" autocomplete="off" placeholder="Type a name to add people" [(ngModel)]="query" (ngModelChange)="search$.next($event)">
              @if (matches().length) {
                <ul class="picker-list">
                  @for (m of matches(); track m.id) {
                    <li (mousedown)="addUser(m)">{{ m.name }} <span class="muted">· {{ m.role }}{{ m.dealer ? ' · ' + m.dealer : '' }}</span></li>
                  }
                </ul>
              }
            </div>
          </div>
          <div class="field">
            <label for="sRoles">Everyone with these roles</label>
            <select id="sRoles" name="sRoles" class="input multi" multiple [(ngModel)]="roleIds">
              @for (r of roles(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="sDealers">Everyone at these dealers</label>
            <select id="sDealers" name="sDealers" class="input multi" multiple [(ngModel)]="dealerIds">
              @for (d of dealers(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
            </select>
          </div>
          <div class="field full">
            <label for="sTitle">Subject<span class="req">*</span></label>
            <input id="sTitle" name="sTitle" class="input" maxlength="150" [(ngModel)]="title">
          </div>
          <div class="field full">
            <label for="sMessage">Message<span class="req">*</span></label>
            <textarea id="sMessage" name="sMessage" class="input" rows="6" maxlength="900" [(ngModel)]="message"></textarea>
            <span class="hint">{{ message.length }} / 900. Your name is added at the end.</span>
          </div>
          <div class="field full">
            <label class="check"><input type="checkbox" name="sEmail" [(ngModel)]="sendEmail"> Also send by email</label>
          </div>
        </div>
      </div>
      <div class="panel-footer">
        <button type="submit" class="btn btn-primary" [disabled]="busy()"><i class="fa-solid fa-paper-plane"></i> Send</button>
      </div>
    </form>
  `,
  styles: `
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; border-radius: 12px; background: #f6e9ea; color: var(--edw-red-dark); }
    .chip button { border: 0; background: none; color: inherit; cursor: pointer; }
    .picker { position: relative; }
    .picker-list { position: absolute; z-index: 50; left: 0; right: 0; top: 100%; margin: 2px 0 0; padding: 0; list-style: none; max-height: 260px; overflow-y: auto; background: #fff; border: 1px solid var(--edw-border); box-shadow: 0 6px 16px rgba(0,0,0,.15); }
    .picker-list li { padding: 7px 10px; cursor: pointer; }
    .picker-list li:hover { background: #f6e9ea; }
    .multi { height: 140px; }
  `,
})
export class SendAlert {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly roles = toSignal(this.lookups.roles(), { initialValue: [] as Option[] });
  protected readonly dealers = toSignal(this.lookups.dealers(), { initialValue: [] });
  protected readonly users = signal<RecipientOption[]>([]);
  protected readonly matches = signal<RecipientOption[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly search$ = new Subject<string>();
  protected query = '';
  protected roleIds: number[] = [];
  protected dealerIds: number[] = [];
  protected title = '';
  protected message = '';
  protected sendEmail = true;

  constructor() {
    this.search$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => (q.trim().length >= 2 ? this.http.get<RecipientOption[]>('/api/alerts/recipients', { params: { search: q.trim() } }) : of([]))),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => this.matches.set(list.filter((m) => !this.users().some((u) => u.id === m.id))));
  }

  protected addUser(u: RecipientOption): void {
    this.users.update((list) => [...list, u]);
    this.matches.set([]);
    this.query = '';
  }

  protected removeUser(id: number): void {
    this.users.update((list) => list.filter((u) => u.id !== id));
  }

  protected send(): void {
    this.error.set(null);
    if (!this.users().length && !this.roleIds.length && !this.dealerIds.length) return this.error.set('Choose at least one person, role or dealer.');
    if (this.title.trim().length < 3 || this.message.trim().length < 3) return this.error.set('Write a subject and a message.');
    this.busy.set(true);
    this.http.post<{ recipients: number }>('/api/alerts/send', {
      userIds: this.users().map((u) => u.id), roleIds: this.roleIds, dealerIds: this.dealerIds,
      title: this.title.trim(), message: this.message.trim(), sendEmail: this.sendEmail,
    }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.toast.show(`Alert sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}.`);
        this.users.set([]);
        this.roleIds = [];
        this.dealerIds = [];
        this.title = '';
        this.message = '';
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const body = (err as { error?: { errors?: Record<string, string[]> } }).error;
        this.error.set(Object.values(body?.errors ?? {})[0]?.[0] ?? problemMessage(err, 'The alert could not be sent.'));
      },
    });
  }
}
