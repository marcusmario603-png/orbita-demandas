import { provideHttpClient, withInterceptors } from '@angular/common/http';
import type { ApplicationConfig } from '@angular/core';
import { identityInterceptor } from './identity.interceptor';

// Angular 21 é zoneless por padrão: a atualização da tela vem de signals + OnPush.
export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(withInterceptors([identityInterceptor]))],
};
