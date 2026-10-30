-- Esquema fornecido pelo enunciado. IF NOT EXISTS deixa o arquivo idempotente
-- (o setup dos testes o reaplica; no docker ele roda uma vez na criação do banco).

CREATE TABLE IF NOT EXISTS app_user (
  id INT PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS demand (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  queue VARCHAR(40) NOT NULL,
  status TINYINT NOT NULL DEFAULT 1, -- 1 aberta, 2 reservada, 3 encerrada
  worker_id INT NULL,
  outcome ENUM('success','failure') NULL,
  failure_reason VARCHAR(40) NULL,
  note VARCHAR(500) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_queue_status (queue, status)
);

CREATE TABLE IF NOT EXISTS demand_trace (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demand_id INT NOT NULL,
  user_id INT NOT NULL,
  action VARCHAR(20) NOT NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
