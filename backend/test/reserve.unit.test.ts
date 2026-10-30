import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { finishDemand, reserveDemand } from '../src/demands.service.js';

/** Conexão falsa: o pool devolve sempre este objeto, e `script` decide o que cada SQL responde. */
function fakePool(script: (sql: string) => unknown) {
  const calls: string[] = [];
  const conn = {
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
    execute: vi.fn(async (sql: string) => {
      calls.push(sql);
      return script(sql);
    }),
    query: vi.fn(),
  };
  const pool = {
    getConnection: async () => conn,
    execute: conn.execute,
  } as unknown as Pool;
  return { pool, conn, calls };
}

const header = (affectedRows: number) => [{ affectedRows }];
const demandRow = (over: Record<string, unknown> = {}) => [
  [
    {
      id: 7, title: 't', queue: 'q', status: 2, worker_id: 2, worker_name: 'Bruno Lima',
      outcome: null, failure_reason: null, note: null, updated_at: new Date(0),
      ...over,
    },
  ],
];

describe('reserveDemand (conexão falsa)', () => {
  it('perdeu a corrida: 409 com o nome de quem ficou; sem trace e sem commit', async () => {
    const { pool, conn, calls } = fakePool((sql) => {
      if (sql.startsWith('UPDATE demand')) return header(0); // outra pessoa já reservou
      if (sql.includes('FROM demand d')) return demandRow({ worker_id: 2, worker_name: 'Bruno Lima' });
      throw new Error(`SQL inesperado: ${sql}`);
    });

    await expect(reserveDemand(pool, 1, 7)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('Bruno Lima'),
    });

    expect(calls.some((s) => s.includes('INSERT INTO demand_trace'))).toBe(false);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('ganhou: UPDATE condicional, trace e commit, nesta ordem', async () => {
    const { pool, conn, calls } = fakePool((sql) => {
      if (sql.startsWith('UPDATE demand')) return header(1);
      if (sql.startsWith('INSERT INTO demand_trace')) return header(1);
      if (sql.includes('FROM demand d')) return demandRow({ worker_id: 1, worker_name: 'Ana Souza' });
      throw new Error(`SQL inesperado: ${sql}`);
    });

    const result = await reserveDemand(pool, 1, 7);

    expect(result.alreadyReserved).toBe(false);
    expect(calls[0]).toMatch(/WHERE id = \? AND status = 1 AND worker_id IS NULL/);
    expect(calls[1]).toContain('INSERT INTO demand_trace');
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });
});

describe('atomicidade do encerramento', () => {
  it('se o trace falhar, o UPDATE não é confirmado (rollback, sem commit)', async () => {
    const { pool, conn } = fakePool((sql) => {
      if (sql.includes('FOR UPDATE')) return [[{ id: 7, status: 2, worker_id: 1 }]];
      if (sql.startsWith('UPDATE demand')) return header(1);
      if (sql.startsWith('INSERT INTO demand_trace')) throw new Error('disco cheio');
      throw new Error(`SQL inesperado: ${sql}`);
    });

    await expect(
      finishDemand(pool, { userId: 1, scopes: new Set() }, 7, { outcome: 'success' }),
    ).rejects.toThrow('disco cheio');

    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
});
