import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AlertSettingItem, EmailDetail, EmailItem, EmailStatus } from '../../core/admin-models';
import { AuthService } from '../../core/auth.service';
import { P } from '../../core/models';
import { formatDateTime, PagedList, problemMessage, ToastService } from '../../core/support';
import { CanDirective, Modal, Pager } from '../../shared/ui';

const EMAIL_PILL: Record<EmailStatus, string> = { Pending: 'pill-warn', Sent: 'pill-active', Failed: 'pill-red' };

/** Which alerts are sent and whether they are emailed, plus the log of every email the system sent. */
@Component({
  selector: 'app-alert-settings',
  imports: [FormsModule, RouterLink, Pager, CanDirective, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Alerts and email</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Administration</span><span>/</span><span>Alerts and email</span></div>
      </div>
      <button *appCan="P.settingsEdit" type="button" class="btn btn-light" (click)="runJobs()" [disabled]="busy()"><i class="fa-solid fa-clock-rotate-left"></i> Run daily alerts now</button>
    </div>

    <section class="panel">
      <div class="panel-heading"><h3>Alert settings</h3></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Alert</th><th>Sent when</th><th>Goes to</th><th class="center">On</th><th class="center">Email</th></tr></thead>
          <tbody>
            @for (s of settings(); track s.type) {
              <tr>
                <td><strong>{{ s.label }}</strong> @if (s.mandatory) { <span class="pill pill-inactive">Always sent</span> }</td>
                <td>{{ s.when }}</td>
                <td class="muted">{{ s.recipients }}</td>
                <td class="center"><input type="checkbox" [checked]="s.enabled" [disabled]="s.mandatory || !canEdit" (change)="toggle(s, 'enabled')" [attr.aria-label]="s.label + ' on'"></td>
                <td class="center"><input type="checkbox" [checked]="s.sendEmail" [disabled]="s.mandatory || !canEdit || !s.enabled" (change)="toggle(s, 'sendEmail')" [attr.aria-label]="s.label + ' by email'"></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <h3>Email log @if (emails.result(); as r) { <span class="count">{{ r.total }}</span> }</h3>
        <div class="actions">
          <input class="input narrow" type="search" placeholder="Recipient or subject" aria-label="Search emails" [(ngModel)]="search" (keyup.enter)="load(1)">
          <select class="input narrow" aria-label="Email status" [(ngModel)]="status" (ngModelChange)="load(1)">
            <option [ngValue]="null">All</option><option value="Pending">Waiting</option><option value="Sent">Sent</option><option value="Failed">Failed</option>
          </select>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Queued</th><th>To</th><th>Subject</th><th>Status</th><th class="num">Tries</th><th>Sent</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            @for (m of emails.result()?.items ?? []; track m.id) {
              <tr>
                <td class="nowrap">{{ dateTime(m.createdAt) }}</td>
                <td>{{ m.to }}</td>
                <td><button type="button" class="link-btn" (click)="preview(m)">{{ m.subject }}</button></td>
                <td><span [class]="'pill ' + pill[m.status]">{{ m.status }}</span> @if (m.lastError) { <div class="hint">{{ m.lastError }}</div> }</td>
                <td class="num">{{ m.attempts }}</td>
                <td class="nowrap">{{ dateTime(m.sentAt) || '—' }}</td>
                <td class="row-actions">@if (m.status === 'Failed') { <button *appCan="P.settingsEdit" type="button" class="btn btn-light btn-sm" (click)="retry(m)">Retry</button> }</td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="7">{{ emails.loading() ? 'Loading…' : 'No emails.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (emails.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="load($event)" /> }
    </section>

    @if (previewing(); as p) {
      <app-modal [title]="p.subject" [wide]="true" (closed)="previewing.set(null)">
        <div class="panel-body">
          <p class="muted">To {{ p.to }} · {{ dateTime(p.createdAt) }}</p>
          <iframe class="email" sandbox="" title="Email preview" [srcdoc]="previewHtml()"></iframe>
        </div>
      </app-modal>
    }
  `,
  styles: `
    .center { text-align: center; width: 70px; }
    .center input { width: 17px; height: 17px; accent-color: var(--edw-red); }
    .narrow { width: 200px; height: 28px; }
    .email { width: 100%; height: 460px; border: 1px solid var(--edw-border); background: #fafafa; }
  `,
})
export class AlertSettings {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly P = P;
  protected readonly canEdit = inject(AuthService).can(P.settingsEdit);
  protected readonly dateTime = formatDateTime;
  protected readonly pill = EMAIL_PILL;
  protected readonly settings = signal<AlertSettingItem[]>([]);
  protected readonly emails = new PagedList<EmailItem>(this.http, '/api/alerts/emails', 'The email log could not be loaded.');
  protected readonly previewing = signal<EmailDetail | null>(null);
  protected readonly previewHtml = signal<SafeHtml>('');
  protected readonly busy = signal(false);
  protected search = '';
  protected status: EmailStatus | null = null;

  constructor() {
    this.http.get<AlertSettingItem[]>('/api/alerts/settings').subscribe((list) => this.settings.set(list));
    this.load(1);
  }

  protected load(page: number): void {
    this.emails.load({ search: this.search, status: this.status, page, pageSize: 20 });
  }

  protected toggle(s: AlertSettingItem, field: 'enabled' | 'sendEmail'): void {
    const next = { enabled: s.enabled, sendEmail: s.sendEmail, [field]: !s[field] };
    if (field === 'enabled' && !next.enabled) next.sendEmail = false;
    if (field === 'enabled' && next.enabled) next.sendEmail = true;
    this.http.put<AlertSettingItem>(`/api/alerts/settings/${s.type}`, next).subscribe({
      next: (saved) => {
        this.settings.update((list) => list.map((x) => (x.type === saved.type ? saved : x)));
        this.toast.show(`${saved.label}: ${saved.enabled ? (saved.sendEmail ? 'on, with email' : 'on, in the app only') : 'off'}.`);
      },
      error: (err: unknown) => this.toast.show(problemMessage(err), 'error'),
    });
  }

  /** Shown in a sandboxed frame with scripts disabled, so the email keeps its layout without running anything. */
  protected preview(m: EmailItem): void {
    this.http.get<EmailDetail>(`/api/alerts/emails/${m.id}`).subscribe((d) => {
      this.previewHtml.set(this.sanitizer.bypassSecurityTrustHtml(d.body));
      this.previewing.set(d);
    });
  }

  protected retry(m: EmailItem): void {
    this.http.post<void>(`/api/alerts/emails/${m.id}/retry`, {}).subscribe({
      next: () => {
        this.toast.show('The email will be sent again shortly.');
        this.load(this.emails.result()?.page ?? 1);
      },
      error: (err: unknown) => this.toast.show(problemMessage(err), 'error'),
    });
  }

  protected runJobs(): void {
    this.busy.set(true);
    this.http.post<Record<string, number>>('/api/alerts/run-daily-jobs', {}).subscribe({
      next: (r) => {
        this.busy.set(false);
        const total = Object.values(r).reduce((a, b) => a + b, 0);
        this.toast.show(total ? `Daily alerts ran: ${total} items handled.` : 'Daily alerts ran: nothing new to send.');
        this.load(1);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.toast.show(problemMessage(err), 'error');
      },
    });
  }
}
