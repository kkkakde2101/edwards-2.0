import { HttpClient, HttpParams } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UploadBatchItem, UploadKind, UploadResult } from '../../core/admin-models';
import { PagedResult } from '../../core/models';
import { fieldErrors, formatDateTime, problemMessage, saveFile, ToastService } from '../../core/support';

/** Bulk loading from Excel: download the template, fill it, upload it. Nothing is saved while any row has a problem. */
@Component({
  selector: 'app-upload',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div>
        <h1>Excel upload</h1>
        <div class="breadcrumb"><a routerLink="/">Home</a><span>/</span><span>Administration</span><span>/</span><span>Excel upload</span></div>
      </div>
    </div>

    <div class="kinds">
      @for (k of kinds(); track k.key) {
        <button type="button" class="kind" [class.active]="kind()?.key === k.key" (click)="choose(k)">
          <strong>{{ k.title }}</strong><span>{{ k.description }}</span>
        </button>
      }
    </div>

    @if (kind(); as k) {
      <section class="panel">
        <div class="panel-heading">
          <h3>{{ k.title }}</h3>
          <button type="button" class="btn btn-light btn-sm" (click)="template(k)"><i class="fa-solid fa-file-arrow-down"></i> Download template</button>
        </div>
        <div class="panel-body">
          <ol class="steps">
            <li>Download the template. It lists the allowed values on the <em>Lists</em> sheet.</li>
            <li>Fill one row per record. Red headings are required.</li>
            <li>Upload the file. Every row is checked first; if any row has a problem nothing is saved.</li>
          </ol>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Column</th><th>Required</th><th>How to fill it</th></tr></thead>
              <tbody>
                @for (c of k.columns; track c.header) {
                  <tr><td>{{ c.header }}</td><td>{{ c.required ? 'Yes' : 'No' }}</td><td class="muted">{{ c.hint || '—' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
          <div class="upload-row">
            <label for="file" class="sr-only">Excel file</label>
            <input id="file" type="file" accept=".xlsx" (change)="picked($event)">
            <button type="button" class="btn btn-primary" [disabled]="!file || busy()" (click)="upload(k)">
              @if (busy()) { <i class="fa-solid fa-spinner fa-spin"></i> Checking… } @else { <i class="fa-solid fa-upload"></i> Upload }
            </button>
          </div>
          @if (error()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div> }
          @if (result(); as r) {
            @if (r.failed === 0) {
              <div class="alert alert-info"><i class="fa-solid fa-circle-check"></i><span>{{ r.saved }} of {{ r.rows }} rows saved.</span></div>
            } @else {
              <div class="alert alert-warning"><i class="fa-solid fa-triangle-exclamation"></i>
                <span>{{ r.failed }} of {{ r.rows }} rows have problems, so nothing was saved. Fix these and upload again.</span></div>
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th class="num">Row</th><th>Column</th><th>Problem</th></tr></thead>
                  <tbody>@for (e of r.errors; track $index) { <tr><td class="num">{{ e.row }}</td><td>{{ e.column }}</td><td>{{ e.message }}</td></tr> }</tbody>
                </table>
              </div>
            }
          }
        </div>
      </section>
    }

    <section class="panel">
      <div class="panel-heading"><h3>Upload history</h3></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>When</th><th>Kind</th><th>File</th><th>By</th><th class="num">Rows</th><th class="num">Saved</th><th class="num">With problems</th></tr></thead>
          <tbody>
            @for (b of history(); track b.id) {
              <tr><td class="nowrap">{{ dateTime(b.at) }}</td><td>{{ b.kind }}</td><td>{{ b.fileName }}</td><td>{{ b.uploadedBy || '—' }}</td>
                <td class="num">{{ b.rows }}</td><td class="num">{{ b.saved }}</td><td class="num">{{ b.failed }}</td></tr>
            } @empty { <tr class="empty"><td colspan="7">No uploads yet.</td></tr> }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    .kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .kind { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 12px; background: #fff; border: 1px solid var(--edw-border); border-left: 4px solid var(--edw-slate); cursor: pointer; font: inherit; color: var(--edw-text); }
    .kind.active { border-left-color: var(--edw-red); background: #fdf6f6; }
    .kind span { font-size: 13px; color: var(--edw-muted); }
    .steps { margin: 0 0 12px; padding-left: 20px; }
    .upload-row { display: flex; gap: 12px; align-items: center; margin: 14px 0; flex-wrap: wrap; }
  `,
})
export class Upload {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  protected readonly dateTime = formatDateTime;
  protected readonly kinds = signal<UploadKind[]>([]);
  protected readonly kind = signal<UploadKind | null>(null);
  protected readonly history = signal<UploadBatchItem[]>([]);
  protected readonly result = signal<UploadResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected file: File | null = null;

  constructor() {
    this.http.get<UploadKind[]>('/api/uploads/kinds').subscribe((list) => {
      this.kinds.set(list);
      this.kind.set(list[0] ?? null);
    });
    this.loadHistory();
  }

  protected choose(k: UploadKind): void {
    this.kind.set(k);
    this.result.set(null);
    this.error.set(null);
  }

  protected picked(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.result.set(null);
    this.error.set(null);
  }

  protected template(k: UploadKind): void {
    saveFile(this.http, `/api/uploads/${k.key}/template`, new HttpParams(), `edwards-${k.key}-template.xlsx`).subscribe({
      error: (err: unknown) => this.toast.show(problemMessage(err), 'error'),
    });
  }

  protected upload(k: UploadKind): void {
    if (!this.file) return;
    const form = new FormData();
    form.append('file', this.file);
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    this.http.post<UploadResult>(`/api/uploads/${k.key}`, form).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.result.set(r);
        if (r.failed === 0) this.toast.show(`${r.saved} rows saved.`);
        this.loadHistory();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(Object.values(fieldErrors(err))[0] ?? problemMessage(err, 'The file could not be uploaded.'));
      },
    });
  }

  private loadHistory(): void {
    this.http.get<PagedResult<UploadBatchItem>>('/api/uploads', { params: { pageSize: 20 } }).subscribe((r) => this.history.set(r.items));
  }
}
