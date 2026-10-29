import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DealerDetail, DealerListItem } from '../../core/admin-models';
import { P } from '../../core/models';
import { controlError, fieldErrors, LookupService, PagedList, problemMessage, ToastService } from '../../core/support';
import { CanDirective, Modal, Pager } from '../../shared/ui';

@Component({
  selector: 'app-dealers',
  imports: [FormsModule, ReactiveFormsModule, RouterLink, Pager, CanDirective, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Dealers</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Administration</span><span>/</span><span>Dealers</span></div>
      </div>
      <button *appCan="P.dealersEdit" type="button" class="btn btn-primary" (click)="open(null)"><i class="fa-solid fa-plus"></i> Add dealer</button>
    </div>

    <form class="panel" (ngSubmit)="load(1)">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="dq">Name or email</label>
          <input id="dq" name="q" class="input" type="search" [(ngModel)]="search">
        </div>
        <div class="field">
          <label for="dz">Zone</label>
          <select id="dz" name="dz" class="input" [(ngModel)]="zoneId">
            <option [ngValue]="null">All</option>
            @for (z of zones(); track z.id) { <option [ngValue]="z.id">{{ z.name }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="ds">Status</label>
          <select id="ds" name="ds" class="input" [(ngModel)]="status">
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
          </select>
        </div>
        <div class="actions"><button type="submit" class="btn btn-primary">Search</button></div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>Dealer list @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Dealer</th><th>Zone</th><th>Mobile</th><th>Email</th><th class="num">Users</th><th class="num">Customers</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            @for (d of list.result()?.items ?? []; track d.id) {
              <tr>
                <td>{{ d.name }}</td><td>{{ d.zone }}</td><td class="nowrap">{{ d.mobile || '—' }}</td><td>{{ d.email || '—' }}</td>
                <td class="num">{{ d.users }}</td><td class="num">{{ d.customers }}</td>
                <td><span class="pill" [class.pill-active]="d.isActive" [class.pill-inactive]="!d.isActive">{{ d.isActive ? 'Active' : 'Inactive' }}</span></td>
                <td class="row-actions"><button *appCan="P.dealersEdit" type="button" class="icon-btn" (click)="open(d.id)" [attr.aria-label]="'Edit ' + d.name" title="Edit"><i class="fa-solid fa-pen"></i></button></td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="8">{{ list.loading() ? 'Loading dealers…' : 'No dealers match.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="load($event)" /> }
    </section>

    @if (editing() !== undefined) {
      <app-modal [title]="editing() ? 'Edit dealer' : 'Add dealer'" (closed)="editing.set(undefined)">
        <form [formGroup]="form" (ngSubmit)="save()" novalidate>
          <div class="panel-body">
            @if (formError()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ formError() }}</div> }
            <div class="form-grid two">
              <div class="field full">
                <label for="dName">Dealer name<span class="req">*</span></label>
                <input id="dName" class="input" maxlength="100" formControlName="name" [class.invalid]="err('name')">
                @if (err('name'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label for="dZone">Zone<span class="req">*</span></label>
                <select id="dZone" class="input" formControlName="zoneId" [class.invalid]="err('zoneId')">
                  <option [ngValue]="null">Choose…</option>
                  @for (z of zones(); track z.id) { <option [ngValue]="z.id">{{ z.name }}</option> }
                </select>
                @if (err('zoneId'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label for="dMobile">Mobile</label>
                <input id="dMobile" class="input" maxlength="50" formControlName="mobile">
              </div>
              <div class="field">
                <label for="dEmail">Email</label>
                <input id="dEmail" class="input" type="email" maxlength="100" formControlName="email" [class.invalid]="err('email')">
                @if (err('email'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label for="dPan">PAN</label>
                <input id="dPan" class="input" maxlength="20" formControlName="pan">
              </div>
              <div class="field">
                <label for="dGst">GSTN</label>
                <input id="dGst" class="input" maxlength="15" formControlName="gstn">
              </div>
              <div class="field full">
                <label for="dAddress">Address</label>
                <textarea id="dAddress" class="input" rows="2" maxlength="300" formControlName="address"></textarea>
              </div>
              <div class="field full">
                <label for="dDesc">Description</label>
                <input id="dDesc" class="input" maxlength="200" formControlName="description">
              </div>
              <div class="field"><label class="check"><input type="checkbox" formControlName="isActive"> Active</label></div>
            </div>
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="editing.set(undefined)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Save dealer</button>
          </div>
        </form>
      </app-modal>
    }
  `,
})
export class Dealers {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  protected readonly P = P;
  protected readonly zones = toSignal(inject(LookupService).master('zones'), { initialValue: [] });
  protected readonly list = new PagedList<DealerListItem>(this.http, '/api/dealers', 'Dealers could not be loaded.');
  protected readonly editing = signal<number | null | undefined>(undefined);
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  private readonly submitted = signal(false);
  private readonly server = signal<Record<string, string>>({});
  protected search = '';
  protected zoneId: number | null = null;
  protected status = 'active';
  protected readonly form = inject(FormBuilder).group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    zoneId: [null as number | null, Validators.required],
    mobile: [''], email: ['', Validators.email], pan: [''], gstn: [''], address: [''], description: [''],
    isActive: [true],
  });

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.list.load({ search: this.search, zoneId: this.zoneId, status: this.status, page, pageSize: 25 });
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server());
  }

  protected open(id: number | null): void {
    this.submitted.set(false);
    this.server.set({});
    this.formError.set(null);
    this.form.reset({ name: '', zoneId: null, mobile: '', email: '', pan: '', gstn: '', address: '', description: '', isActive: true });
    if (id === null) {
      this.editing.set(null);
      return;
    }
    this.http.get<DealerDetail>(`/api/dealers/${id}`).subscribe((d) => {
      this.form.setValue({ name: d.name, zoneId: d.zoneId, mobile: d.mobile ?? '', email: d.email ?? '', pan: d.pan ?? '', gstn: d.gstn ?? '',
        address: d.address ?? '', description: d.description ?? '', isActive: d.isActive });
      this.editing.set(id);
    });
  }

  protected save(): void {
    this.submitted.set(true);
    this.server.set({});
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const clean = (x: string | null | undefined) => x?.trim() || null;
    const body = { name: v.name!.trim(), zoneId: v.zoneId, mobile: clean(v.mobile), email: clean(v.email), pan: clean(v.pan), gstn: clean(v.gstn),
      address: clean(v.address), description: clean(v.description), isActive: v.isActive };
    const id = this.editing();
    const request = id ? this.http.put(`/api/dealers/${id}`, body) : this.http.post('/api/dealers', body);
    this.busy.set(true);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set(undefined);
        this.toast.show(id ? 'Dealer saved.' : 'Dealer added.');
        this.load(this.list.result()?.page ?? 1);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.server.set(fields);
        this.formError.set(Object.keys(fields).length ? 'Some fields need attention.' : problemMessage(err));
      },
    });
  }
}
