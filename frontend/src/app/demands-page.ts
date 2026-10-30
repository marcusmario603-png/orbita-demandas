import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { EMPTY, Subject, catchError, finalize, switchMap, tap } from 'rxjs';
import { ApiService } from './api.service';
import { FinishDialog } from './finish-dialog';
import { QUEUES, STATUS_LABEL } from './models';
import type { Demand, ListFilters } from './models';
import { SessionService } from './session.service';

type Notice = { kind: 'success' | 'error' | 'info'; text: string };

@Component({
  selector: 'app-demands-page',
  imports: [ReactiveFormsModule, FinishDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="filters" [formGroup]="filters" aria-label="Filtros da fila">
      <div class="field">
        <label for="f-queue">Fila</label>
        <select id="f-queue" formControlName="queue">
          <option value="">Todas</option>
          @for (q of queues; track q) {
            <option [value]="q">{{ q }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="f-status">Status</label>
        <select id="f-status" formControlName="status">
          <option value="">Todos</option>
          <option value="1">Aberta</option>
          <option value="2">Reservada</option>
          <option value="3">Encerrada</option>
        </select>
      </div>
      <div class="field">
        <label for="f-sort">Ordenar por</label>
        <select id="f-sort" formControlName="sort">
          <option value="id">Número</option>
          <option value="updated_at">Última atualização</option>
        </select>
      </div>
      <div class="field">
        <label for="f-order">Sentido</label>
        <select id="f-order" formControlName="order">
          <option value="asc">Crescente</option>
          <option value="desc">Decrescente</option>
        </select>
      </div>
    </form>

    <div class="notice-slot" aria-live="polite">
      @if (notice(); as n) {
        <p class="alert" [class.error]="n.kind === 'error'" [class.success]="n.kind === 'success'">
          {{ n.text }}
        </p>
      }
    </div>

    @if (loadError(); as message) {
      <p class="alert error" role="alert">
        {{ message }}
        <button type="button" class="btn small" (click)="reload()">Tentar de novo</button>
      </p>
    }

    <div class="table-wrap" [attr.aria-busy]="loading()">
      <table>
        <caption class="sr-only">Demandas</caption>
        <thead>
          <tr>
            <th scope="col">Nº</th>
            <th scope="col">Demanda</th>
            <th scope="col">Fila</th>
            <th scope="col">Status</th>
            <th scope="col">Responsável</th>
            <th scope="col"><span class="sr-only">Ação</span></th>
          </tr>
        </thead>
        <tbody>
          @for (d of items(); track d.id) {
            <tr [class]="'row status-' + d.status">
              <td class="num" data-label="Nº">{{ d.id }}</td>
              <td data-label="Demanda">{{ d.title }}</td>
              <td data-label="Fila">{{ d.queue }}</td>
              <td data-label="Status">
                <span class="badge" [class]="'badge status-' + d.status">{{ statusLabel[d.status] }}</span>
                @if (d.status === 3 && d.outcome) {
                  <span class="muted outcome">{{ d.outcome === 'success' ? 'com sucesso' : 'sem sucesso' }}</span>
                }
              </td>
              <td data-label="Responsável">{{ d.workerName ?? '—' }}</td>
              <td class="act">
                @if (d.status === 1) {
                  <button type="button" class="btn primary small" [disabled]="isBusy(d.id)" (click)="reserve(d)">
                    {{ isBusy(d.id) ? 'Reservando…' : 'Reservar' }}
                    <span class="sr-only"> demanda {{ d.id }}</span>
                  </button>
                } @else if (d.status === 2 && canFinish(d)) {
                  <button type="button" class="btn small" (click)="finishing.set(d)">
                    Encerrar<span class="sr-only"> demanda {{ d.id }}</span>
                  </button>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6" class="empty">
                {{ loading() ? 'Carregando demandas…' : 'Nenhuma demanda com esses filtros. Limpe um filtro para ver mais.' }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <nav class="pager" aria-label="Paginação">
      <p>{{ rangeText() }}</p>
      <div class="pager-buttons">
        <button type="button" class="btn small" [disabled]="page() <= 1 || loading()" (click)="go(page() - 1)">
          Anterior
        </button>
        <span>Página {{ page() }} de {{ pageCount() }}</span>
        <button
          type="button"
          class="btn small"
          [disabled]="page() >= pageCount() || loading()"
          (click)="go(page() + 1)"
        >
          Próxima
        </button>
      </div>
    </nav>

    @if (finishing(); as demand) {
      <app-finish-dialog
        [demand]="demand"
        (finished)="onFinished($event)"
        (conflict)="onConflict($event)"
        (dismiss)="finishing.set(null)"
      />
    }
  `,
})
export class DemandsPage {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly queues = QUEUES;
  protected readonly statusLabel = STATUS_LABEL;

  protected readonly filters = this.fb.group({
    queue: [''],
    status: [''],
    sort: ['id' as ListFilters['sort']],
    order: ['asc' as ListFilters['order']],
  });

  protected readonly items = signal<Demand[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = 20;
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly notice = signal<Notice | null>(null);
  protected readonly finishing = signal<Demand | null>(null);
  private readonly busy = signal<ReadonlySet<number>>(new Set());

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));
  protected readonly rangeText = computed(() => {
    const total = this.total();
    if (!total) return '0 demandas';
    const from = (this.page() - 1) * this.pageSize + 1;
    return `${from}–${Math.min(total, from + this.pageSize - 1)} de ${total} demandas`;
  });

  /** Todo motivo para buscar (filtro, página, recarregar, carga inicial) passa por aqui. */
  private readonly fetch$ = new Subject<void>();

  constructor() {
    // switchMap cancela a requisição anterior quando chega uma nova.
    this.fetch$
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadError.set(null);
        }),
        switchMap(() =>
          this.api.list(this.currentFilters()).pipe(
            catchError(() => {
              this.loadError.set('Não foi possível carregar as demandas.');
              return EMPTY;
            }),
            finalize(() => this.loading.set(false)),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        this.items.set(res.items);
        this.total.set(res.total);
      });

    // Mudou filtro/ordem → volta para a página 1 e busca.
    this.filters.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.page.set(1);
      this.fetch$.next();
    });

    this.fetch$.next(); // carga inicial
  }

  private currentFilters(): ListFilters {
    return { ...this.filters.getRawValue(), page: this.page(), pageSize: this.pageSize };
  }

  protected reload() {
    this.fetch$.next();
  }

  protected go(page: number) {
    this.page.set(page);
    this.fetch$.next();
  }

  protected isBusy(id: number) {
    return this.busy().has(id);
  }

  protected canFinish(d: Demand) {
    return d.workerId === this.session.userId() || this.session.supervisor();
  }

  protected reserve(d: Demand) {
    this.setBusy(d.id, true);
    this.api
      .reserve(d.id)
      .pipe(finalize(() => this.setBusy(d.id, false)))
      .subscribe({
        next: ({ demand, alreadyReserved }) => {
          this.replace(demand);
          this.notice.set({
            kind: 'success',
            text: alreadyReserved
              ? `Você já tinha reservado a demanda #${demand.id}.`
              : `Demanda #${demand.id} reservada para você.`,
          });
        },
        error: (err: HttpErrorResponse) => {
          const body = err.error as { message?: string; demand?: Demand } | null;
          // 409: mostra quem ficou com a demanda e atualiza só esta linha, sem recarregar a página.
          if (body?.demand) this.replace(body.demand);
          this.notice.set({
            kind: 'error',
            text: body?.message ?? 'Não foi possível reservar. Tente novamente.',
          });
        },
      });
  }

  protected onFinished(demand: Demand) {
    this.replace(demand);
    this.finishing.set(null);
    this.notice.set({ kind: 'success', text: `Demanda #${demand.id} encerrada.` });
  }

  protected onConflict({ demand, message }: { demand: Demand; message: string }) {
    this.replace(demand);
    this.finishing.set(null);
    this.notice.set({ kind: 'error', text: message });
  }

  private replace(demand: Demand) {
    this.items.update((list) => list.map((d) => (d.id === demand.id ? demand : d)));
  }

  private setBusy(id: number, on: boolean) {
    this.busy.update((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
