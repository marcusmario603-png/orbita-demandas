import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DemandsPage } from './demands-page';
import { ApiService } from './api.service';
import { SessionService } from './session.service';

@Component({
  selector: 'app-root',
  imports: [DemandsPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar">
      <h1>Órbita <span class="topbar-sub">Fila de demandas</span></h1>

      <div class="identity" role="group" aria-label="Simular outro usuário">
        <label for="user">Operando como</label>
        <select id="user" [value]="session.userId()" (change)="pickUser($any($event.target).value)">
          @for (u of session.users(); track u.id) {
            <option [value]="u.id" [selected]="u.id === session.userId()">{{ u.name }}</option>
          }
        </select>
        <label class="check">
          <input
            type="checkbox"
            [checked]="session.supervisor()"
            (change)="pickSupervisor($any($event.target).checked)"
          />
          Supervisão
        </label>
      </div>
    </header>

    <main>
      <app-demands-page />
    </main>
  `,
})
export class App {
  protected readonly session = inject(SessionService);
  private readonly api = inject(ApiService);

  constructor() {
    this.api
      .users()
      .pipe(takeUntilDestroyed())
      .subscribe({ next: (users) => this.session.users.set(users), error: () => {} });
  }

  protected pickUser(value: string) {
    this.session.select(Number(value), this.session.supervisor());
  }

  protected pickSupervisor(checked: boolean) {
    this.session.select(this.session.userId(), checked);
  }
}
