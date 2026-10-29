import { HttpClient, HttpParams } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DocumentItem, DocumentOwner } from '../core/admin-models';
import { AuthService } from '../core/auth.service';
import { P } from '../core/models';
import { fieldErrors, formatBytes, formatDate, formatDateTime, LookupService, problemMessage, saveFile, toParams, ToastService } from '../core/support';
import { CanDirective, Modal } from './ui';

/**
 * Shows a document inside the app: PDF pages and images are drawn on canvases with the viewer's name and the time
 * stamped across them, so screenshots and saved images carry the watermark. The original file is not exposed here.
 */
@Component({
  selector: 'app-secure-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Modal],
  template: `
    <app-modal [title]="doc().title" [wide]="true" (closed)="dismissed.emit()">
      <div class="viewer" (contextmenu)="$event.preventDefault()">
        @if (error()) {
          <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ error() }}</div>
        } @else if (loading()) {
          <div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Opening the document…</div>
        }
        <div #pages class="pages" [attr.aria-label]="doc().title"></div>
      </div>
      <div class="panel-footer note">
        <span class="muted"><i class="fa-solid fa-shield-halved"></i> Viewed by {{ viewer }}. Every view is recorded.</span>
        <button type="button" class="btn btn-light" (click)="dismissed.emit()">Close</button>
      </div>
    </app-modal>
  `,
  styles: `
    .viewer { max-height: 72vh; overflow: auto; background: #525659; padding: 12px; user-select: none; }
    .pages { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .pages ::ng-deep canvas { max-width: 100%; height: auto; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
    .note { justify-content: space-between; align-items: center; }
  `,
})
export class SecureViewer implements OnInit {
  readonly doc = input.required<DocumentItem>();
  readonly dismissed = output<void>();

  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly pages = viewChild.required<ElementRef<HTMLDivElement>>('pages');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly viewer = `${this.auth.me()?.displayName ?? ''} (${this.auth.me()?.loginName ?? ''})`;
  private readonly stamp = `${this.viewer} · ${formatDateTime(new Date().toISOString())} · Edwards confidential`;

  ngOnInit(): void {
    this.http.get(`/api/documents/${this.doc().id}/view`, { responseType: 'blob' }).subscribe({
      next: (blob) => void this.render(blob).catch(() => this.fail('The document could not be shown.')),
      error: (err: unknown) => this.fail(problemMessage(err, 'The document could not be opened.')),
    });
  }

  private fail(message: string): void {
    this.loading.set(false);
    this.error.set(message);
  }

  private async render(blob: Blob): Promise<void> {
    const host = this.pages().nativeElement;
    if (this.doc().contentType === 'application/pdf') {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        this.watermark(canvas);
        host.appendChild(canvas);
      }
    } else {
      const url = URL.createObjectURL(blob);
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d')!.drawImage(image, 0, 0);
        this.watermark(canvas);
        host.appendChild(canvas);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    this.loading.set(false);
  }

  /** Repeats the viewer's name and time diagonally across the page. */
  private watermark(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    const size = Math.max(14, Math.round(canvas.width / 40));
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#870a20';
    ctx.font = `600 ${size}px "Source Sans Pro", Arial, sans-serif`;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 6);
    const step = size * 6;
    const reach = Math.hypot(canvas.width, canvas.height);
    for (let y = -reach; y < reach; y += step) {
      for (let x = -reach; x < reach; x += ctx.measureText(this.stamp).width + size * 3) ctx.fillText(this.stamp, x, y);
    }
    ctx.restore();
  }
}

