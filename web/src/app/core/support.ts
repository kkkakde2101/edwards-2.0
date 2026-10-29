import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { AbstractControl, FormGroup } from '@angular/forms';
import { Observable, shareReplay } from 'rxjs';
import { DealerOption, Option, PagedResult } from './models';

// ---- Errors -------------------------------------------------------------------------------------

/** A sentence the user can act on, taken from the API's problem details when it sends one. */
export function problemMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;
  const body = err.error as { detail?: string; title?: string } | null;
  if (err.status === 0) return 'The server cannot be reached. Check your connection and try again.';
  if (err.status === 403) return 'Your role does not allow this.';
  if (err.status === 404) return 'This record no longer exists, or your role cannot see it.';
  if (body?.detail) return body.detail;
  if (err.status === 400 && body?.title) return 'Some fields need attention.';
  return fallback;
}

/** Validation errors from the API, keyed by field name ("pinCode", "dealerId"...). */
export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (err instanceof HttpErrorResponse && err.status === 400) {
    const errors = (err.error as { errors?: Record<string, string[]> } | null)?.errors ?? {};
    for (const [key, messages] of Object.entries(errors)) {
      const name = key.replace(/^\$\./, '');
      out[name.charAt(0).toLowerCase() + name.slice(1)] = messages[0] ?? 'This value is not valid.';
    }
  }
  return out;
}

/** The first message to show under a field: the API's message first, then the form's own checks. */
export function controlError(
  form: FormGroup,
  name: string,
  submitted: boolean,
  server: Record<string, string>,
  labels: Record<string, string> = {},
): string | null {
  if (server[name]) return server[name];
  const control: AbstractControl | null = form.get(name);
  if (!control || control.valid || !(control.touched || submitted)) return null;
  const e = control.errors ?? {};
  if (e['required']) return labels['required'] ?? 'This field is required.';
  if (e['email']) return 'Enter a valid email address.';
  if (e['minlength']) return `Enter at least ${(e['minlength'] as { requiredLength: number }).requiredLength} characters.`;
  if (e['maxlength']) return `Use at most ${(e['maxlength'] as { requiredLength: number }).requiredLength} characters.`;
  if (e['pattern']) return labels['pattern'] ?? 'This value is not in the right format.';
  return 'This value is not valid.';
}

// ---- Lookups ------------------------------------------------------------------------------------

/** Dropdown values. Master lists are cached for the session; dealer lists depend on the user's scope. */
@Injectable({ providedIn: 'root' })
export class LookupService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Observable<Option[]>>();

  master(key: string): Observable<Option[]> {
    let list = this.cache.get(key);
    if (!list) {
      list = this.http.get<Option[]>(`/api/lookups/masters/${key}`).pipe(shareReplay(1));
      this.cache.set(key, list);
    }
    return list;
  }

  dealers(): Observable<DealerOption[]> {
    return this.http.get<DealerOption[]>('/api/lookups/dealers');
  }

  /** Models of one product range. */
  productModels(rangeId: number): Observable<Option[]> {
    return this.http.get<Option[]>('/api/lookups/masters/product-models', { params: { parentId: rangeId } });
  }

  /** Every active dealer, also outside the user's scope (for transfers). */
  allDealers(): Observable<DealerOption[]> {
    return this.http.get<DealerOption[]>('/api/lookups/dealers/all');
  }

  /** Engineers of a dealer; "any" includes dealers outside the user's scope. */
  dealerUsers(dealerId: number, any = false): Observable<Option[]> {
    return this.http.get<Option[]>(`/api/lookups/dealers/${dealerId}/users`, { params: any ? { any: true } : {} });
  }

  customers(search: string): Observable<Option[]> {
    return this.http.get<Option[]>('/api/lookups/customers', { params: { search } });
  }

  customer(id: number): Observable<Option[]> {
    return this.http.get<Option[]>('/api/lookups/customers', { params: { id } });
  }

  customerAssets(customerId: number): Observable<Option[]> {
    return this.http.get<Option[]>(`/api/lookups/customers/${customerId}/assets`);
  }

  wonOpportunities(customerId: number): Observable<Option[]> {
    return this.http.get<Option[]>(`/api/lookups/customers/${customerId}/won-opportunities`);
  }

  /** Edwards service staff and the customer's dealer engineers. */
  engineers(customerId: number): Observable<Option[]> {
    return this.http.get<Option[]>('/api/lookups/engineers', { params: { customerId } });
  }

  /** Active users of the given role codes, e.g. "sales,admin". */
  users(roles: string): Observable<Option[]> {
    return this.http.get<Option[]>('/api/lookups/users', { params: { roles } });
  }

  roles(): Observable<Option[]> {
    return this.http.get<Option[]>('/api/lookups/roles');
  }

  /** Called after a master list is edited so dropdowns pick up the change. */
  forget(key: string): void {
    this.cache.delete(key);
  }
}

