import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, map, Observable, of, shareReplay, switchMap, tap } from 'rxjs';
import { LoginResponse, Me } from './models';

const STORAGE_KEY = 'edwards.session';

interface StoredSession {
  token: string;
  expiresAt: string;
}

/** Holds the signed-in user. Menus and buttons read their permissions from here; the API enforces them again. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private pendingMe: Observable<Me | null> | null = null;

  readonly token = signal<string | null>(readSession());
  readonly me = signal<Me | null>(null);
  readonly permissions = computed(() => new Set(this.me()?.permissions ?? []));

  can(permission: string): boolean {
    return this.permissions().has(permission);
  }

  login(loginName: string, password: string): Observable<Me> {
    return this.http.post<LoginResponse>('/api/auth/login', { loginName, password }).pipe(
      tap((r) => this.store({ token: r.token, expiresAt: r.expiresAt })),
      switchMap(() => this.loadMe()),
    );
  }

  loadMe(): Observable<Me> {
    return this.http.get<Me>('/api/auth/me').pipe(tap((me) => this.me.set(me)));
  }

  /** Resolves the current user once, sharing the request between guards that ask at the same time. */
  ensureMe(): Observable<Me | null> {
    const current = this.me();
    if (current) return of(current);
    if (!this.token()) return of(null);
    this.pendingMe ??= this.loadMe().pipe(
      map((me): Me | null => me),
      catchError(() => {
        this.clear();
        return of(null);
      }),
      finalize(() => (this.pendingMe = null)),
      shareReplay(1),
    );
    return this.pendingMe;
  }

  changePassword(currentPassword: string, newPassword: string): Observable<Me> {
    return this.http
      .post<void>('/api/auth/change-password', { currentPassword, newPassword })
      .pipe(switchMap(() => this.loadMe()));
  }

  logout(): void {
    this.clear();
    void this.router.navigateByUrl('/login');
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: nothing to remove */
    }
    this.token.set(null);
    this.me.set(null);
  }

  private store(session: StoredSession): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* private mode: the session lasts until the tab closes */
    }
    this.token.set(session.token);
  }
}

function readSession(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    return new Date(session.expiresAt).getTime() > Date.now() ? session.token : null;
  } catch {
    return null;
  }
}
