import { ChangeDetectionStrategy, Component, DestroyRef, forwardRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { debounceTime, distinctUntilChanged, of, Subject, switchMap } from 'rxjs';
import { Option } from '../core/models';
import { LookupService } from '../core/support';

/**
 * Search-as-you-type customer field for reactive forms. Its value is the customer id;
 * only customers in the user's scope are offered.
 */
@Component({
  selector: 'app-customer-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CustomerPicker), multi: true }],
  template: `
    <div class="picker">
      <input class="input" [id]="inputId()" type="search" autocomplete="off" role="combobox" aria-autocomplete="list"
             [attr.aria-expanded]="open() && options().length > 0" [attr.aria-controls]="inputId() + '-list'"
             placeholder="Type a customer name, city or GST" [value]="text()" [disabled]="disabled()" [class.invalid]="invalid()"
             (input)="typed($event)" (focus)="open.set(true)" (blur)="blurred()" (keydown)="key($event)">
      @if (open() && options().length) {
        <ul class="picker-list" role="listbox" [id]="inputId() + '-list'">
          @for (o of options(); track o.id; let i = $index) {
            <li role="option" [class.active]="i === active()" [attr.aria-selected]="i === active()" (mousedown)="choose(o)">{{ o.name }}</li>
          }
        </ul>
      } @else if (open() && searched() && !options().length) {
        <div class="picker-list empty">No customers match.</div>
      }
    </div>
  `,
  styles: `
    .picker { position: relative; }
    .picker-list { position: absolute; z-index: 50; left: 0; right: 0; top: 100%; margin: 2px 0 0; padding: 0; list-style: none; max-height: 260px; overflow-y: auto; background: #fff; border: 1px solid var(--edw-border); box-shadow: 0 6px 16px rgba(0,0,0,.15); }
    .picker-list li { padding: 7px 10px; cursor: pointer; }
    .picker-list li:hover, .picker-list li.active { background: #f6e9ea; color: var(--edw-red-dark); }
    .picker-list.empty { padding: 8px 10px; color: var(--edw-muted); }
  `,
})
export class CustomerPicker implements ControlValueAccessor {
  readonly inputId = input('customer');
  readonly invalid = input(false);
  /** The chosen customer, or null when the field is cleared. */
  readonly picked = output<Option | null>();

  private readonly lookups = inject(LookupService);
  private readonly search$ = new Subject<string>();

  protected readonly text = signal('');
  protected readonly options = signal<Option[]>([]);
  protected readonly open = signal(false);
  protected readonly searched = signal(false);
  protected readonly active = signal(-1);
  protected readonly disabled = signal(false);
  private value: number | null = null;
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    this.search$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => (q.trim().length >= 2 ? this.lookups.customers(q.trim()) : of([]))),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => {
        this.options.set(list);
        this.searched.set(true);
        this.active.set(list.length ? 0 : -1);
      });
  }

  writeValue(id: number | null): void {
    this.value = id;
    if (id === null || id === undefined) {
      this.text.set('');
      return;
    }
    this.lookups.customer(id).subscribe((list) => this.text.set(list[0]?.name ?? `Customer ${id}`));
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  protected typed(event: Event): void {
    const q = (event.target as HTMLInputElement).value;
    this.text.set(q);
    this.open.set(true);
    this.searched.set(false);
    if (this.value !== null) {
      this.value = null;
      this.onChange(null);
      this.picked.emit(null);
    }
    this.search$.next(q);
  }

  protected key(event: KeyboardEvent): void {
    const list = this.options();
    if (!list.length) return;
    if (event.key === 'ArrowDown') this.active.set(Math.min(list.length - 1, this.active() + 1));
    else if (event.key === 'ArrowUp') this.active.set(Math.max(0, this.active() - 1));
    else if (event.key === 'Enter' && this.open() && this.active() >= 0) this.choose(list[this.active()]);
    else return;
    event.preventDefault();
  }

  protected choose(o: Option): void {
    this.value = o.id;
    this.text.set(o.name);
    this.open.set(false);
    this.onChange(o.id);
    this.onTouched();
    this.picked.emit(o);
  }

  protected blurred(): void {
    this.open.set(false);
    this.onTouched();
  }
}
