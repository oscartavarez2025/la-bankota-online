// logger.js — Structured logger with request ID tracing (Phase 4 Observability)
const crypto = require('crypto');

function requestLogger(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID().slice(0, 8);
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const empresaId = req.tenant?.empresaId || req.user?.empresa_id || 'anonymous';
    const logData = {
      timestamp: new Date().toISOString(),
      req_id: requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: duration,
      empresa_id: empresaId,
    };
    if (res.statusCode >= 500) {
      console.error(JSON.stringify(logData));
    } else if (res.statusCode >= 400) {
      console.warn(JSON.stringify(logData));
    } else if (process.env.NODE_ENV === 'production' || process.env.VERBOSE_LOGS === 'true') {
      console.log(JSON.stringify(logData));
    }
  });

  next();
}

module.exports = { requestLogger };
