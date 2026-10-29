import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Option } from '../../core/models';
import { LineType, QuotationItem, QuotationLine } from '../../core/sales-models';
import { fieldErrors, formatMoney, LookupService, problemMessage, todayIso } from '../../core/support';
import { Modal } from '../../shared/ui';

interface EditableLine extends QuotationLine {
  models: Option[];
}

/** Prepares a quotation draft: equipment lines name a range and model, spare and service lines a description. */
@Component({
  selector: 'app-quotation-editor',
  imports: [FormsModule, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [title]="quotation() ? 'Edit ' + quotation()!.number : 'New quotation'" [wide]="true" (closed)="dismissed.emit()">
      <form (ngSubmit)="save()" novalidate>
        <div class="panel-body">
          @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
          <div class="form-grid">
            <div class="field">
              <label for="qDate">Quotation date<span class="req">*</span></label>
              <input id="qDate" name="qDate" class="input" type="date" [(ngModel)]="quoteDate" required>
            </div>
            <div class="field wide">
              <label for="qRemark">Remarks</label>
              <input id="qRemark" name="qRemark" class="input" maxlength="2000" [(ngModel)]="remark" placeholder="Delivery, payment and validity terms">
            </div>
          </div>
          <div class="table-wrap lines">
            <table class="table">
              <thead><tr><th>Type</th><th>Product range / description</th><th>Model</th><th class="num">Qty</th><th class="num">Unit price (₹)</th><th class="num">Line total</th><th><span class="sr-only">Remove</span></th></tr></thead>
              <tbody>
                @for (l of lines(); track $index; let i = $index) {
                  <tr>
                    <td>
                      <select class="input" [name]="'type' + i" [(ngModel)]="l.type" (ngModelChange)="touch()" [attr.aria-label]="'Type, line ' + (i + 1)">
                        <option value="Equipment">Equipment</option>
                        <option value="Spare">Spare</option>
                        <option value="Service">Service</option>
                      </select>
                    </td>
                    @if (l.type === 'Equipment') {
                      <td>
                        <select class="input" [name]="'range' + i" [(ngModel)]="l.productRangeId" (ngModelChange)="rangeChanged(l)" [attr.aria-label]="'Product range, line ' + (i + 1)">
                          <option [ngValue]="null">Choose…</option>
                          @for (r of ranges(); track r.id) { <option [ngValue]="r.id">{{ r.name }}</option> }
                        </select>
                      </td>
                      <td>
                        <select class="input" [name]="'model' + i" [(ngModel)]="l.productModelId" [attr.aria-label]="'Model, line ' + (i + 1)">
                          <option [ngValue]="null">Choose…</option>
                          @for (m of l.models; track m.id) { <option [ngValue]="m.id">{{ m.name }}</option> }
                        </select>
                      </td>
                    } @else {
                      <td colspan="2"><input class="input" [name]="'desc' + i" maxlength="300" [(ngModel)]="l.description" placeholder="What is supplied" [attr.aria-label]="'Description, line ' + (i + 1)"></td>
                    }
                    <td><input class="input num qty" type="number" min="1" [name]="'qty' + i" [(ngModel)]="l.quantity" (ngModelChange)="touch()" [attr.aria-label]="'Quantity, line ' + (i + 1)"></td>
                    <td><input class="input num price" type="number" min="0" step="0.01" [name]="'price' + i" [(ngModel)]="l.unitPrice" (ngModelChange)="touch()" [attr.aria-label]="'Unit price, line ' + (i + 1)"></td>
                    <td class="num nowrap">{{ money((l.quantity || 0) * (l.unitPrice || 0)) }}</td>
                    <td class="row-actions"><button type="button" class="icon-btn" (click)="removeLine(i)" [disabled]="lines().length === 1" [attr.aria-label]="'Remove line ' + (i + 1)"><i class="fa-solid fa-xmark"></i></button></td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr><td colspan="5" class="num"><strong>Total</strong></td><td class="num nowrap"><strong>{{ money(total()) }}</strong></td><td></td></tr>
              </tfoot>
            </table>
          </div>
          <button type="button" class="btn btn-light btn-sm" (click)="addLine()"><i class="fa-solid fa-plus"></i> Add line</button>
        </div>
        <div class="panel-footer">
          <button type="button" class="btn btn-light" (click)="dismissed.emit()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Save draft</button>
        </div>
      </form>
    </app-modal>
  `,
  styles: `
    .lines { margin: 12px 0 8px; }
    .lines .input { height: 30px; }
    .lines .num { text-align: right; }
    .qty { width: 70px; }
    .price { width: 120px; }
  `,
})
export class QuotationEditor implements OnInit {
  readonly opportunityId = input.required<number>();
  /** The draft to edit; empty for a new quotation. */
  readonly quotation = input<QuotationItem | null>(null);
  readonly dismissed = output<void>();
  readonly saved = output<QuotationItem>();

  private readonly http = inject(HttpClient);
  private readonly lookups = inject(LookupService);
  protected readonly money = formatMoney;
  protected readonly ranges = toSignal(this.lookups.master('product-ranges'), { initialValue: [] });
  protected readonly lines = signal<EditableLine[]>([]);
  private readonly version = signal(0);
  protected readonly total = computed(() => {
    this.version();
    return this.lines().reduce((sum, l) => sum + (l.quantity || 0) * (l.unitPrice || 0), 0);
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected quoteDate = todayIso();
  protected remark = '';

  ngOnInit(): void {
    const q = this.quotation();
    if (!q) {
      this.lines.set([this.blank('Equipment')]);
      return;
    }
    this.quoteDate = q.quoteDate;
    this.remark = q.remark ?? '';
    this.lines.set(q.lines.map((l) => ({ ...l, models: [] })));
    for (const l of this.lines()) if (l.productRangeId) this.loadModels(l);
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected addLine(): void {
    this.lines.update((list) => [...list, this.blank(list.at(-1)?.type ?? 'Equipment')]);
  }

  protected removeLine(index: number): void {
    this.lines.update((list) => list.filter((_, i) => i !== index));
  }

  protected rangeChanged(line: EditableLine): void {
    line.productModelId = null;
    line.models = [];
    if (line.productRangeId) this.loadModels(line);
  }

  protected save(): void {
    this.error.set(null);
    const lines = this.lines().map((l) => ({
      type: l.type,
      productRangeId: l.type === 'Equipment' ? l.productRangeId : null,
      productModelId: l.type === 'Equipment' ? l.productModelId : null,
      description: l.description?.trim() || null,
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
    }));
    const missing = lines.findIndex((l) => (l.type === 'Equipment' ? !l.productModelId : !l.description) || l.quantity < 1);
    if (missing >= 0) {
      this.error.set(`Line ${missing + 1}: ${lines[missing].type === 'Equipment' ? 'choose the range and model' : 'describe the item'} and enter a quantity.`);
      return;
    }
    const body = { quoteDate: this.quoteDate, remark: this.remark.trim() || null, lines };
    const q = this.quotation();
    const request = q
      ? this.http.put<QuotationItem>(`/api/quotations/${q.id}`, body)
      : this.http.post<QuotationItem>(`/api/opportunities/${this.opportunityId()}/quotations`, body);
    this.busy.set(true);
    request.subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.saved.emit(saved);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(Object.values(fieldErrors(err))[0] ?? problemMessage(err, 'The quotation could not be saved.'));
      },
    });
  }

  private blank(type: LineType): EditableLine {
    return { type, productRangeId: null, productModelId: null, description: '', quantity: 1, unitPrice: 0, models: [] };
  }

  private loadModels(line: EditableLine): void {
    this.lookups.productModels(line.productRangeId!).subscribe((models) => {
      line.models = models;
      this.lines.update((list) => [...list]);
    });
  }
}
