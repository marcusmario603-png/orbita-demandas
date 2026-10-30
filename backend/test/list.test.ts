import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCtx, operator } from './helpers.js';
import type { TestCtx } from './helpers.js';

let ctx: TestCtx;
const QUEUE = 'qa-lista';

beforeAll(async () => {
  ctx = await createCtx();
  // 25 demandas na fila de teste: 15 abertas, 6 reservadas, 4 encerradas
  for (let i = 0; i < 15; i++) await ctx.createDemand({ queue: QUEUE, status: 1 });
  for (let i = 0; i < 6; i++) await ctx.createDemand({ queue: QUEUE, status: 2, workerId: 1 });
  for (let i = 0; i < 4; i++) await ctx.createDemand({ queue: QUEUE, status: 3, workerId: 2 });
});
afterAll(async () => {
  await ctx.close();
});

const get = (url: string) => ctx.app.inject({ method: 'GET', url, headers: operator(1) });

describe('GET /demands', () => {
  it('pagina no servidor e devolve o total', async () => {
    const p1 = (await get(`/demands?queue=${QUEUE}&pageSize=10&page=1`)).json();
    const p3 = (await get(`/demands?queue=${QUEUE}&pageSize=10&page=3`)).json();

    expect(p1.total).toBe(25);
    expect(p1.items).toHaveLength(10);
    expect(p3.items).toHaveLength(5);
    expect(p3).toMatchObject({ page: 3, pageSize: 10, total: 25 });
  });

  it('filtra por fila e status; o total acompanha o filtro', async () => {
    const res = (await get(`/demands?queue=${QUEUE}&status=2`)).json();

    expect(res.total).toBe(6);
    expect(res.items.every((d: any) => d.status === 2 && d.queue === QUEUE)).toBe(true);
    expect(res.items[0].workerName).toBe('Ana Souza');
  });

  it('ordena por id e por updated_at, asc e desc', async () => {
    const asc = (await get(`/demands?queue=${QUEUE}&sort=id&order=asc&pageSize=100`)).json().items;
    const desc = (await get(`/demands?queue=${QUEUE}&sort=id&order=desc&pageSize=100`)).json().items;
    expect(asc.map((d: any) => d.id)).toEqual(desc.map((d: any) => d.id).reverse());
    expect(asc[0].id).toBeLessThan(asc[1].id);

    const byDate = (await get(`/demands?queue=${QUEUE}&sort=updated_at&order=desc&pageSize=100`)).json().items;
    const dates = byDate.map((d: any) => d.updatedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('campo de filtro ou ordenação desconhecido devolve 400', async () => {
    for (const url of [
      '/demands?foo=1',
      '/demands?sort=title',
      '/demands?order=sideways',
      '/demands?status=9',
      '/demands?page=0',
      '/demands?pageSize=1000',
      "/demands?sort=id;DROP TABLE demand",
    ]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error).toBe('validation_error');
    }
  });

  it('sem autenticação devolve 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/demands' });
    expect(res.statusCode).toBe(401);
  });
});
