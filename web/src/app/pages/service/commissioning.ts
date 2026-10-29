import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Option, P } from '../../core/models';
import { CommissioningItem, CommissioningStatus } from '../../core/service-models';
import { addDays, fieldErrors, formatDate, LookupService, PagedList, problemMessage, todayIso, ToastService } from '../../core/support';
import { CustomerPicker } from '../../shared/pickers';
import { CanDirective, Modal, Pager } from '../../shared/ui';

const STATUS_LABELS: Record<CommissioningStatus, string> = { Planned: 'Planned', InProgress: 'In progress', OnHold: 'On hold', Completed: 'Completed' };
const STATUS_PILL: Record<CommissioningStatus, string> = { Planned: 'pill-info', InProgress: 'pill-warn', OnHold: 'pill-red', Completed: 'pill-active' };

/** Commissioning plans. Completing one records the commissioning date, starts the warranty and schedules the first service. */
@Component({
  selector: 'app-commissioning',
  imports: [FormsModule, RouterLink, Pager, CanDirective, Modal, CustomerPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Commissioning</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Service</span><span>/</span><span>Commissioning</span></div>
      </div>
      <button *appCan="P.commissioningEdit" type="button" class="btn btn-primary" (click)="openPlan()"><i class="fa-solid fa-plus"></i> Plan commissioning</button>
    </div>

    <form class="panel" (ngSubmit)="load(1)">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="cq">Serial or customer</label>
          <input id="cq" name="q" class="input" type="search" [(ngModel)]="search" placeholder="Type to search">
        </div>
        <div class="field">
          <label for="cs">Status</label>
          <select id="cs" name="cs" class="input" [(ngModel)]="status">
            <option value="open">Not completed</option>
            <option value="">All</option>
            <option value="Planned">Planned</option>
            <option value="InProgress">In progress</option>
            <option value="OnHold">On hold</option>
            <option value="Completed">Completed</option>
          </select>
        </div>
        <div class="actions"><button type="submit" class="btn btn-primary">Search</button></div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>Commissioning list @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      @if (list.error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ list.error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Asset</th><th>Customer</th><th>Planned</th><th>Engineer</th><th>Status</th><th>Completed</th><th class="num">Warranty</th><th>Remarks</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            @for (c of list.result()?.items ?? []; track c.id) {
              <tr>
                <td class="nowrap"><a [routerLink]="['/assets', c.assetId]">{{ c.serialNumber }}</a><div class="hint">{{ c.model }}</div></td>
                <td>{{ c.customer }}<div class="hint">{{ c.city }}</div></td>
                <td class="nowrap">{{ date(c.plannedDate) }}</td>
                <td>{{ c.engineer || '—' }}</td>
                <td><span [class]="'pill ' + pill[c.status]">{{ labels[c.status] }}</span></td>
                <td class="nowrap">{{ date(c.completedDate) || '—' }}</td>
                <td class="num">{{ c.warrantyMonths }} months</td>
                <td>{{ c.remark || '—' }}</td>
                <td class="row-actions">
                  @if (c.canEdit) {
                    <button type="button" class="btn btn-light btn-sm" (click)="openEdit(c)">Edit</button>
                    <button type="button" class="btn btn-primary btn-sm" (click)="openComplete(c)">Complete</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="9">{{ list.loading() ? 'Loading…' : 'Nothing to show.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="load($event)" /> }
    </section>

    @if (dialog() === 'plan' || dialog() === 'edit') {
      <app-modal [title]="dialog() === 'plan' ? 'Plan commissioning' : 'Edit commissioning'" (closed)="dialog.set(null)">
        <form (ngSubmit)="save()">
          <div class="panel-body form-grid two">
            @if (dialog() === 'plan') {
              <div class="field full">
                <label for="pCustomer">Customer<span class="req">*</span></label>
                <app-customer-picker inputId="pCustomer" (picked)="customerPicked($event)" />
              </div>
              <div class="field full">
                <label for="pAsset">Asset<span class="req">*</span></label>
                <select id="pAsset" name="pAsset" class="input" [(ngModel)]="form.assetId">
                  <option [ngValue]="null">Choose…</option>
                  @for (a of assets(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
                </select>
              </div>
            }
            <div class="field">
              <label for="pDate">Planned date<span class="req">*</span></label>
              <input id="pDate" name="pDate" class="input" type="date" [(ngModel)]="form.plannedDate">
            </div>
            <div class="field">
              <label for="pMonths">Warranty months</label>
              <input id="pMonths" name="pMonths" class="input" type="number" min="1" max="60" [(ngModel)]="form.warrantyMonths">
            </div>
            <div class="field">
              <label for="pEngineer">Engineer</label>
              <select id="pEngineer" name="pEngineer" class="input" [(ngModel)]="form.engineerUserId">
                <option [ngValue]="null">Assign later</option>
                @for (u of engineers(); track u.id) { <option [ngValue]="u.id">{{ u.name }}</option> }
              </select>
            </div>
            @if (dialog() === 'edit') {
              <div class="field">
                <label for="pStatus">Status</label>
                <select id="pStatus" name="pStatus" class="input" [(ngModel)]="form.status">
                  <option value="Planned">Planned</option>
                  <option value="InProgress">In progress</option>
                  <option value="OnHold">On hold</option>
                </select>
              </div>
            }
            <div class="field full">
              <label for="pRemark">Remarks</label>
              <input id="pRemark" name="pRemark" class="input" maxlength="1000" [(ngModel)]="form.remark">
            </div>
            @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Save</button>
          </div>
        </form>
      </app-modal>
    }

    @if (dialog() === 'complete') {
      <app-modal [title]="'Complete commissioning of ' + (current()?.serialNumber ?? '')" (closed)="dialog.set(null)">
        <form (ngSubmit)="complete()">
          <div class="panel-body form-grid two">
            <div class="field">
              <label for="kDate">Commissioned on<span class="req">*</span></label>
              <input id="kDate" name="kDate" class="input" type="date" [max]="today" [(ngModel)]="done.completedDate">
            </div>
            <div class="field">
              <label for="kMonths">Warranty months</label>
              <input id="kMonths" name="kMonths" class="input" type="number" min="1" max="60" [(ngModel)]="done.warrantyMonths">
            </div>
            <div class="field full">
              <label for="kRemark">Remarks</label>
              <textarea id="kRemark" name="kRemark" class="input" rows="3" maxlength="1000" [(ngModel)]="done.remark"></textarea>
            </div>
            <p class="hint field full">The warranty starts on this date and the first service is scheduled. The dealer and zone sales are told.</p>
            @if (dialogError()) { <div class="field full"><span class="field-error">{{ dialogError() }}</span></div> }
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="dialog.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Complete</button>
          </div>
        </form>
      </app-modal>
    }
  `,
})
export class Commissioning {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly today = todayIso();
  protected readonly labels = STATUS_LABELS;
  protected readonly pill = STATUS_PILL;
  protected readonly list = new PagedList<CommissioningItem>(this.http, '/api/commissioning', 'Commissioning could not be loaded.');
  protected readonly dialog = signal<'plan' | 'edit' | 'complete' | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly current = signal<CommissioningItem | null>(null);
  protected readonly assets = signal<Option[]>([]);
  protected readonly engineers = signal<Option[]>([]);
  protected search = '';
  protected status = 'open';
  protected form = this.blank();
  protected done = { completedDate: todayIso(), warrantyMonths: 12, remark: '' };

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.list.load({ search: this.search, status: this.status, page, pageSize: 25 });
  }

  protected openPlan(): void {
    this.form = this.blank();
    this.assets.set([]);
    this.engineers.set([]);
    this.dialogError.set(null);
    this.dialog.set('plan');
  }

  protected customerPicked(c: Option | null): void {
    this.form.assetId = null;
    this.assets.set([]);
    this.engineers.set([]);
    if (!c) return;
    this.lookups.customerAssets(c.id).subscribe((a) => this.assets.set(a));
    this.lookups.engineers(c.id).subscribe((u) => this.engineers.set(u));
  }

  protected openEdit(c: CommissioningItem): void {
    this.current.set(c);
    this.form = { assetId: c.assetId, plannedDate: c.plannedDate, engineerUserId: c.engineerUserId, warrantyMonths: c.warrantyMonths,
      remark: c.remark ?? '', status: c.status };
    this.lookups.engineers(c.customerId).subscribe((u) => this.engineers.set(u));
    this.dialogError.set(null);
    this.dialog.set('edit');
  }

  protected save(): void {
    if (!this.form.assetId) return this.dialogError.set('Choose the asset.');
    const body = { ...this.form, remark: this.form.remark.trim() || null };
    const editing = this.dialog() === 'edit';
    const request = editing ? this.http.put(`/api/commissioning/${this.current()!.id}`, body) : this.http.post('/api/commissioning', body);
    this.run(request, editing ? 'Commissioning saved.' : 'Commissioning planned.');
  }

  protected openComplete(c: CommissioningItem): void {
    this.current.set(c);
    this.done = { completedDate: todayIso(), warrantyMonths: c.warrantyMonths, remark: '' };
    this.dialogError.set(null);
    this.dialog.set('complete');
  }

  protected complete(): void {
    this.run(this.http.post(`/api/commissioning/${this.current()!.id}/complete`, { ...this.done, remark: this.done.remark.trim() || null }),
      'Commissioning completed. Warranty has started.');
  }

  private run(request: ReturnType<HttpClient['post']>, message: string): void {
    this.busy.set(true);
    this.dialogError.set(null);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.dialog.set(null);
        this.toast.show(message);
        this.load(this.list.result()?.page ?? 1);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.dialogError.set(Object.values(fieldErrors(err))[0] ?? problemMessage(err));
      },
    });
  }

  private blank() {
    return { assetId: null as number | null, plannedDate: addDays(todayIso(), 7), engineerUserId: null as number | null, warrantyMonths: 12,
      remark: '', status: 'Planned' as CommissioningStatus };
  }
}
