// errors.js — Manejo de errores centralizado.
// En vez de try/catch repetido en cada endpoint, los handlers usan
// asyncHandler() y lanzan AppError para errores de negocio esperados
// (400/403/404/etc). Cualquier otro error cae al catch-all como 500.

class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Envuelve un handler async para que sus rechazos lleguen a next(err) automáticamente. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Middleware de error — debe registrarse al FINAL, después de todas las rutas. */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  // Violación de restricción única de Postgres, no capturada explícitamente por el handler
  if (err.code === '23505') {
    return res.status(400).json({ error: 'El registro ya existe (violación de restricción única)' });
  }
  // Violación de llave foránea
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referencia inválida: el registro relacionado no existe' });
  }
  console.error('[error no controlado]', err);
  res.status(500).json({ error: 'Error interno del servidor' });
}

module.exports = { AppError, asyncHandler, errorHandler };
