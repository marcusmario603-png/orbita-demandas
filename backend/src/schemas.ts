import { z } from 'zod';

export const DemandStatus = { Open: 1, Reserved: 2, Closed: 3 } as const;

/** Parâmetros do GET /demands. `.strict()` faz qualquer campo desconhecido virar 400. */
export const ListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    queue: z.string().trim().min(1).max(40).optional(),
    status: z.coerce.number().int().min(1).max(3).optional(),
    sort: z.enum(['id', 'updated_at']).default('id'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const DemandParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Corpo do POST /demands/:id/finish.
 * - failureReason é obrigatório no insucesso e ignorado (gravado como NULL) no sucesso.
 * - note é opcional, sem espaços nas pontas, até 500 caracteres (o trim vem antes do max).
 */
export const FinishBodySchema = z
  .object({
    outcome: z.enum(['success', 'failure']),
    failureReason: z.string().trim().max(40).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === 'failure' && !value.failureReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureReason'],
        message: 'Informe o motivo do insucesso',
      });
    }
  });
export type FinishBody = z.infer<typeof FinishBodySchema>;

export const DemandSchema = z.object({
  id: z.number(),
  title: z.string(),
  queue: z.string(),
  status: z.number(),
  workerId: z.number().nullable(),
  workerName: z.string().nullable(),
  outcome: z.enum(['success', 'failure']).nullable(),
  failureReason: z.string().nullable(),
  note: z.string().nullable(),
  updatedAt: z.string(),
});
export type Demand = z.infer<typeof DemandSchema>;

export const DemandListSchema = z.object({
  items: z.array(DemandSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const ReserveResultSchema = z.object({
  demand: DemandSchema,
  alreadyReserved: z.boolean(),
});

export const UserSchema = z.object({ id: z.number(), name: z.string() });
