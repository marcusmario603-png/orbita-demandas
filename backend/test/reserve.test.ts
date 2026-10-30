import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCtx, operator } from './helpers.js';
import type { TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(async () => {
  await ctx.close();
});

const reserve = (id: number, headers: Record<string, string>) =>
  ctx.app.inject({ method: 'POST', url: `/demands/${id}/reserve`, headers });

describe('POST /demands/:id/reserve', () => {
  it('duas reservas simultâneas da mesma demanda: um 200 e um 409 com o nome de quem ficou', async () => {
    const id = await ctx.createDemand();

    const [a, b] = await Promise.all([reserve(id, operator(1)), reserve(id, operator(2))]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const winnerRes = a.statusCode === 200 ? a : b;
    const loserRes = a.statusCode === 200 ? b : a;
    const winnerId = winnerRes === a ? 1 : 2;
    const winnerName = winnerId === 1 ? 'Ana Souza' : 'Bruno Lima';

    expect(winnerRes.json().demand.workerId).toBe(winnerId);
    expect(loserRes.json().message).toContain(winnerName);
    expect(loserRes.json().reservedBy).toEqual({ id: winnerId, name: winnerName });
    expect(loserRes.json().demand.workerId).toBe(winnerId); // o front atualiza a linha com isto

    // estado final e histórico: uma única reserva
    expect((await ctx.row(id)).worker_id).toBe(winnerId);
    expect(await ctx.traces(id)).toEqual([{ action: 'reserve', user_id: winnerId }]);
  });

  it('com 25 usuários disputando ao mesmo tempo, exatamente um vence', async () => {
    const id = await ctx.createDemand();
    const users = Array.from({ length: 25 }, (_, i) => i + 1);

    const responses = await Promise.all(users.map((u) => reserve(id, operator(u))));

    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(24);
    expect(await ctx.traces(id)).toHaveLength(1);
  });

  it('o mesmo usuário reservando de novo recebe sucesso, sem duplicar o histórico', async () => {
    const id = await ctx.createDemand();

    const first = await reserve(id, operator(3));
    const second = await reserve(id, operator(3));

    expect(first.statusCode).toBe(200);
    expect(first.json().alreadyReserved).toBe(false);
    expect(second.statusCode).toBe(200);
    expect(second.json().alreadyReserved).toBe(true);
    expect(await ctx.traces(id)).toHaveLength(1);
  });

  it('o mesmo usuário em duas abas simultâneas: ambas dão sucesso e só uma reserva é gravada', async () => {
    const id = await ctx.createDemand();

    const results = await Promise.all([reserve(id, operator(4)), reserve(id, operator(4))]);

    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await ctx.traces(id)).toHaveLength(1);
  });

  it('demanda encerrada devolve 409 e não é reservada', async () => {
    const id = await ctx.createDemand({ status: 3, workerId: 1 });

    const res = await reserve(id, operator(2));

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('demand_closed');
    expect(await ctx.traces(id)).toHaveLength(0);
  });

  it('demanda inexistente devolve 404', async () => {
    const res = await reserve(999_999_999, operator(1));
    expect(res.statusCode).toBe(404);
  });

  it('sem x-user-id devolve 401; id inválido devolve 400', async () => {
    const id = await ctx.createDemand();
    expect((await reserve(id, {})).statusCode).toBe(401);
    expect((await reserve('abc' as unknown as number, operator(1))).statusCode).toBe(400);
  });
});
