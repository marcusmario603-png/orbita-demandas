import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { configFromEnv } from '../src/db.js';

/**
 * Garante que o esquema e os usuários existam (idempotente). Se o banco já foi criado
 * pelo docker-compose, não muda nada; se estiver vazio, cria as tabelas.
 */
export default async function setup() {
  try {
    process.loadEnvFile?.();
  } catch {
    /* sem .env */
  }
  const conn = await mysql.createConnection({ ...configFromEnv(), multipleStatements: true });
  try {
    const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../db/01-schema.sql'), 'utf8');
    await conn.query(schema);
    await conn.query(
      `INSERT IGNORE INTO app_user (id, name) VALUES
        (1,'Ana Souza'),(2,'Bruno Lima'),(3,'Carla Mendes'),(4,'Diego Alves'),(5,'Elisa Rocha')`,
    );
  } finally {
    await conn.end();
  }
}
