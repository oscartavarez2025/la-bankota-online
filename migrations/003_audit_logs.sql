-- 003_audit_logs.sql — Tabla de auditoría append-only aislada por RLS
--
-- NOTA DE TIPOS: empresas.id, sucursales.id y usuarios.id son UUID en este
-- sistema. Las FK deben coincidir; usar INT causaría un error de tipo en
-- Postgres al crear la constraint.
--
-- La política RLS castea a ::uuid para coincidir con el tipo real de la
-- columna empresa_id y con el valor de set_config que siempre es un UUID.

CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGSERIAL    PRIMARY KEY,
  empresa_id   UUID         NOT NULL REFERENCES empresas(id)   ON DELETE CASCADE,
  sucursal_id  UUID         REFERENCES sucursales(id)           ON DELETE SET NULL,
  usuario_id   UUID         REFERENCES usuarios(id)             ON DELETE SET NULL,
  accion       VARCHAR(50)  NOT NULL,
  entidad      VARCHAR(50)  NOT NULL,
  entidad_id   VARCHAR(100),
  detalles     JSONB,
  ip_address   VARCHAR(45),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índice para acelerar consultas por empresa y fecha (el caso más común)
CREATE INDEX IF NOT EXISTS idx_audit_logs_empresa_fecha
  ON audit_logs (empresa_id, created_at DESC);

-- Habilitar RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Política RLS: Aislamiento por empresa_id
-- Se castea a ::uuid para coincidir con el tipo real de la columna.
DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs;
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
  FOR ALL
  USING (
    empresa_id = NULLIF(current_setting('app.current_empresa_id', true), '')::uuid
  )
  WITH CHECK (
    empresa_id = NULLIF(current_setting('app.current_empresa_id', true), '')::uuid
  );

-- Permisos: el usuario de app puede insertar y leer (nunca UPDATE/DELETE)
GRANT INSERT, SELECT ON audit_logs TO app_banca2;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO app_banca2;
