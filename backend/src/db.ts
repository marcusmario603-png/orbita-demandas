import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

export type DbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig {
  return {
    host: env.DB_HOST ?? '127.0.0.1',
    port: Number(env.DB_PORT ?? 3306),
    user: env.DB_USER ?? 'orbita',
    password: env.DB_PASSWORD ?? 'orbita',
    database: env.DB_NAME ?? 'orbita',
  };
}

export function createPool(config: DbConfig = configFromEnv()): Pool {
  return mysql.createPool({
    ...config,
    connectionLimit: 20,
    timezone: 'Z', // DATETIME é lido/gravado como UTC, então o ISO devolvido é consistente
  });
}
