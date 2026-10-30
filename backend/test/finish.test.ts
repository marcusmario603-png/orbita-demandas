import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCtx, operator, supervisor } from './helpers.js';
import type { TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createCtx();
});
afterAll(async () => {
  await ctx.close();
});

const finish = (id: number, headers: Record<string, string>, payload: unknown) =>
  ctx.app.inject({ method: 'POST', url: `/demands/${id}/finish`, headers, payload: payload as object });

describe('POST /demands/:id/finish', () => {
  it('o dono encerra com sucesso e o trace é gravado', async () => {
    const id = await ctx.createDemand({ status: 2, workerId: 1 });

    const res = await finish(id, operator(1), { outcome: 'success', note: '  tudo certo  ' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 3, outcome: 'success', failureReason: null, note: 'tudo certo' });
    expect(await ctx.traces(id)).toEqual([{ action: 'finish', user_id: 1 }]);
  });

  it('insucesso exige failureReason (400) e aceita quando informado', async () => {
    const id = await ctx.createDemand({ status: 2, workerId: 1 });

    const bad = await finish(id, operator(1), { outcome: 'failure' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().issues[0].path).toBe('failureReason');
    expect((await ctx.row(id)).status).toBe(2); // nada mudou

    const blank = await finish(id, operator(1), { outcome: 'failure', failureReason: '   ' });
    expect(blank.statusCode).toBe(400);

    const ok = await finish(id, operator(1), { outcome: 'failure', failureReason: 'sem_cobertura' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ outcome: 'failure', failureReason: 'sem_cobertura' });
  });

  it('note com mais de 500 caracteres devolve 400; com exatamente 500 passa', async () => {
    const id = await ctx.createDemand({ status: 2, workerId: 1 });

    expect((await finish(id, operator(1), { outcome: 'success', note: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await finish(id, operator(1), { outcome: 'success', note: 'x'.repeat(500) })).statusCode).toBe(200);
  });

  it('outcome inválido ou campo desconhecido devolve 400', async () => {
    const id = await ctx.createDemand({ status: 2, workerId: 1 });
    expect((await finish(id, operator(1), { outcome: 'talvez' })).statusCode).toBe(400);
    expect((await finish(id, operator(1), { outcome: 'success', extra: 1 })).statusCode).toBe(400);
  });

  it('outro operador (sem supervisão) recebe 403 e nada muda', async () => {
    const id = await ctx.createDemand({ status: 2, workerId: 1 });

    const res = await finish(id, operator(2), { outcome: 'success' });

    expect(res.statusCode).toBe(403);
    expect((await ctx.row(id)).status).toBe(2);
    expect(await ctx.traces(id)).toHaveLength(0);
  });

  it('a supervisão encerra a demanda de qualquer um e o trace registra quem encerrou', async () => {
    const id = await ctx.createDemand({ status: 2, workerId: 1 });

    const res = await finish(id, supervisor(5), { outcome: 'success' });

    expect(res.statusCode).toBe(200);
    expect(await ctx.traces(id)).toEqual([{ action: 'finish', user_id: 5 }]);
  });

  it('encerrar duas vezes devolve 409 na segunda; demanda aberta devolve 409', async () => {
    const id = await ctx.createDemand({ status: 2, workerId: 1 });
    expect((await finish(id, operator(1), { outcome: 'success' })).statusCode).toBe(200);
    const again = await finish(id, operator(1), { outcome: 'success' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('demand_closed');
    expect(await ctx.traces(id)).toHaveLength(1);

    const open = await ctx.createDemand();
    const res = await finish(open, supervisor(5), { outcome: 'success' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('not_reserved');
  });

  it('demanda inexistente devolve 404', async () => {
    expect((await finish(999_999_999, supervisor(5), { outcome: 'success' })).statusCode).toBe(404);
  });
});
