import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { finishDemand, listDemands, listUsers, reserveDemand } from './demands.service.js';
import { HttpError } from './errors.js';
import {
  DemandListSchema,
  DemandParamsSchema,
  DemandSchema,
  FinishBodySchema,
  ListQuerySchema,
  ReserveResultSchema,
  UserSchema,
} from './schemas.js';

export type Auth = { userId: number; scopes: ReadonlySet<string> };

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth;
  }
}

/** Autenticação simplificada do desafio: x-user-id e x-scopes (separados por vírgula). */
async function authenticate(req: FastifyRequest): Promise<void> {
  const raw = req.headers['x-user-id'];
  const userId = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new HttpError(401, 'unauthorized', 'Header x-user-id ausente ou inválido');
  }
  const scopesHeader = req.headers['x-scopes'];
  const scopes = new Set(
    String(Array.isArray(scopesHeader) ? scopesHeader.join(',') : (scopesHeader ?? ''))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  req.auth = { userId, scopes };
}

export async function buildApp(pool: Pool, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: true, allowedHeaders: ['content-type', 'x-user-id', 'x-scopes'] });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply
        .code(err.statusCode)
        .send({ error: err.code, message: err.message, ...err.extra });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Requisição inválida',
        issues: err.validation.map((v) => ({
          path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
          message: v.message,
        })),
      });
    }
    if (isResponseSerializationError(err)) {
      app.log.error(err);
      return reply.code(500).send({ error: 'internal_error', message: 'Erro interno' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'internal_error', message: 'Erro interno' });
  });

  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/health', async () => ({ ok: true }));

  r.get(
    '/users',
    { onRequest: authenticate, schema: { response: { 200: z.array(UserSchema) } } },
    async () => listUsers(pool),
  );

  r.get(
    '/demands',
    { onRequest: authenticate, schema: { querystring: ListQuerySchema, response: { 200: DemandListSchema } } },
    async (req) => listDemands(pool, req.query),
  );

  r.post(
    '/demands/:id/reserve',
    { onRequest: authenticate, schema: { params: DemandParamsSchema, response: { 200: ReserveResultSchema } } },
    async (req) => reserveDemand(pool, req.auth.userId, req.params.id),
  );

  r.post(
    '/demands/:id/finish',
    {
      onRequest: authenticate,
      schema: { params: DemandParamsSchema, body: FinishBodySchema, response: { 200: DemandSchema } },
    },
    async (req) => finishDemand(pool, req.auth, req.params.id, req.body),
  );

  return app;
}
