import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UserDetail, UserListItem } from '../../core/admin-models';
import { Option, P, USER_TYPE_LABELS, UserType } from '../../core/models';
import { controlError, fieldErrors, formatDateTime, LookupService, PagedList, problemMessage, ToastService } from '../../core/support';
import { CanDirective, Modal, Pager } from '../../shared/ui';

/** User administration: accounts, roles, dealer and zones, and password resets. */
@Component({
  selector: 'app-users',
  imports: [FormsModule, ReactiveFormsModule, RouterLink, Pager, CanDirective, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Users</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Administration</span><span>/</span><span>Users</span></div>
      </div>
      <button *appCan="P.usersEdit" type="button" class="btn btn-primary" (click)="open(null)"><i class="fa-solid fa-user-plus"></i> Add user</button>
    </div>

    <form class="panel" (ngSubmit)="load(1)">
      <div class="panel-heading"><h3>Search</h3></div>
      <div class="panel-body filters">
        <div class="field">
          <label for="uq">Name, login or email</label>
          <input id="uq" name="q" class="input" type="search" [(ngModel)]="search" placeholder="Type to search">
        </div>
        <div class="field">
          <label for="ur">Role</label>
          <select id="ur" name="ur" class="input" [(ngModel)]="roleId">
            <option [ngValue]="null">All</option>
            @for (r of roles(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="ut">Type</label>
          <select id="ut" name="ut" class="input" [(ngModel)]="type">
            <option [ngValue]="null">All</option>
            @for (t of types; track t) { <option [ngValue]="t">{{ typeLabels[t] }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="us">Status</label>
          <select id="us" name="us" class="input" [(ngModel)]="status">
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
          </select>
        </div>
        <div class="actions"><button type="submit" class="btn btn-primary">Search</button></div>
      </div>
    </form>

    <section class="panel">
      <div class="panel-heading"><h3>User list @if (list.result(); as r) { <span class="count">{{ r.total }}</span> }</h3></div>
      @if (list.error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ list.error() }}</div></div> }
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Name</th><th>Login</th><th>Email</th><th>Mobile</th><th>Role</th><th>Type</th><th>Dealer</th><th>Zones</th><th>Last sign-in</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            @for (u of list.result()?.items ?? []; track u.id) {
              <tr>
                <td>{{ u.name }}</td>
                <td class="nowrap">{{ u.loginName }}</td>
                <td>{{ u.email }}</td>
                <td class="nowrap">{{ u.mobile || '—' }}</td>
                <td>{{ u.role }}</td>
                <td>{{ typeLabels[u.type] }}</td>
                <td>{{ u.dealer || '—' }}</td>
                <td>{{ u.zones || '—' }}</td>
                <td class="nowrap">{{ dateTime(u.lastLoginAt) || 'Never' }}</td>
                <td><span class="pill" [class.pill-active]="u.isActive" [class.pill-inactive]="!u.isActive">{{ u.isActive ? 'Active' : 'Inactive' }}</span></td>
                <td class="row-actions">
                  <ng-container *appCan="P.usersEdit">
                    <button type="button" class="icon-btn" (click)="open(u.id)" [attr.aria-label]="'Edit ' + u.name" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="icon-btn" (click)="resetting.set(u)" [attr.aria-label]="'Reset password of ' + u.name" title="Reset password"><i class="fa-solid fa-key"></i></button>
                  </ng-container>
                </td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="11">{{ list.loading() ? 'Loading users…' : 'No users match.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (list.result(); as r) { <app-pager [total]="r.total" [page]="r.page" [pageSize]="r.pageSize" (pageChange)="load($event)" /> }
    </section>

    @if (editing() !== undefined) {
      <app-modal [title]="editing() ? 'Edit user' : 'Add user'" [wide]="true" (closed)="editing.set(undefined)">
        <form [formGroup]="form" (ngSubmit)="save()" novalidate>
          <div class="panel-body">
            @if (formError()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ formError() }}</div> }
            @if (!editing()) { <div class="alert alert-info"><i class="fa-solid fa-envelope"></i><span>The user gets a welcome email with a link to choose their own password.</span></div> }
            <div class="form-grid">
              <div class="field">
                <label for="fLogin">Login name<span class="req">*</span></label>
                <input id="fLogin" class="input" maxlength="50" formControlName="loginName" [class.invalid]="err('loginName')">
                @if (err('loginName'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label for="fFirst">First name<span class="req">*</span></label>
                <input id="fFirst" class="input" maxlength="50" formControlName="firstName" [class.invalid]="err('firstName')">
                @if (err('firstName'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label for="fLast">Last name</label>
                <input id="fLast" class="input" maxlength="50" formControlName="lastName">
              </div>
              <div class="field">
                <label for="fEmail">Email<span class="req">*</span></label>
                <input id="fEmail" class="input" type="email" maxlength="100" formControlName="email" [class.invalid]="err('email')">
                @if (err('email'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label for="fMobile">Mobile</label>
                <input id="fMobile" class="input" type="tel" maxlength="50" formControlName="mobile">
              </div>
              <div class="field">
                <label for="fType">User type<span class="req">*</span></label>
                <select id="fType" class="input" formControlName="type">
                  @for (t of types; track t) { <option [ngValue]="t">{{ typeLabels[t] }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="fRole">Role<span class="req">*</span></label>
                <select id="fRole" class="input" formControlName="roleId" [class.invalid]="err('roleId')">
                  <option [ngValue]="null">Choose…</option>
                  @for (r of roles(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }
                </select>
                @if (err('roleId'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              @if (form.controls.type.value !== 'Edwards') {
                <div class="field">
                  <label for="fDealer">Dealer<span class="req">*</span></label>
                  <select id="fDealer" class="input" formControlName="dealerId" [class.invalid]="err('dealerId')">
                    <option [ngValue]="null">Choose…</option>
                    @for (d of dealers(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
                  </select>
                  @if (err('dealerId'); as m) { <span class="field-error">{{ m }}</span> }
                </div>
              }
              <div class="field">
                <label for="fDesignation">Designation</label>
                <select id="fDesignation" class="input" formControlName="designationId">
                  <option [ngValue]="null">Not set</option>
                  @for (d of designations(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
                </select>
              </div>
              <div class="field full">
                <label>Zones</label>
                <div class="zones">
                  @for (z of zones(); track z.id) {
                    <label class="check"><input type="checkbox" [checked]="zoneIds().includes(z.id)" (change)="toggleZone(z.id)"> {{ z.name }}</label>
                  }
                </div>
                <span class="hint">Roles that see records "in their zones" use these.</span>
                @if (err('zoneIds'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              <div class="field">
                <label class="check"><input type="checkbox" formControlName="isActive"> Active</label>
              </div>
            </div>
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="editing.set(undefined)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ editing() ? 'Save user' : 'Add user' }}</button>
          </div>
        </form>
      </app-modal>
    }

    @if (resetting(); as u) {
      <app-modal [title]="'Reset password for ' + u.name" (closed)="resetting.set(null)">
        <form (ngSubmit)="reset(u)">
          <div class="panel-body">
            <label class="check"><input type="radio" name="mode" value="link" [(ngModel)]="resetMode"> Email a link to choose a new password (valid 24 hours)</label>
            <label class="check"><input type="radio" name="mode" value="temp" [(ngModel)]="resetMode"> Set a temporary password</label>
            @if (resetMode === 'temp') {
              <div class="field">
                <label for="tmp">Temporary password</label>
                <input id="tmp" name="tmp" class="input" type="text" autocomplete="off" [(ngModel)]="tempPassword">
                <span class="hint">At least 8 characters with a letter and a number. The user must change it at the next sign-in.</span>
              </div>
            }
            @if (resetError()) { <span class="field-error">{{ resetError() }}</span> }
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="resetting.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Reset password</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styles: `.zones { display: flex; flex-wrap: wrap; gap: 6px 16px; }`,
})
export class Users {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  protected readonly P = P;
  protected readonly dateTime = formatDateTime;
  protected readonly types: UserType[] = ['Edwards', 'Dealer', 'DealerUser'];
  protected readonly typeLabels = USER_TYPE_LABELS;
  protected readonly roles = toSignal(this.lookups.roles(), { initialValue: [] as Option[] });
  protected readonly zones = toSignal(this.lookups.master('zones'), { initialValue: [] });
  protected readonly designations = toSignal(this.lookups.master('designations'), { initialValue: [] });
  protected readonly dealers = toSignal(this.lookups.allDealers(), { initialValue: [] });
  protected readonly list = new PagedList<UserListItem>(this.http, '/api/users', 'Users could not be loaded.');
  /** undefined: closed; null: new user; a number: the user being edited. */
  protected readonly editing = signal<number | null | undefined>(undefined);
  protected readonly resetting = signal<UserListItem | null>(null);
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly resetError = signal<string | null>(null);
  protected readonly zoneIds = signal<number[]>([]);
  private readonly submitted = signal(false);
  private readonly server = signal<Record<string, string>>({});
  protected search = '';
  protected roleId: number | null = null;
  protected type: UserType | null = null;
  protected status = 'active';
  protected resetMode: 'link' | 'temp' = 'link';
  protected tempPassword = '';
  protected readonly form = inject(FormBuilder).group({
    loginName: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
    firstName: ['', Validators.required],
    lastName: [''],
    email: ['', [Validators.required, Validators.email]],
    mobile: [''],
    roleId: [null as number | null, Validators.required],
    type: ['Edwards' as UserType],
    dealerId: [null as number | null],
    designationId: [null as number | null],
    isActive: [true],
  });

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.list.load({ search: this.search, roleId: this.roleId, type: this.type, status: this.status, page, pageSize: 25 });
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server());
  }

  protected toggleZone(id: number): void {
    this.zoneIds.update((list) => (list.includes(id) ? list.filter((z) => z !== id) : [...list, id]));
  }

  protected open(id: number | null): void {
    this.submitted.set(false);
    this.server.set({});
    this.formError.set(null);
    this.form.reset({ loginName: '', firstName: '', lastName: '', email: '', mobile: '', roleId: null, type: 'Edwards', dealerId: null,
      designationId: null, isActive: true });
    this.zoneIds.set([]);
    if (id === null) {
      this.editing.set(null);
      return;
    }
    this.http.get<UserDetail>(`/api/users/${id}`).subscribe({
      next: (u) => {
        this.form.setValue({ loginName: u.loginName, firstName: u.firstName, lastName: u.lastName, email: u.email, mobile: u.mobile ?? '',
          roleId: u.roleId, type: u.type, dealerId: u.dealerId, designationId: u.designationId, isActive: u.isActive });
        this.zoneIds.set(u.zoneIds);
        this.editing.set(id);
      },
      error: (err: unknown) => this.toast.show(problemMessage(err), 'error'),
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
    const body = { ...v, mobile: v.mobile?.trim() || null, lastName: v.lastName?.trim() || null, zoneIds: this.zoneIds(),
      dealerId: v.type === 'Edwards' ? null : v.dealerId };
    const id = this.editing();
    const request = id ? this.http.put<UserDetail>(`/api/users/${id}`, body) : this.http.post<UserDetail>('/api/users', body);
    this.busy.set(true);
    request.subscribe({
      next: (u) => {
        this.busy.set(false);
        this.editing.set(undefined);
        this.toast.show(id ? 'User saved.' : `${u.firstName} added. A welcome email is on its way.`);
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

  protected reset(u: UserListItem): void {
    this.resetError.set(null);
    const body = this.resetMode === 'temp' ? { password: this.tempPassword } : {};
    this.busy.set(true);
    this.http.post<void>(`/api/users/${u.id}/password`, body).subscribe({
      next: () => {
        this.busy.set(false);
        this.resetting.set(null);
        this.tempPassword = '';
        this.toast.show(this.resetMode === 'temp' ? 'Temporary password set.' : `A reset link was emailed to ${u.email}.`);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.resetError.set(Object.values(fieldErrors(err))[0] ?? problemMessage(err));
      },
    });
  }
}
