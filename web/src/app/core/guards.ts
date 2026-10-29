import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';

/** Requires a signed-in user, and sends users who must change their password to that page first. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ensureMe().pipe(
    map((me) => {
      if (!me) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
      if (me.mustChangePassword && !state.url.startsWith('/change-password')) {
        return router.createUrlTree(['/change-password']);
      }
      return true;
    }),
  );
};

/** Opens the page only when the user's role holds the permission. The API checks the same permission again. */
export const permissionGuard = (permission: string): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ensureMe().pipe(
    map((me) => {
      if (!me) return router.createUrlTree(['/login']);
      return auth.can(permission) ? true : router.createUrlTree(['/forbidden']);
    }),
  );
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.token() ? router.createUrlTree(['/']) : true;
};
