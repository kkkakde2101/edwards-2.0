import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MasterInput, MasterItem, MasterSummary, P } from '../../core/models';
import { controlError, fieldErrors, formatDate, LookupService, problemMessage, ToastService } from '../../core/support';
import { CanDirective, Modal } from '../../shared/ui';

@Component({
  selector: 'app-masters',
  imports: [RouterLink, FormsModule, ReactiveFormsModule, CanDirective, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Masters</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Administration</span><span>/</span><span>Masters</span></div>
      </div>
    </div>

    <div class="layout">
      <nav class="panel lists" aria-label="Master lists">
        <div class="panel-heading"><h3>Lists</h3></div>
        @for (group of groups(); track group.name) {
          <div class="group-name">{{ group.name }}</div>
          @for (m of group.items; track m.key) {
            <a class="list-link" [routerLink]="['/admin/masters', m.key]" [class.active]="m.key === selectedKey()">
              <span>{{ m.label }}</span><span class="badge">{{ m.active }}</span>
            </a>
          }
        }
      </nav>

      <section class="panel items">
        <div class="panel-heading">
          <h3>{{ selected()?.label }} <span class="count">{{ visibleItems().length }}</span></h3>
          <div class="actions">
            @if (parent(); as parent) {
              <select class="input filter" [attr.aria-label]="'Filter by ' + parent.label" [ngModel]="parentFilter()" (ngModelChange)="parentFilter.set($event)">
                <option [ngValue]="null">All {{ parent.label.toLowerCase() }}</option>
                @for (o of parentOptions(); track o.id) { <option [ngValue]="o.id">{{ o.name }}</option> }
              </select>
            }
            <input class="input filter" type="search" placeholder="Filter" aria-label="Filter values" [ngModel]="filter()" (ngModelChange)="filter.set($event)">
            <button *appCan="P.mastersEdit" type="button" class="btn btn-primary btn-sm" (click)="open('new')"><i class="fa-solid fa-plus"></i> Add value</button>
          </div>
        </div>
        @if (error()) { <div class="panel-body"><div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div></div> }
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                @if (parent(); as parent) { <th>{{ parent.label }}</th> }
                @if (selected()?.numberLabel; as label) { <th class="num">{{ label }}</th> }
                <th>Description</th><th class="num">Order</th><th>Status</th><th>Last changed</th><th><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (item of visibleItems(); track item.id) {
                <tr>
                  <td>{{ item.name }}</td>
                  @if (parent()) { <td>{{ item.parentName || '—' }}</td> }
                  @if (selected()?.numberLabel) { <td class="num">{{ item.number }}</td> }
                  <td>{{ item.description || '—' }}</td>
                  <td class="num">{{ item.sortOrder }}</td>
                  <td><span class="pill" [class.pill-active]="item.isActive" [class.pill-inactive]="!item.isActive">{{ item.isActive ? 'Active' : 'Inactive' }}</span></td>
                  <td class="nowrap">{{ date(item.updatedAt || item.createdAt) }}</td>
                  <td class="row-actions">
                    <button *appCan="P.mastersEdit" type="button" class="icon-btn" (click)="open(item)" [attr.aria-label]="'Edit ' + item.name" title="Edit"><i class="fa-solid fa-pen"></i></button>
                  </td>
                </tr>
              } @empty {
                <tr class="empty"><td colspan="8">{{ loading() ? 'Loading…' : 'No values match.' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    @if (editing(); as e) {
      <app-modal [title]="(e === 'new' ? 'Add to ' : 'Edit in ') + (selected()?.label ?? '')" (closed)="editing.set(null)">
        <form [formGroup]="form" (ngSubmit)="save()" novalidate>
          <div class="panel-body">
            @if (saveError()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ saveError() }}</div> }
            <div class="form-grid two">
              <div class="field full">
                <label for="mName">Name<span class="req">*</span></label>
                <input id="mName" class="input" formControlName="name" maxlength="100" [class.invalid]="err('name')">
                @if (err('name'); as m) { <span class="field-error">{{ m }}</span> }
              </div>
              @if (parent(); as parent) {
                <div class="field full">
                  <label for="mParent">{{ parent.label }}<span class="req">*</span></label>
                  <select id="mParent" class="input" formControlName="parentId" [class.invalid]="err('parentId')">
                    <option [ngValue]="null">Choose…</option>
                    @for (o of parentOptions(); track o.id) { <option [ngValue]="o.id">{{ o.name }}</option> }
                  </select>
                  @if (err('parentId'); as m) { <span class="field-error">{{ m }}</span> }
                </div>
              }
              @if (selected()?.numberLabel; as label) {
                <div class="field">
                  <label for="mNumber">{{ label }}<span class="req">*</span></label>
                  <input id="mNumber" class="input" type="number" min="0" max="100" formControlName="number" [class.invalid]="err('number')">
                  @if (err('number'); as m) { <span class="field-error">{{ m }}</span> }
                </div>
              }
              <div class="field full">
                <label for="mDescription">Description</label>
                <input id="mDescription" class="input" formControlName="description" maxlength="200">
              </div>
              <div class="field">
                <label for="mOrder">Display order</label>
                <input id="mOrder" class="input" type="number" min="0" max="9999" formControlName="sortOrder">
                <span class="hint">Lower numbers appear first in dropdowns.</span>
              </div>
              <div class="field">
                <label for="mActive">Status</label>
                <label class="check"><input id="mActive" type="checkbox" formControlName="isActive"> Active (shown in dropdowns)</label>
              </div>
            </div>
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="editing.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Save</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; align-items: start; }
    .group-name { padding: 10px 12px 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--edw-muted); }
    .list-link { display: flex; justify-content: space-between; gap: 8px; padding: 7px 12px; border-left: 3px solid transparent; color: var(--edw-text); text-decoration: none; }
    .list-link:hover { background: #f4f5f6; }
    .list-link.active { border-left-color: var(--edw-red); background: #f6e9ea; color: var(--edw-red-dark); font-weight: 600; }
    .badge { min-width: 26px; padding: 0 6px; border-radius: 9px; background: #eceeef; color: var(--edw-muted); font-size: 12px; text-align: center; }
    .filter { width: 180px; height: 28px; }
    @media (max-width: 991px) { .layout { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class Masters {
  /** List key from the route (/admin/masters/:key); the first list is shown when it is missing. */
  readonly key = input<string>();

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);

  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly summaries = signal<MasterSummary[]>([]);
  protected readonly items = signal<MasterItem[]>([]);
  protected readonly filter = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly selectedKey = computed(() => this.key() ?? this.summaries()[0]?.key ?? null);
  protected readonly selected = computed(() => this.summaries().find((s) => s.key === this.selectedKey()) ?? null);
  protected readonly groups = computed(() => {
    const groups: { name: string; items: MasterSummary[] }[] = [];
    for (const s of this.summaries()) {
      let g = groups.find((x) => x.name === s.group);
      if (!g) groups.push((g = { name: s.group, items: [] }));
      g.items.push(s);
    }
    return groups;
  });
  /** The list this one belongs under, such as product ranges for product models. */
  protected readonly parent = computed(() => {
    const key = this.selected()?.parentKey;
    return key ? (this.summaries().find((s) => s.key === key) ?? null) : null;
  });
  protected readonly parentOptions = toSignal(
    toObservable(this.parent).pipe(switchMap((p) => (p ? this.lookups.master(p.key) : of([])))),
    { initialValue: [] },
  );
  protected readonly parentFilter = signal<number | null>(null);
  protected readonly visibleItems = computed(() => {
    const f = this.filter().trim().toLowerCase();
    const parentId = this.parentFilter();
    return this.items().filter((i) =>
      (parentId === null || i.parentId === parentId)
      && (!f || i.name.toLowerCase().includes(f) || (i.description ?? '').toLowerCase().includes(f)));
  });

  // Edit dialog
  protected readonly editing = signal<MasterItem | 'new' | null>(null);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saveError = signal<string | null>(null);
  private readonly server = signal<Record<string, string>>({});
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: ['', Validators.maxLength(200)],
    sortOrder: [0, [Validators.min(0), Validators.max(9999)]],
    isActive: [true],
    parentId: [null as number | null],
    number: [null as number | null, [Validators.min(0), Validators.max(100)]],
  });

  constructor() {
    this.http.get<MasterSummary[]>('/api/masters').subscribe({
      next: (list) => this.summaries.set(list),
      error: (err: unknown) => this.error.set(problemMessage(err, 'Master lists could not be loaded.')),
    });
    effect(() => {
      const key = this.selectedKey();
      if (key) this.loadItems(key);
    });
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server(), {
      required: name === 'parentId' ? 'Choose where this value belongs.' : name === 'number' ? 'Enter a number.' : 'Enter a name.',
    });
  }

  protected open(item: MasterItem | 'new'): void {
    this.submitted.set(false);
    this.saveError.set(null);
    this.server.set({});
    this.form.reset({ name: '', description: '', sortOrder: 0, isActive: true, parentId: this.parentFilter(), number: null });
    if (item !== 'new') {
      this.form.setValue({
        name: item.name, description: item.description ?? '', sortOrder: item.sortOrder, isActive: item.isActive,
        parentId: item.parentId, number: item.number,
      });
    }
    // Lists with a parent or a number need them filled in.
    this.form.controls.parentId.setValidators(this.parent() ? Validators.required : null);
    this.form.controls.number.setValidators(this.selected()?.numberLabel ? [Validators.required, Validators.min(0), Validators.max(100)] : null);
    this.form.controls.parentId.updateValueAndValidity();
    this.form.controls.number.updateValueAndValidity();
    this.editing.set(item);
  }

  protected save(): void {
    this.submitted.set(true);
    this.server.set({});
    this.saveError.set(null);
    const key = this.selectedKey();
    const editing = this.editing();
    if (this.form.invalid || !key || !editing) return;

    const v = this.form.getRawValue();
    const body: MasterInput = {
      name: v.name.trim(), description: v.description.trim() || null, sortOrder: Number(v.sortOrder) || 0, isActive: v.isActive,
      parentId: this.parent() ? v.parentId : null,
      number: this.selected()?.numberLabel && v.number !== null ? Number(v.number) : null,
    };
    const request = editing === 'new'
      ? this.http.post<MasterItem>(`/api/masters/${key}`, body)
      : this.http.put<MasterItem>(`/api/masters/${key}/${editing.id}`, body);

    this.busy.set(true);
    request.subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.editing.set(null);
        this.lookups.forget(key);
        this.toast.show(editing === 'new' ? `${saved.name} added.` : `${saved.name} saved.`);
        this.loadItems(key);
        this.refreshCounts();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.server.set(fields);
        if (!Object.keys(fields).length) this.saveError.set(problemMessage(err));
      },
    });
  }

  private loadItems(key: string): void {
    this.parentFilter.set(null);
    this.loading.set(true);
    this.items.set([]);
    this.http.get<MasterItem[]>(`/api/masters/${key}`).subscribe({
      next: (list) => {
        this.items.set(list);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        if (this.summaries().length && !this.selected()) void this.router.navigate(['/admin/masters']);
        else this.error.set(problemMessage(err, 'This list could not be loaded.'));
      },
    });
  }

  private refreshCounts(): void {
    this.http.get<MasterSummary[]>('/api/masters').subscribe((list) => this.summaries.set(list));
  }
}
