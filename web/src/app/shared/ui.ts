import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  output,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/support';

/** Shows its content only when the user's role holds the permission: <button *appCan="'customers.edit'">. */
@Directive({ selector: '[appCan]' })
export class CanDirective {
  readonly appCan = input.required<string>();
  private readonly auth = inject(AuthService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private shown = false;

  constructor() {
    effect(() => {
      const allowed = this.auth.permissions().has(this.appCan());
      if (allowed && !this.shown) this.container.createEmbeddedView(this.template);
      if (!allowed && this.shown) this.container.clear();
      this.shown = allowed;
    });
  }
}

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-stack" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class.error]="t.kind === 'error'" role="status">
          <i class="fa-solid" [class.fa-circle-check]="t.kind === 'success'" [class.fa-circle-exclamation]="t.kind === 'error'"></i>
          <span>{{ t.text }}</span>
          <button type="button" class="close" (click)="toasts.dismiss(t.id)" aria-label="Dismiss">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-stack { position: fixed; right: max(16px, env(safe-area-inset-right, 0px)); bottom: 16px; z-index: 1100; display: flex; flex-direction: column; gap: 8px; }
    .toast { display: flex; align-items: flex-start; gap: 10px; min-width: 260px; max-width: 380px; padding: 10px 12px; background: var(--edw-slate); color: #fff; border-left: 4px solid var(--edw-green); box-shadow: 0 6px 18px rgba(0,0,0,.25); }
    .toast.error { border-left-color: #e0444c; }
    .toast i { margin-top: 3px; }
    .toast span { flex: 1; }
    .close { border: 0; background: none; color: #cfd4d7; cursor: pointer; padding: 0 2px; }
  `,
})
export class Toasts {
  protected readonly toasts = inject(ToastService);
}

/** Page buttons in the style of today's app; the current page uses the Edwards red gradient. */
@Component({
  selector: 'app-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pager">
      <span>
        @if (total() === 0) { No records }
        @else { Showing {{ first() }}–{{ last() }} of {{ total() }} }
      </span>
      @if (pageCount() > 1) {
        <div class="pages">
          <button type="button" [disabled]="page() === 1" (click)="pageChange.emit(page() - 1)" aria-label="Previous page">
            <i class="fa-solid fa-angle-left"></i>
          </button>
          @for (p of pages(); track $index) {
            @if (p === 0) { <button type="button" disabled>…</button> }
            @else {
              <button type="button" [class.current]="p === page()" [attr.aria-current]="p === page() ? 'page' : null" (click)="pageChange.emit(p)">{{ p }}</button>
            }
          }
          <button type="button" [disabled]="page() === pageCount()" (click)="pageChange.emit(page() + 1)" aria-label="Next page">
            <i class="fa-solid fa-angle-right"></i>
          </button>
        </div>
      }
    </div>
  `,
})
export class Pager {
  readonly total = input.required<number>();
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly pageChange = output<number>();

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly first = computed(() => (this.page() - 1) * this.pageSize() + 1);
  protected readonly last = computed(() => Math.min(this.total(), this.page() * this.pageSize()));

  /** Page numbers around the current page; 0 marks a gap. */
  protected readonly pages = computed(() => {
    const count = this.pageCount();
    const current = this.page();
    const wanted = new Set([1, count, current - 1, current, current + 1].filter((p) => p >= 1 && p <= count));
    const sorted = [...wanted].sort((a, b) => a - b);
    const out: number[] = [];
    sorted.forEach((p, i) => {
      if (i > 0 && p - sorted[i - 1] > 1) out.push(0);
      out.push(p);
    });
    return out;
  });
}

/** A dialog with the red gradient header. Closes on Escape or the close button. */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="modal-backdrop">
      <section class="modal" [class.wide]="wide()" role="dialog" aria-modal="true" [attr.aria-label]="title()">
        <div class="panel-heading">
          <h3>{{ title() }}</h3>
          <button type="button" class="icon-btn" (click)="closed.emit()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <ng-content />
      </section>
    </div>
  `,
})
export class Modal {
  readonly title = input.required<string>();
  readonly wide = input(false);
  readonly closed = output<void>();
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    // Moves focus into the dialog so keyboard users start inside it.
    afterNextRender(() => {
      const first = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.panel-body input, .panel-body select, .panel-body textarea');
      first?.focus();
    });
  }
}