/** Documents attached to a record, with upload, the secure viewer and (where allowed) download of the original. */
@Component({
  selector: 'app-documents',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CanDirective, Modal, SecureViewer],
  template: `
    <section class="panel">
      <div class="panel-heading">
        <h3>Documents <span class="count">{{ docs().length }}</span></h3>
        @if (canUpload()) {
          <button *appCan="P.documentsUpload" type="button" class="btn btn-primary btn-sm" (click)="openUpload()"><i class="fa-solid fa-upload"></i> Upload</button>
        }
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Title</th><th>Type</th><th>File</th><th class="num">Size</th><th>Uploaded by</th><th>Date</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            @for (d of docs(); track d.id) {
              <tr>
                <td>
                  @if (d.viewable) { <button type="button" class="link-btn" (click)="viewing.set(d)">{{ d.title }}</button> }
                  @else { {{ d.title }} }
                </td>
                <td>{{ d.documentType || '—' }}</td>
                <td class="muted">{{ d.fileName }}</td>
                <td class="num nowrap">{{ bytes(d.size) }}</td>
                <td>{{ d.uploadedBy || '—' }}</td>
                <td class="nowrap">{{ date(d.createdAt) }}</td>
                <td class="row-actions">
                  @if (d.viewable) {
                    <button type="button" class="icon-btn" (click)="viewing.set(d)" [attr.aria-label]="'View ' + d.title" title="View"><i class="fa-solid fa-eye"></i></button>
                  }
                  @if (d.canDownload) {
                    <button type="button" class="icon-btn" (click)="download(d)" [attr.aria-label]="'Download ' + d.title" title="Download original"><i class="fa-solid fa-download"></i></button>
                  }
                  @if (d.canRemove) {
                    <button type="button" class="icon-btn" (click)="remove(d)" [attr.aria-label]="'Remove ' + d.title" title="Remove"><i class="fa-solid fa-trash"></i></button>
                  }
                </td>
              </tr>
            } @empty {
              <tr class="empty"><td colspan="7">{{ loading() ? 'Loading…' : 'No documents yet.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (viewing(); as d) {
      <app-secure-viewer [doc]="d" (dismissed)="viewing.set(null)" />
    }

    @if (uploading()) {
      <app-modal title="Upload a document" (closed)="uploading.set(false)">
        <form (ngSubmit)="upload()" novalidate>
          <div class="panel-body">
            @if (uploadError()) { <div class="alert alert-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i>{{ uploadError() }}</div> }
            <div class="form-grid two">
              <div class="field full">
                <label for="docFile">File<span class="req">*</span></label>
                <input id="docFile" class="input" type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx,.csv,.txt" (change)="picked($event)">
                <span class="hint">PDF and images open in the secure viewer. Up to 20 MB.</span>
              </div>
              <div class="field">
                <label for="docTitle">Title</label>
                <input id="docTitle" name="title" class="input" maxlength="200" [(ngModel)]="title" placeholder="The file name if empty">
              </div>
              <div class="field">
                <label for="docType">Document type</label>
                <select id="docType" name="type" class="input" [(ngModel)]="typeId">
                  <option [ngValue]="null">Not set</option>
                  @for (t of types(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
                </select>
              </div>
            </div>
          </div>
          <div class="panel-footer">
            <button type="button" class="btn btn-light" (click)="uploading.set(false)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy() || !file">Upload</button>
          </div>
        </form>
      </app-modal>
    }
  `,
})
export class DocumentsPanel implements OnInit {
  readonly ownerType = input.required<DocumentOwner>();
  readonly ownerId = input.required<number>();
  /** Lists every document of the customer, whatever it is attached to. */
  readonly allForCustomer = input(false);
  readonly canUpload = input(true);

  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly bytes = formatBytes;
  protected readonly types = toSignal(inject(LookupService).master('document-types'), { initialValue: [] });
  protected readonly docs = signal<DocumentItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly viewing = signal<DocumentItem | null>(null);
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected file: File | null = null;
  protected title = '';
  protected typeId: number | null = null;

  ngOnInit(): void {
    this.load();
  }

  protected openUpload(): void {
    this.file = null;
    this.title = '';
    this.typeId = null;
    this.uploadError.set(null);
    this.uploading.set(true);
  }

  protected picked(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  protected upload(): void {
    if (!this.file) return;
    const form = new FormData();
    form.append('file', this.file);
    form.append('ownerType', this.ownerType());
    form.append('ownerId', String(this.ownerId()));
    if (this.title.trim()) form.append('title', this.title.trim());
    if (this.typeId !== null) form.append('documentTypeId', String(this.typeId));
    this.busy.set(true);
    this.uploadError.set(null);
    this.http.post<DocumentItem>('/api/documents', form).subscribe({
      next: (doc) => {
        this.busy.set(false);
        this.uploading.set(false);
        this.docs.update((list) => [doc, ...list]);
        this.toast.show(`${doc.title} uploaded.`);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.uploadError.set(Object.values(fields)[0] ?? problemMessage(err, 'The file could not be uploaded.'));
      },
    });
  }

  protected download(doc: DocumentItem): void {
    saveFile(this.http, `/api/documents/${doc.id}/download`, new HttpParams(), doc.fileName).subscribe({
      error: (err: unknown) => this.toast.show(problemMessage(err, 'The file could not be downloaded.'), 'error'),
    });
  }

  protected remove(doc: DocumentItem): void {
    this.http.post<void>(`/api/documents/${doc.id}/remove`, {}).subscribe({
      next: () => {
        this.docs.update((list) => list.filter((d) => d.id !== doc.id));
        this.toast.show(`${doc.title} removed.`);
      },
      error: (err: unknown) => this.toast.show(problemMessage(err), 'error'),
    });
  }

  private load(): void {
    const params = toParams(this.allForCustomer()
      ? { customerId: this.ownerId(), pageSize: 100 }
      : { ownerType: this.ownerType(), ownerId: this.ownerId(), pageSize: 100 });
    this.http.get<{ items: DocumentItem[] }>('/api/documents', { params }).subscribe({
      next: (r) => {
        this.docs.set(r.items);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
