import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { DataScope, P, PermissionModule, RoleDetail, RoleInput, RoleSummary, SCOPE_LABELS } from '../../core/models';
import { controlError, fieldErrors, problemMessage, ToastService } from '../../core/support';
import { CanDirective } from '../../shared/ui';

const ACTION_LABELS: Record<string, string> = {
  view: 'View', create: 'Create', edit: 'Edit', deactivate: 'Deactivate', assign: 'Assign', approve: 'Approve', request: 'Request',
  reopen: 'Reopen', upload: 'Upload', download: 'Download', export: 'Export', send: 'Send',
};

@Component({
  selector: 'app-roles',
  imports: [RouterLink, ReactiveFormsModule, CanDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Roles and permissions</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Administration</span><span>/</span><span>Roles and permissions</span></div>
      </div>
      <a *appCan="P.rolesEdit" class="btn btn-primary" routerLink="/admin/roles/new"><i class="fa-solid fa-plus"></i> New role</a>
    </div>

    <div class="layout">
      <nav class="panel role-list" aria-label="Roles">
        <div class="panel-heading"><h3>Roles</h3></div>
        @for (r of roles(); track r.id) {
          <a class="role-link" [routerLink]="['/admin/roles', r.id]" [class.active]="selectedId() === '' + r.id">
            <span class="role-name">{{ r.name }} @if (!r.isActive) { <span class="pill pill-inactive">Inactive</span> }</span>
            <span class="role-meta">{{ scopeLabels[r.scope] }} · {{ r.users }} {{ r.users === 1 ? 'user' : 'users' }} · {{ r.permissions }} permissions</span>
          </a>
        }
      </nav>

      <form class="panel" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div class="panel-heading"><h3>{{ isNew() ? 'New role' : (detail()?.name ?? 'Role') }}</h3></div>
        <div class="panel-body">
          @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
          @if (locked()) {
            <div class="alert alert-info"><i class="fa-solid fa-lock"></i>
              <span>Business / Admin always holds every permission and sees all records, so nobody can lock themselves out. Only its name and description can change.</span>
            </div>
          }
          @if (!canEdit()) {
            <div class="alert alert-info"><i class="fa-solid fa-eye"></i><span>Your role can view roles but not change them.</span></div>
          }

          <div class="form-grid">
            <div class="field">
              <label for="roleName">Role name<span class="req">*</span></label>
              <input id="roleName" class="input" formControlName="name" maxlength="50" [class.invalid]="err('name')">
              @if (err('name'); as m) { <span class="field-error">{{ m }}</span> }
            </div>
            <div class="field wide">
              <label for="roleDescription">Description</label>
              <input id="roleDescription" class="input" formControlName="description" maxlength="200">
            </div>
            <div class="field">
              <label for="scope">Records this role sees<span class="req">*</span></label>
              <select id="scope" class="input" formControlName="scope">
                @for (s of scopes; track s) { <option [value]="s">{{ scopeLabels[s] }}</option> }
              </select>
              <span class="hint">{{ scopeHelp() }}</span>
            </div>
            <div class="field">
              <label for="roleActive">Status</label>
              <label class="check"><input id="roleActive" type="checkbox" formControlName="isActive"> Active</label>
              @if (err('isActive'); as m) { <span class="field-error">{{ m }}</span> }
            </div>
            @if (detail(); as d) {
              <div class="field">
                <label>Users</label>
                <span>{{ d.users }} active {{ d.users === 1 ? 'user has' : 'users have' }} this role</span>
              </div>
            }
          </div>

          <h4 class="matrix-title">Permissions <span class="muted">{{ checked().size }} of {{ total() }}</span></h4>
          @if (err('permissionKeys'); as m) { <p class="field-error">{{ m }}</p> }
          <div class="table-wrap">
            <table class="table matrix">
              <thead>
                <tr><th>Module</th><th>Allowed actions</th><th class="center">All</th></tr>
              </thead>
              <tbody>
                @for (m of catalog(); track m.module) {
                  <tr>
                    <td>{{ m.label }}</td>
                    <td>
                      <div class="acts">
                        @for (a of m.actions; track a.key) {
                          <label class="act" [class.on]="checked().has(a.key)" [title]="a.label">
                            <input type="checkbox" [checked]="checked().has(a.key)" (change)="toggle(a.key)"
                                   [disabled]="locked() || !canEdit()" [attr.aria-label]="m.label + ': ' + a.label">
                            {{ actionLabel(a.action) }}
                          </label>
                        }
                      </div>
                    </td>
                    <td class="center">
                      <input type="checkbox" [checked]="allIn(m)" (change)="toggleModule(m)" [disabled]="locked() || !canEdit()"
                             [attr.aria-label]="'All actions for ' + m.label">
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="hint">Changes apply to every user with this role on their next click. The API checks the same permissions, so a hidden button cannot be bypassed.</p>
        </div>
        @if (canEdit()) {
          <div class="panel-footer">
            <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ isNew() ? 'Create role' : 'Save role' }}</button>
          </div>
        }
      </form>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
    .role-link { display: flex; flex-direction: column; gap: 2px; padding: 9px 12px; border-left: 3px solid transparent; border-bottom: 1px solid #eee; color: var(--edw-text); text-decoration: none; }
    .role-link:hover { background: #f4f5f6; }
    .role-link.active { border-left-color: var(--edw-red); background: #f6e9ea; }
    .role-name { font-weight: 600; color: var(--edw-slate); }
    .role-meta { font-size: 12px; color: var(--edw-muted); }
    .matrix-title { margin: 22px 0 8px; font-size: 15px; color: var(--edw-slate); }
    .matrix td:first-child { font-weight: 600; }
    .matrix td:first-child { width: 220px; }
    .matrix .center { text-align: center; width: 60px; }
    .matrix input { width: 16px; height: 16px; accent-color: var(--edw-red); cursor: pointer; }
    .matrix input:disabled { cursor: not-allowed; }
    .acts { display: flex; flex-wrap: wrap; gap: 6px; }
    .act { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px 2px 6px; border: 1px solid var(--edw-border); border-radius: 14px; background: #fff; cursor: pointer; font-size: 13px; }
    .act.on { border-color: var(--edw-red); background: #f6e9ea; }
    @media (max-width: 991px) { .layout { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class Roles {
  /** Role id from the route, or "new". The first role is shown when it is missing. */
  readonly id = input<string>();

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly P = P;
  protected readonly scopes: DataScope[] = ['All', 'Zone', 'Dealer', 'Own'];
  protected readonly scopeLabels = SCOPE_LABELS;

  protected readonly roles = signal<RoleSummary[]>([]);
  protected readonly catalog = signal<PermissionModule[]>([]);
  protected readonly detail = signal<RoleDetail | null>(null);
  protected readonly checked = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly server = signal<Record<string, string>>({});

  protected readonly selectedId = computed(() => this.id() ?? (this.roles()[0] ? String(this.roles()[0].id) : null));
  protected readonly isNew = computed(() => this.selectedId() === 'new');
  protected readonly canEdit = computed(() => this.auth.can(P.rolesEdit));
  protected readonly locked = computed(() => this.detail()?.isLocked ?? false);
  protected readonly total = computed(() => this.catalog().reduce((n, m) => n + m.actions.length, 0));

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
    description: ['', Validators.maxLength(200)],
    scope: ['Zone' as DataScope, Validators.required],
    isActive: [true],
  });
  private readonly scopeValue = signal<DataScope>('Zone');
  protected readonly scopeHelp = computed(() => ({
    All: 'Every customer, from every dealer and zone.',
    Zone: "Customers of dealers in the user's zones.",
    Dealer: "Customers of the user's own dealer.",
    Own: 'Only customers assigned to the user.',
  })[this.scopeValue()]);

  constructor() {
    this.loadRoles();
    this.http.get<PermissionModule[]>('/api/roles/permissions').subscribe((list) => this.catalog.set(list));
    this.form.controls.scope.valueChanges.subscribe((s) => this.scopeValue.set(s));

    effect(() => {
      const id = this.selectedId();
      const canEdit = this.canEdit();
      untracked(() => this.select(id, canEdit));
    });
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server(), { required: 'Enter a role name.' });
  }

  protected actionLabel(action: string): string {
    return ACTION_LABELS[action] ?? action.charAt(0).toUpperCase() + action.slice(1);
  }

  protected allIn(module: PermissionModule): boolean {
    const set = this.checked();
    return module.actions.every((a) => set.has(a.key));
  }

  /** Ticks every action of the module, or clears them all when they are all ticked. */
  protected toggleModule(module: PermissionModule): void {
    if (this.locked() || !this.canEdit()) return;
    const all = this.allIn(module);
    this.checked.update((set) => {
      const next = new Set(set);
      for (const a of module.actions) {
        if (all) next.delete(a.key);
        else next.add(a.key);
      }
      return next;
    });
  }

  protected toggle(key: string): void {
    if (this.locked() || !this.canEdit()) return;
    this.checked.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected save(): void {
    this.submitted.set(true);
    this.server.set({});
    this.error.set(null);
    if (this.form.invalid) return;

    const v = this.form.getRawValue();
    const body: RoleInput = {
      name: v.name.trim(),
      description: v.description.trim() || null,
      scope: v.scope,
      isActive: v.isActive,
      permissionKeys: [...this.checked()],
    };
    const current = this.detail();
    const request = this.isNew() || !current
      ? this.http.post<RoleDetail>('/api/roles', body)
      : this.http.put<RoleDetail>(`/api/roles/${current.id}`, body);

    this.busy.set(true);
    request.subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.toast.show(this.isNew() ? `Role ${saved.name} created.` : `Role ${saved.name} saved.`);
        this.loadRoles();
        if (this.isNew()) void this.router.navigate(['/admin/roles', saved.id]);
        else this.apply(saved);
        // The signed-in user's own menu may have changed.
        this.auth.loadMe().subscribe();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.server.set(fields);
        if (!Object.keys(fields).length) this.error.set(problemMessage(err));
      },
    });
  }

  private select(id: string | null, canEdit: boolean): void {
    this.submitted.set(false);
    this.server.set({});
    this.error.set(null);
    if (!id) return;
    if (id === 'new') {
      this.detail.set(null);
      this.checked.set(new Set());
      this.form.reset({ name: '', description: '', scope: 'Zone', isActive: true });
      this.scopeValue.set('Zone');
      this.setEditable(canEdit, false);
      return;
    }
    this.http.get<RoleDetail>(`/api/roles/${id}`).subscribe({
      next: (role) => {
        this.apply(role);
        this.setEditable(canEdit, role.isLocked);
      },
      error: (err: unknown) => this.error.set(problemMessage(err, 'This role could not be loaded.')),
    });
  }

  private apply(role: RoleDetail): void {
    this.detail.set(role);
    this.checked.set(new Set(role.permissionKeys));
    this.form.reset({ name: role.name, description: role.description ?? '', scope: role.scope, isActive: role.isActive });
    this.scopeValue.set(role.scope);
  }

  private setEditable(canEdit: boolean, locked: boolean): void {
    if (!canEdit) {
      this.form.disable({ emitEvent: false });
      return;
    }
    this.form.enable({ emitEvent: false });
    if (locked) {
      this.form.controls.scope.disable({ emitEvent: false });
      this.form.controls.isActive.disable({ emitEvent: false });
    }
  }

  private loadRoles(): void {
    this.http.get<RoleSummary[]>('/api/roles').subscribe((list) => this.roles.set(list));
  }
}
