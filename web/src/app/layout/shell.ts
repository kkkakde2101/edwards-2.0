import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { NotificationItem } from '../core/admin-models';
import { MenuItem, SCOPE_LABELS } from '../core/models';
import { formatDateTime } from '../core/support';
import { NotificationService } from '../pages/alerts';

const MOBILE = '(max-width: 991px)';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly notes = inject(NotificationService);
  private readonly router = inject(Router);
  protected readonly dateTime = formatDateTime;
  protected readonly bellOpen = signal(false);

  protected readonly me = this.auth.me;
  protected readonly year = new Date().getFullYear();
  protected readonly sidebarOpen = signal(!matchMedia(MOBILE).matches);
  protected readonly userMenuOpen = signal(false);
  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  private readonly url = signal(this.router.url);

  protected readonly initials = computed(() => {
    const parts = (this.me()?.displayName ?? '').split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  });

  protected readonly scopeLabel = computed(() => {
    const me = this.me();
    return me ? SCOPE_LABELS[me.scope] : '';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed(destroyRef))
      .subscribe((e) => {
        this.url.set(e.urlAfterRedirects);
        this.userMenuOpen.set(false);
        this.bellOpen.set(false);
        if (matchMedia(MOBILE).matches) this.sidebarOpen.set(false);
        this.notes.refresh();
      });
    // New alerts show up within a minute without reloading the page.
    this.notes.refresh();
    const timer = setInterval(() => this.notes.refresh(), 60_000);
    destroyRef.onDestroy(() => clearInterval(timer));
  }

  protected toggleBell(): void {
    const open = !this.bellOpen();
    this.bellOpen.set(open);
    this.userMenuOpen.set(false);
    if (open) this.notes.loadLatest();
  }

  protected openNote(n: NotificationItem): void {
    this.notes.markRead(n);
    this.bellOpen.set(false);
    if (n.link) void this.router.navigateByUrl(n.link);
  }

  protected isGroupOpen(item: MenuItem): boolean {
    const url = this.url();
    return this.expanded().has(item.label) || (item.children ?? []).some((c) => !!c.route && url.startsWith(c.route));
  }

  protected toggleGroup(item: MenuItem): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(item.label)) next.delete(item.label);
      else next.add(item.label);
      return next;
    });
  }

  protected signOut(): void {
    this.auth.logout();
  }
}
