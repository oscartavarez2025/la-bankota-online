// schemas.js — Validación de entrada centralizada con zod.
// Cada endpoint valida su body/params/query contra un esquema explícito en
// vez de "if (!campo) return res.status(400)..." repetido y fácil de olvidar.
const { z } = require('zod');
const { AppError } = require('./errors');

const numeroLoteria = z.string().regex(/^[0-9]{2}$/, 'Debe ser dos dígitos, 00-99');
const uuid = z.string().uuid('Debe ser un identificador válido');
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');
const hora = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato de hora esperado: HH:MM');
const posicion = z.enum(['1ra', '2da', '3ra', '1-2', '1-3', '2-3', '2', '3']).nullable().optional();
const tipoJugada = z.enum(['quiniela', 'pale', 'tripleta', 'superpale']);
const rolTenant = z.enum(['admin_empresa', 'admin_sucursal', 'vendedor']);

const schemas = {
  loginTenant: z.object({
    codigoEmpresa: z.string().min(1),
    usuario: z.string().min(1),
    password: z.string().min(1),
  }),
  loginPlatform: z.object({
    usuario: z.string().min(1),
    password: z.string().min(1),
  }),
  crearEmpresa: z.object({
    codigo: z.string().regex(/^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/, 'Minúsculas, números y guiones; 4-50 caracteres'),
    nombreComercial: z.string().min(1),
    razonSocial: z.string().optional(),
    rnc: z.string().optional(),
    adminNombre: z.string().min(1),
    adminUsuario: z.string().min(1),
    adminPassword: z.string().min(8, 'Mínimo 8 caracteres'),
  }),
  crearLoteriaCatalogo: z.object({
    nombre: z.string().min(1),
    pais: z.string().optional(),
  }),
  resultadoOficial: z.object({
    loteriaCatalogoId: uuid,
    fecha,
    horaSorteo: hora,
    num1: numeroLoteria,
    num2: numeroLoteria,
    num3: numeroLoteria,
  }),
  crearSucursal: z.object({
    nombre: z.string().min(1),
    codigo: z.string().min(1),
    direccion: z.string().optional(),
  }),
  activarLoteria: z.object({
    loteriaCatalogoId: uuid.optional(),
    nombrePersonalizado: z.string().min(1).optional(),
  }).refine(d => d.loteriaCatalogoId || d.nombrePersonalizado, {
    message: 'Debe indicar loteriaCatalogoId o nombrePersonalizado',
  }),
  crearSorteo: z.object({
    empresaLoteriaId: uuid,
    nombre: z.string().min(1),
    hora,
    horaCierre: hora.optional(), // hora límite para vender; si no se indica, se usa la hora del sorteo
  }),
  pago: z.object({
    tipoJugada,
    posicion,
    multiplicador: z.number().positive(),
    sucursalId: uuid.optional(),
  }),
  crearJugada: z.object({
    sorteo_id: uuid,
    sorteo_id_b: uuid.optional(),
    tipo_jugada: tipoJugada,
    numeros: z.array(z.string()).min(1).max(3),
    posicion,
    monto: z.number().positive(),
    fecha_sorteo: fecha.optional(),
    sucursal_id: uuid.optional(),
  }),
  cargarResultado: z.object({
    sorteo_id: uuid,
    fecha,
    num1: numeroLoteria,
    num2: numeroLoteria,
    num3: numeroLoteria,
  }),
  cerrarCaja: z.object({
    fecha: fecha.optional(),
    vendedor_id: uuid.optional(),
  }),
  crearUsuario: z.object({
    nombre: z.string().min(1),
    usuario: z.string().min(3),
    password: z.string().min(8, 'Mínimo 8 caracteres'),
    rol: rolTenant,
    sucursal_id: uuid.optional(),
  }),
  estadoUsuario: z.object({
    activo: z.boolean(),
  }),
  idParam: z.object({ id: uuid }),
  verificarParams: z.object({ codigoEmpresa: z.string().min(1), folio: z.string().min(1) }),
};

/** Middleware: valida req[source] contra un esquema; si pasa, reemplaza req[source] con los datos ya parseados/coeridos. */
function validate(schemaName, source = 'body') {
  const schema = schemas[schemaName];
  if (!schema) throw new Error(`Esquema de validación no encontrado: ${schemaName}`);
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new AppError(400, 'Datos de entrada inválidos', result.error.flatten()));
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { schemas, validate };
