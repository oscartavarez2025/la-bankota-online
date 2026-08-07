// auth.js — Emisión/verificación de JWT y middlewares de autorización.
//
// Hay DOS tipos de identidad, que nunca se mezclan:
//   - "tenant": un usuario de una banca (admin_empresa, admin_sucursal, vendedor)
//   - "plataforma": staff nuestro (super_admin, soporte), sin empresa_id
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 20) {
  console.error(
    '\n[ERROR FATAL] JWT_SECRET no está definido (o es demasiado corto).\n' +
    'Copia .env.example a .env y define uno fuerte:\n' +
    'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

function signTenantToken({ usuarioId, empresaId, sucursalId, rol, nombre }) {
  return jwt.sign(
    { tipo: 'tenant', usuarioId, empresaId, sucursalId, rol, nombre },
    SECRET,
    { expiresIn: '12h' }
  );
}

function signPlatformToken({ staffId, rol, nombre }) {
  return jwt.sign(
    { tipo: 'plataforma', staffId, rol, nombre },
    SECRET,
    { expiresIn: '8h' } // sesiones de plataforma más cortas: acceso muy privilegiado
  );
}

/** Middleware: exige un token de TENANT, opcionalmente restringido a ciertos roles. */
function authTenant(rolesPermitidos) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'Token requerido' });
    try {
      const payload = jwt.verify(header.replace('Bearer ', ''), SECRET);
      if (payload.tipo !== 'tenant') {
        return res.status(403).json({ error: 'Token no válido para esta operación' });
      }
      if (rolesPermitidos && !rolesPermitidos.includes(payload.rol)) {
        return res.status(403).json({ error: 'No tiene permiso para esta acción' });
      }
      req.tenant = {
        usuarioId: payload.usuarioId,
        empresaId: payload.empresaId,
        sucursalId: payload.sucursalId,
        rol: payload.rol,
        nombre: payload.nombre,
      };
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  };
}

/** Middleware: exige un token de PLATAFORMA (nuestro staff), no de una empresa cliente. */
function authPlatform(rolesPermitidos) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'Token requerido' });
    try {
      const payload = jwt.verify(header.replace('Bearer ', ''), SECRET);
      if (payload.tipo !== 'plataforma') {
        return res.status(403).json({ error: 'Token no válido para esta operación' });
      }
      if (rolesPermitidos && !rolesPermitidos.includes(payload.rol)) {
        return res.status(403).json({ error: 'No tiene permiso para esta acción' });
      }
      req.plataforma = { staffId: payload.staffId, rol: payload.rol, nombre: payload.nombre };
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  };
}

module.exports = { signTenantToken, signPlatformToken, authTenant, authPlatform };
