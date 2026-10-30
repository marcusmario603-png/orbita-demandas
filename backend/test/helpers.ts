import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';

export type TestCtx = Awaited<ReturnType<typeof createCtx>>;

try {
  process.loadEnvFile?.();
} catch {
  /* sem .env */
}

export const operator = (id: number) => ({ 'x-user-id': String(id), 'x-scopes': 'demands' });
export const supervisor = (id: number) => ({
  'x-user-id': String(id),
  'x-scopes': 'demands,demands:supervise',
});

export async function createCtx() {
  const pool: Pool = createPool();
  const app = await buildApp(pool);
  const createdIds: number[] = [];

  /** Cria uma demanda de teste isolada (fila própria) para não interferir na base de exemplo. */
  async function createDemand(overrides: { status?: number; workerId?: number | null; queue?: string } = {}) {
    const [res] = await pool.execute<ResultSetHeader>(
      'INSERT INTO demand (title, queue, status, worker_id) VALUES (?, ?, ?, ?)',
      ['Demanda de teste', overrides.queue ?? 'qa-testes', overrides.status ?? 1, overrides.workerId ?? null],
    );
    createdIds.push(res.insertId);
    return res.insertId;
  }

  async function traces(demandId: number) {
    const [rows] = await pool.execute<any[]>(
      'SELECT action, user_id FROM demand_trace WHERE demand_id = ? ORDER BY id',
      [demandId],
    );
    return rows as { action: string; user_id: number }[];
  }

  async function row(demandId: number) {
    const [rows] = await pool.execute<any[]>('SELECT * FROM demand WHERE id = ?', [demandId]);
    return rows[0];
  }

  async function close() {
    if (createdIds.length) {
      const marks = createdIds.map(() => '?').join(',');
      await pool.execute(`DELETE FROM demand_trace WHERE demand_id IN (${marks})`, createdIds);
      await pool.execute(`DELETE FROM demand WHERE id IN (${marks})`, createdIds);
    }
    await app.close();
    await pool.end();
  }

  return { pool, app, createDemand, traces, row, close };
}
