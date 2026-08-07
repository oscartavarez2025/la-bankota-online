// audit.js — Helper para registro de eventos en la Tabla de Auditoría Inmutable (Fase 8)

/**
 * Registra una acción de negocio sensible en audit_logs.
 * @param {import('pg').PoolClient | import('pg').Pool} dbClient - Conexión o pool activo
 * @param {Object} event - Datos del evento auditado
 */
async function registrarAuditoria(dbClient, { empresaId, sucursalId, usuarioId, accion, entidad, entidadId, detalles, ipAddress }) {
  if (!empresaId) return;

  const sql = `
    INSERT INTO audit_logs (empresa_id, sucursal_id, usuario_id, accion, entidad, entidad_id, detalles, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `;
  const params = [
    empresaId,
    sucursalId || null,
    usuarioId || null,
    accion,
    entidad,
    entidadId ? String(entidadId) : null,
    detalles ? JSON.stringify(detalles) : null,
    ipAddress || null,
  ];

  try {
    await dbClient.query(sql, params);
  } catch (err) {
    console.error(`[AUDIT ERROR] No se pudo registrar acción '${accion}':`, err.message);
  }
}

module.exports = { registrarAuditoria };
