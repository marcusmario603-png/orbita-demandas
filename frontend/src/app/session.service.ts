import { Injectable, computed, signal } from '@angular/core';
import type { User } from './models';

const KEY = 'orbita.session';

/** Quem está "logado" (simulação do desafio: vira os headers x-user-id e x-scopes). */
@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly users = signal<User[]>([]);
  readonly userId = signal(1);
  readonly supervisor = signal(false);

  readonly scopes = computed(() => (this.supervisor() ? 'demands,demands:supervise' : 'demands'));
  readonly currentUser = computed(() => this.users().find((u) => u.id === this.userId()) ?? null);

  constructor() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
      if (saved) {
        this.userId.set(Number(saved.userId) || 1);
        this.supervisor.set(!!saved.supervisor);
      }
    } catch {
      /* sessionStorage indisponível: segue com o padrão */
    }
  }

  select(userId: number, supervisor: boolean) {
    this.userId.set(userId);
    this.supervisor.set(supervisor);
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ userId, supervisor }));
    } catch {
      /* ignora */
    }
  }
}