// ---- Toasts -------------------------------------------------------------------------------------

export interface Toast {
  id: number;
  text: string;
  kind: 'success' | 'error';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private next = 1;
  readonly toasts = signal<Toast[]>([]);

  show(text: string, kind: Toast['kind'] = 'success'): void {
    const toast = { id: this.next++, text, kind };
    this.toasts.update((list) => [...list, toast]);
    setTimeout(() => this.dismiss(toast.id), kind === 'error' ? 7000 : 4000);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}

// ---- Dates --------------------------------------------------------------------------------------

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-10-27" or an ISO timestamp, shown as "27 Oct 2026". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

/** "2026-10-27T09:30:00Z" shown as "27 Oct 2026, 15:00" in the viewer's time zone. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`);
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${formatDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)}, ${time}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Days from today to the date; negative when it has passed. */
export function daysFromToday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - start.getTime()) / 86_400_000);
}

// ---- Numbers ------------------------------------------------------------------------------------

const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹12,34,567 with Indian digit grouping. */
export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : RUPEES.format(value);
}

/** ₹12.3 L / ₹4.5 Cr, for tiles where space is short. */
export function formatMoneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (Math.abs(value) >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (Math.abs(value) >= 1e5) return `₹${(value / 1e5).toFixed(1)} L`;
  return RUPEES.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : NUMBER.format(value);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

// ---- Lists --------------------------------------------------------------------------------------

export type QueryValues = Record<string, string | number | boolean | null | undefined>;

/** Query parameters without the empty values. */
export function toParams(values: QueryValues): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '' || value === false) continue;
    params = params.set(key, typeof value === 'string' ? value.trim() : value);
  }
  return params;
}

/** One page of an API list with its loading and error state. */
export class PagedList<T> {
  readonly result = signal<PagedResult<T> | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor(
    private readonly http: HttpClient,
    private readonly url: string,
    private readonly failure = 'The list could not be loaded.',
  ) {}

  load(values: QueryValues): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<PagedResult<T>>(this.url, { params: toParams(values) }).subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(problemMessage(err, this.failure));
      },
    });
  }
}

/** Saves a file the API returns (Excel exports, templates, downloads) under the name the API gives it. */
export function saveFile(http: HttpClient, url: string, params: HttpParams, fallbackName: string): Observable<void> {
  return new Observable<void>((subscriber) => {
    const sub = http.get(url, { params, observe: 'response', responseType: 'blob' }).subscribe({
      next: (response) => {
        const disposition = response.headers.get('Content-Disposition') ?? '';
        const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
        const name = match ? decodeURIComponent(match[1]) : fallbackName;
        const href = URL.createObjectURL(response.body!);
        const a = document.createElement('a');
        a.href = href;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        subscriber.next();
        subscriber.complete();
      },
      error: (err: unknown) => subscriber.error(err),
    });
    return () => sub.unsubscribe();
  });
}
