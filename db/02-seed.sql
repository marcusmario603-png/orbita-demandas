SET NAMES utf8mb4;
-- Dados de exemplo: 5 usuários e 5 mil demandas (portátil: MySQL 8 e MariaDB).

INSERT IGNORE INTO app_user (id, name) VALUES
  (1, 'Ana Souza'), (2, 'Bruno Lima'), (3, 'Carla Mendes'),
  (4, 'Diego Alves'), (5, 'Elisa Rocha');

INSERT INTO demand (title, queue, status, worker_id, outcome, failure_reason, note, updated_at)
SELECT
  CONCAT('Demanda #', n, ' - ', ELT(1 + n % 4, 'Falha de sinal', 'Troca de plano', 'Viabilidade de endereço', 'Segunda via de fatura')),
  ELT(1 + n % 5, 'cobertura', 'viabilidade', 'suporte', 'vendas', 'cancelamento'),
  CASE WHEN n % 10 < 7 THEN 1 WHEN n % 10 < 9 THEN 2 ELSE 3 END,
  CASE WHEN n % 10 < 7 THEN NULL ELSE 1 + n % 5 END,
  CASE WHEN n % 10 < 9 THEN NULL WHEN n % 20 = 9 THEN 'success' ELSE 'failure' END,
  CASE WHEN n % 10 = 9 AND n % 20 <> 9 THEN 'sem_cobertura' ELSE NULL END,
  NULL,
  DATE_SUB(NOW(), INTERVAL n MINUTE)
FROM (
  SELECT a.d + 10 * b.d + 100 * c.d + 1000 * e.d + 1 AS n
  FROM (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a,
       (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b,
       (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
        UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) c,
       (SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) e
) nums
WHERE n <= 5000
ORDER BY n;

INSERT INTO demand_trace (demand_id, user_id, action, note)
SELECT id, worker_id, 'reserve', 'Reservado para tratamento' FROM demand WHERE worker_id IS NOT NULL;
INSERT INTO demand_trace (demand_id, user_id, action, note)
SELECT id, worker_id, 'finish', CONCAT('Encerrada (', outcome, ')') FROM demand WHERE status = 3;
