import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { SessionService } from './session.service';

export const identityInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  return next(
    req.clone({
      setHeaders: { 'x-user-id': String(session.userId()), 'x-scopes': session.scopes() },
    }),
  );
};
