import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

export const authGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const auth = inject(Auth);
  const router = inject(Router);
  const user = await firstValueFrom(authState(auth).pipe(take(1)));

  if (user) {
    return true;
  }

  return router.createUrlTree(['/login'], {
    queryParams: state.url && state.url !== '/login' ? { returnUrl: state.url } : undefined
  });
};
