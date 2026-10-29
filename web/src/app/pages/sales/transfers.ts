import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CustomerDetail, Option, P } from '../../core/models';
import { TransferItem, TransferStatus } from '../../core/sales-models';
import { controlError, fieldErrors, formatDate, formatDateTime, LookupService, PagedList, problemMessage, todayIso, ToastService } from '../../core/support';
import { CustomerPicker } from '../../shared/pickers';
import { CanDirective, Modal, Pager } from '../../shared/ui';

const STATUS_PILL: Record<TransferStatus, string> = { Pending: 'pill-warn', Approved: 'pill-active', Rejected: 'pill-red' };

/** Customer transfers between dealers: request, approve or reject, and when the move takes effect. */
@Component({
  selector: 'app-transfers',
  imports: [FormsModule, ReactiveFormsModule, RouterLink, Pager, CanDirective, Modal, CustomerPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Customer transfers</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Sales</span><span>/</span><span>Customer transfers</span></div>
      </div>
      <button *appCan="P.transfersRequest" type="button" class="btn btn-primary" (click)="openRequest()"><i class="fa-solid fa-right-left"></i> Request transfer</button>
    </div>

    <form class="panel" (ngSubmit)="load(1)">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="tq">Customer</label>
          <input id="tq" name="q" class="input" type="search" [(ngModel)]="search" placeholder="Customer name">
        </div>
        <div class="field">
          <label for="ts">Status</label>
          <select id="ts" name="ts" class="input" [(ngModel)]="status">
            <option [ngValue]="null">All</option>
            <option value="Pending">Waiting for approval</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>
        <div class="actions"><button type="submit" class="btn btn-primary">Search</button></div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>Transfers @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      @if (list.error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ list.error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Customer</th><th>From</th><th>To</th><th>New engineer</th><th>Effective</th><th>Reason</th><th>Status</th><th>Requested</th><th>Decision</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            @for (t of list.result()?.items ?? []; track t.id) {
              <tr>
                <td><a [routerLink]="['/customers', t.customerId]">{{ t.customer }}</a></td>
                <td>{{ t.fromDealer }}</td>
                <td>{{ t.toDealer }}</td>
                <td>{{ t.toDealerUser || '—' }}</td>
                <td class="nowrap">{{ date(t.effectiveDate) }}</td>
                <td>{{ t.reason }}</td>
                <td>
                  <span [class]="'pill ' + pill[t.status]">{{ t.status === 'Pending' ? 'Waiting' : t.status }}</span>
                  @if (t.status === 'Approved') { <div class="hint">{{ t.appliedAt ? 'Moved ' + date(t.appliedAt) : 'Moves on ' + date(t.effectiveDate) }}</div> }
                </td>
                <td class="nowrap">{{ t.requestedBy || '—' }}<div class="hint">{{ dateTime(t.requestedAt) }}</div></td>
                <td>@if (t.decidedAt) { {{ t.decidedBy || '—' }}<div class="hint">{{ dateTime(t.decidedAt) }}{{ t.decisionRemark ? ' · ' + t.decisionRemark : '' }}</div> } @else { — }</td>
                <td class="row-actions">
                  @if (t.status === 'Pending') {
                    <ng-container *appCan="P.transfersApprove">
                      <button type="button" class="btn btn-light btn-sm" (click)="decide(t, false)">Reject</button>
                      <button type="button" class="btn btn-primary btn-sm" (click)="decide(t, true)">Approve</button>
                    </ng-container>
                  }
                </td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="10">{{ list.loading() ? 'Loading transfers…' : 'No transfers match.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="load($event)" /> }
    </section>

    @if (requesting()) {
      <app-modal title="Request a customer transfer" (closed)="requesting.set(false)">
        <form [formGroup]="form" (ngSubmit)="request()" novalidate>
          <div class="panel-body">
            @if (formError()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ formError() }}</div> }
            <div class="form-grid two">
              <div class="field full">
                <label for="tCustomer">Customer<span class="req">*</span></label>
                <app-customer-picker inputId="tCustomer" formControlName="customerId" [invalid]="!!err('customerId')" (picked)="customerPicked($event)" />
                @if (current(); as c) { <span class="hint">Now with {{ c.dealer }}{{ c.dealerUser ? ' · ' + c.dealerUser : '' }}</span> }
                @if (err('customerId'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label for="tDealer">Move to dealer<span class="req">*</span></label>
                <select id="tDealer" class="input" formControlName="toDealerId" (change)="dealerChanged()" [class.invalid]="err('toDealerId')">
                  <option [ngValue]="null">Choose…</option>
                  @for (d of targetDealers(); track d.id) { <option [ngValue]="d.id">{{ d.name }} · {{ d.zone }}</option> }
                </select>
                @if (err('toDealerId'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label for="tEngineer">New dealer engineer</label>
                <select id="tEngineer" class="input" formControlName="toDealerUserId" [class.invalid]="err('toDealerUserId')">
                  <option [ngValue]="null">Let the dealer decide</option>
                  @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
                </select>
                @if (err('toDealerUserId'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label for="tDate">Effective from<span class="req">*</span></label>
                <input id="tDate" class="input" type="date" [min]="today" formControlName="effectiveDate" [class.invalid]="err('effectiveDate')">
                @if (err('effectiveDate'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field full">
                <label for="tReason">Reason<span class="req">*</span></label>
                <textarea id="tReason" class="input" rows="3" maxlength="500" formControlName="reason" [class.invalid]="err('reason')"></textarea>
                @if (err('reason'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <p class="hint field full">On the effective date the customer, its open leads and open opportunities move to the new dealer. Visits and closed deals stay with the current dealer.</p>
            </div>
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="requesting.set(false)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Send for approval</button>
          </div>
        </form>
      </app-modal>
    }

    @if (deciding(); as d) {
      <app-modal [title]="(d.approve ? 'Approve' : 'Reject') + ' transfer of ' + d.transfer.customer" (closed)="deciding.set(null)">
        <form (ngSubmit)="saveDecision()">
          <div class="panel-body">
            <p>{{ d.transfer.fromDealer }} → {{ d.transfer.toDealer }}, effective {{ date(d.transfer.effectiveDate) }}.</p>
            <div class="field">
              <label for="tRemark">Remark @if (!d.approve) { <span class="req">*</span> }</label>
              <textarea id="tRemark" name="tRemark" class="input" rows="3" maxlength="500" [(ngModel)]="remark"></textarea>
              @if (decisionError()) { <span class="field-error">{{ decisionError() }}</span> }
            </div>
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="deciding.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ d.approve ? 'Approve' : 'Reject' }}</button>
          </div>
        </form>
      </app-modal>
    }
  `,
})
export class Transfers {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly dateTime = formatDateTime;
  protected readonly pill = STATUS_PILL;
  protected readonly today = todayIso();
  protected readonly list = new PagedList<TransferItem>(this.http, '/api/transfers', 'Transfers could not be loaded.');
  protected readonly allDealers = toSignal(this.lookups.allDealers(), { initialValue: [] });
  protected readonly current = signal<CustomerDetail | null>(null);
  protected readonly targetDealers = computed(() => this.allDealers().filter((d) => d.id !== this.current()?.dealerId));
  protected readonly engineers = signal<Option[]>([]);
  protected readonly requesting = signal(false);
  protected readonly deciding = signal<{ transfer: TransferItem; approve: boolean } | null>(null);
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly decisionError = signal<string | null>(null);
  private readonly submitted = signal(false);
  private readonly server = signal<Record<string, string>>({});
  protected search = '';
  protected status: TransferStatus | null = 'Pending';
  protected remark = '';
  protected readonly form = inject(FormBuilder).group({
    customerId: [null as number | null, Validators.required],
    toDealerId: [null as number | null, Validators.required],
    toDealerUserId: [null as number | null],
    effectiveDate: [todayIso(), Validators.required],
    reason: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(500)]],
  });

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.list.load({ search: this.search, status: this.status, page, pageSize: 25 });
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server(), { minlength: 'Give a reason of at least 5 characters.' });
  }

  protected openRequest(): void {
    this.form.reset({ customerId: null, toDealerId: null, toDealerUserId: null, effectiveDate: todayIso(), reason: '' });
    this.current.set(null);
    this.engineers.set([]);
    this.submitted.set(false);
    this.server.set({});
    this.formError.set(null);
    this.requesting.set(true);
  }

  protected customerPicked(c: Option | null): void {
    this.current.set(null);
    if (c) this.http.get<CustomerDetail>(`/api/customers/${c.id}`).subscribe((d) => this.current.set(d));
  }

  protected dealerChanged(): void {
    this.form.controls.toDealerUserId.setValue(null);
    const dealer = this.form.controls.toDealerId.value;
    if (dealer) this.lookups.dealerUsers(dealer, true).subscribe((u) => this.engineers.set(u));
    else this.engineers.set([]);
  }

  protected request(): void {
    this.submitted.set(true);
    this.server.set({});
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.http.post<TransferItem>('/api/transfers', { ...v, reason: v.reason!.trim() }).subscribe({
      next: () => {
        this.busy.set(false);
        this.requesting.set(false);
        this.toast.show('Transfer requested. The approvers have been told.');
        this.status = 'Pending';
        this.load(1);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.server.set(fields);
        if (!Object.keys(fields).length) this.formError.set(problemMessage(err));
      },
    });
  }

  protected decide(transfer: TransferItem, approve: boolean): void {
    this.remark = '';
    this.decisionError.set(null);
    this.deciding.set({ transfer, approve });
  }

  protected saveDecision(): void {
    const d = this.deciding();
    if (!d) return;
    if (!d.approve && this.remark.trim().length < 3) {
      this.decisionError.set('Explain why the transfer is rejected.');
      return;
    }
    this.busy.set(true);
    this.http.post<TransferItem>(`/api/transfers/${d.transfer.id}/${d.approve ? 'approve' : 'reject'}`, { remark: this.remark.trim() || null })
      .subscribe({
        next: (t) => {
          this.busy.set(false);
          this.deciding.set(null);
          this.toast.show(d.approve ? (t.appliedAt ? `${t.customer} now belongs to ${t.toDealer}.` : 'Transfer approved.') : 'Transfer rejected.');
          this.load(this.list.result()?.page ?? 1);
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.decisionError.set(problemMessage(err));
        },
      });
  }
}
