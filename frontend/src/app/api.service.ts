import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Demand, DemandPage, FinishPayload, ListFilters, ReserveResult, User } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  users() {
    return this.http.get<User[]>(`${this.base}/users`);
  }

  list(f: ListFilters) {
    let params = new HttpParams()
      .set('page', f.page)
      .set('pageSize', f.pageSize)
      .set('sort', f.sort)
      .set('order', f.order);
    if (f.queue) params = params.set('queue', f.queue);
    if (f.status) params = params.set('status', f.status);
    return this.http.get<DemandPage>(`${this.base}/demands`, { params });
  }

  reserve(id: number) {
    return this.http.post<ReserveResult>(`${this.base}/demands/${id}/reserve`, {});
  }

  finish(id: number, body: FinishPayload) {
    return this.http.post<Demand>(`${this.base}/demands/${id}/finish`, body);
  }
}
