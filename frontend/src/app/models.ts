export type Outcome = 'success' | 'failure';

export interface Demand {
  id: number;
  title: string;
  queue: string;
  status: 1 | 2 | 3;
  workerId: number | null;
  workerName: string | null;
  outcome: Outcome | null;
  failureReason: string | null;
  note: string | null;
  updatedAt: string;
}

export interface DemandPage {
  items: Demand[];
  total: number;
  page: number;
  pageSize: number;
}

export interface User {
  id: number;
  name: string;
}

export interface ReserveResult {
  demand: Demand;
  alreadyReserved: boolean;
}

export interface FinishPayload {
  outcome: Outcome;
  failureReason?: string;
  note?: string;
}

export interface ListFilters {
  queue: string;
  status: string;
  sort: 'id' | 'updated_at';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export const STATUS_LABEL: Record<number, string> = {
  1: 'Aberta',
  2: 'Reservada',
  3: 'Encerrada',
};

export const QUEUES = ['cobertura', 'viabilidade', 'suporte', 'vendas', 'cancelamento'];

export const FAILURE_REASONS: { value: string; label: string }[] = [
  { value: 'sem_cobertura', label: 'Sem cobertura no endereço' },
  { value: 'cliente_ausente', label: 'Cliente não atendeu' },
  { value: 'dados_incorretos', label: 'Dados incorretos' },
  { value: 'duplicada', label: 'Demanda duplicada' },
  { value: 'outro', label: 'Outro' },
];
