import { buildApp } from './app.js';
import { createPool } from './db.js';

try {
  process.loadEnvFile?.(); // Node 20.12+: lê backend/.env se existir
} catch {
  /* sem .env: usa variáveis do ambiente / padrões */
}

const pool = createPool();
const app = await buildApp(pool, { logger: true });

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
