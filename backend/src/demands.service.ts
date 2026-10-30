import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { HttpError } from './errors.js';
import { DemandStatus } from './schemas.js';
import type { Demand, FinishBody, ListQuery } from './schemas.js';

/* Só colunas desta lista entram no ORDER BY: o valor vem do enum do Zod, mas a
   whitelist garante que nunca haverá interpolação de texto do usuário no SQL. */
const SORT_COLUMNS = { id: 'd.id', updated_at: 'd.updated_at' } as const;

const SELECT_DEMAND = `
  SELECT d.id, d.title, d.queue, d.status, d.worker_id, u.name AS worker_name,
         d.outcome, d.failure_reason, d.note, d.updated_at
    FROM demand d
    LEFT JOIN app_user u ON u.id = d.worker_id`;

type Queryable = Pick<PoolConnection, 'execute' | 'query'>;

function toDemand(row: RowDataPacket): Demand {
  return {
    id: row.id,
    title: row.title,
    queue: row.queue,
    status: row.status,
    workerId: row.worker_id,
    workerName: row.worker_name,
    outcome: row.outcome,
    failureReason: row.failure_reason,
    note: row.note,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function fetchDemand(db: Queryable, id: number): Promise<Demand | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`${SELECT_DEMAND} WHERE d.id = ?`, [id]);
  return rows[0] ? toDemand(rows[0]) : null;
}

export async function listDemands(pool: Pool, q: ListQuery) {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (q.queue !== undefined) {
    conditions.push('d.queue = ?');
    params.push(q.queue);
  }
  if (q.status !== undefined) {
    conditions.push('d.status = ?');
    params.push(q.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const direction = q.order === 'desc' ? 'DESC' : 'ASC';
  const orderBy = `ORDER BY ${SORT_COLUMNS[q.sort]} ${direction}, d.id ${direction}`;
  const offset = (q.page - 1) * q.pageSize;

  const [[countRow], [rows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM demand d ${where}`, params),
    // LIMIT/OFFSET com prepared statement é frágil no MySQL 8; query() faz o escape no cliente.
    pool.query<RowDataPacket[]>(`${SELECT_DEMAND} ${where} ${orderBy} LIMIT ? OFFSET ?`, [
      ...params,
      q.pageSize,
      offset,
    ]),
  ]);

  return {
    items: rows.map(toDemand),
    total: Number(countRow[0]?.total ?? 0),
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function listUsers(pool: Pool) {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT id, name FROM app_user ORDER BY id');
  return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
}

/** Executa `fn` numa transação curta: commit se resolver, rollback se lançar. */
async function inTransaction<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* a conexão pode já ter caído; o erro original é o que importa */
    }
    throw err;
  } finally {
    conn.release();
  }
}

export type ReserveResult = { demand: Demand; alreadyReserved: boolean };

/** Sinaliza "UPDATE não afetou a linha": faz a transação dar rollback em vez de commit vazio. */
class LostRace extends Error {}

/**
 * Reserva atômica por UPDATE condicional.
 *
 * A condição `status = 1 AND worker_id IS NULL` no próprio UPDATE é o que decide a corrida:
 * o InnoDB serializa os dois UPDATEs na linha; o segundo, ao ganhar o lock, reavalia o WHERE
 * contra o dado já commitado e afeta 0 linhas. Não há SELECT-depois-UPDATE (que era o bug),
 * e o lock da linha dura só o tempo desta transação curta, nunca enquanto o usuário "pensa".
 */
export async function reserveDemand(
  pool: Pool,
  userId: number,
  demandId: number,
): Promise<ReserveResult> {
  try {
    return await inTransaction<ReserveResult>(pool, async (conn) => {
      const [update] = await conn.execute<ResultSetHeader>(
        `UPDATE demand SET worker_id = ?, status = ${DemandStatus.Reserved}
          WHERE id = ? AND status = ${DemandStatus.Open} AND worker_id IS NULL`,
        [userId, demandId],
      );
      if (update.affectedRows !== 1) throw new LostRace();

      await conn.execute(
        'INSERT INTO demand_trace (demand_id, user_id, action, note) VALUES (?, ?, ?, ?)',
        [demandId, userId, 'reserve', 'Reservado para tratamento'],
      );
      return { demand: (await fetchDemand(conn, demandId))!, alreadyReserved: false };
    });
  } catch (err) {
    if (!(err instanceof LostRace)) throw err;
  }

  // Perdeu (ou a demanda não existe / já é sua): lê o estado atual, já fora da transação.
  const current = await fetchDemand(pool, demandId);
  if (!current) {
    throw new HttpError(404, 'not_found', 'Demanda não encontrada');
  }
  if (current.status === DemandStatus.Reserved && current.workerId === userId) {
    return { demand: current, alreadyReserved: true }; // mesmo usuário: idempotente
  }
  if (current.status === DemandStatus.Closed) {
    throw new HttpError(409, 'demand_closed', 'Demanda já encerrada', { demand: current });
  }
  const who = current.workerName ?? `usuário #${current.workerId}`;
  throw new HttpError(409, 'already_reserved', `Demanda já reservada por ${who}`, {
    demand: current,
    reservedBy: { id: current.workerId, name: current.workerName },
  });
}

/**
 * Encerra a demanda. A linha é travada (FOR UPDATE) só durante esta transação, para que
 * checagem de dono/estado, UPDATE e trace sejam uma unidade atômica.
 */
export async function finishDemand(
  pool: Pool,
  auth: { userId: number; scopes: ReadonlySet<string> },
  demandId: number,
  body: FinishBody,
): Promise<Demand> {
  return inTransaction(pool, async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT id, status, worker_id FROM demand WHERE id = ? FOR UPDATE',
      [demandId],
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'not_found', 'Demanda não encontrada');

    const isOwner = row.worker_id === auth.userId;
    if (!isOwner && !auth.scopes.has('demands:supervise')) {
      throw new HttpError(403, 'forbidden', 'Só o dono da reserva ou a supervisão pode encerrar');
    }
    if (row.status === DemandStatus.Closed) {
      throw new HttpError(409, 'demand_closed', 'Demanda já encerrada', {
        demand: await fetchDemand(conn, demandId),
      });
    }
    if (row.status !== DemandStatus.Reserved) {
      throw new HttpError(409, 'not_reserved', 'Reserve a demanda antes de encerrar', {
        demand: await fetchDemand(conn, demandId),
      });
    }

    const failureReason = body.outcome === 'failure' ? (body.failureReason ?? null) : null;
    const note = body.note ? body.note : null;
    await conn.execute(
      `UPDATE demand
          SET status = ${DemandStatus.Closed}, outcome = ?, failure_reason = ?, note = ?
        WHERE id = ?`,
      [body.outcome, failureReason, note, demandId],
    );
    const traceNote = `Encerrada (${body.outcome}${failureReason ? `: ${failureReason}` : ''})${
      note ? ` - ${note}` : ''
    }`.slice(0, 500);
    await conn.execute(
      'INSERT INTO demand_trace (demand_id, user_id, action, note) VALUES (?, ?, ?, ?)',
      [demandId, auth.userId, 'finish', traceNote],
    );
    return (await fetchDemand(conn, demandId))!;
  });
}
