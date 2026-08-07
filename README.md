# LA_BANKOTA — Backend SaaS multi-tenant (PostgreSQL)

## Cómo levantarlo desde cero

```bash
cd backend-postgres
npm install
cp .env.example .env
```

Edita `.env`:
- `DATABASE_URL` apuntando a tu Postgres (local o en la nube — Railway,
  Supabase, RDS, etc. todos sirven).
- `JWT_SECRET`: genera uno con
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `SEED_SUPERADMIN_USUARIO` / `SEED_SUPERADMIN_PASSWORD`: tus credenciales
  de super_admin de plataforma (solo se usan una vez, en el seed).

Luego:

```bash
npm run migrate   # corre db-postgres/schema.sql contra tu base
npm run seed      # crea tu usuario super_admin de plataforma
npm start
```

## Flujo para dar de alta tu primera banca cliente

1. Inicia sesión como super_admin: `POST /api/plataforma/login`
2. Con ese token, crea la empresa y su primer administrador:
   `POST /api/plataforma/empresas`
   ```json
   {
     "codigo": "banca-central",
     "nombreComercial": "Banca Central SRL",
     "adminNombre": "Juan Pérez",
     "adminUsuario": "juan",
     "adminPassword": "algo-fuerte-aqui"
   }
   ```
3. Esa banca ya puede iniciar sesión en `POST /api/auth/login` con
   `{ "codigoEmpresa": "banca-central", "usuario": "juan", "password": "..." }`
4. Desde ahí, el `admin_empresa` crea sus propias sucursales
   (`POST /api/sucursales`), activa loterías del catálogo o crea las suyas
   propias (`POST /api/loterias`), define sus sorteos (`POST /api/sorteos`),
   su tabla de pagos (`PUT /api/pagos`), y da de alta a sus vendedores
   (`POST /api/usuarios`).

## Cargar resultados oficiales (tú, como super_admin)

```
POST /api/plataforma/resultados-oficiales
{ "loteriaCatalogoId": "...", "fecha": "2026-07-26", "horaSorteo": "12:30", "num1": "45", "num2": "12", "num3": "78" }
```

Esto es **compartido entre todas las empresas** que ofrezcan esa lotería del
catálogo — no cada banca lo carga por separado. Ver `db-postgres/DISEÑO-multitenant.md`
sección 4 para el porqué. Nota: cada empresa todavía debe registrar el
resultado en **su propio** `POST /api/resultados` (referenciando su `sorteo_id`)
para que se liquiden sus jugadas — la automatización completa (copiar
`resultados_oficiales` → `resultados` de cada empresa automáticamente) es un
paso pendiente, no implementado en esta versión.

## Fase 2 — Estado: cerrada

- ✅ Validación de entrada centralizada con `zod` (`schemas.js`) — cada
  endpoint valida su `body`/`params` contra un esquema explícito, ya no hay
  `if (!campo) return res.status(400)` repetido y fácil de olvidar en rutas nuevas.
- ✅ Manejo de errores centralizado (`errors.js`) — los handlers usan
  `asyncHandler()` y lanzan `AppError(status, mensaje)`; ya no hay
  `try/catch` repetido en cada endpoint, y los errores de Postgres comunes
  (violación de unicidad `23505`, llave foránea `23503`) se traducen a
  mensajes claros en un solo lugar.
- ✅ Documentación de la API (`openapi.yaml`, OpenAPI 3.0) — 19 rutas
  documentadas con sus esquemas de entrada, agrupadas por tags. Puedes
  visualizarla pegando el archivo en https://editor.swagger.io o sirviéndola
  con `swagger-ui-express` cuando quieras exponerla en el propio servidor.

## Fase 3 — Pruebas automatizadas — Estado: cerrada por completo

**Cómo correrlas:**

```bash
npm run test:unit    # reglas del juego — rápido, sin base de datos, 17 pruebas
npm run test:rls     # aislamiento multi-tenant — necesita TEST_DATABASE_URL
npm run test:e2e     # venta → resultado → premio, protege la lógica de negocio real
npm test             # las tres
```

**`test:unit`** cubre `logica.js` (validación de números, evaluación de
jugadas, cálculo de premios, formato de folios) sin tocar la base de datos
— corren en milisegundos, verificadas: 17/17 pasando.

**`test:rls`** es la prueba más importante del sistema: automatiza
exactamente la verificación manual que se hizo el 29 de julio de 2026 y que
encontró un fallo de seguridad real (ver `db-postgres/DISEÑO-multitenant.md`
sección 8). Crea dos empresas de prueba, confirma que una NUNCA puede leer
datos de la otra, y limpia todo al terminar. **Requiere `TEST_DATABASE_URL`**
apuntando a una base o rama separada de tu base de desarrollo — en Neon:
"Branches" → "Create branch". El rol de esa cadena de conexión debe tener
`NOBYPASSRLS` (igual que en producción — ver sección 11 de `schema.sql`),
o la prueba dará un falso positivo sin detectarlo. La prueba misma verifica
esto al inicio y falla fuerte si el rol conectado puede saltarse RLS.

**`test:e2e`** replica exactamente el escenario real probado a mano desde
un teléfono el 31 de julio de 2026: una venta de quiniela "cualquier
posición" que gana, y confirma que el premio se calcula con la tarifa de
la **posición donde realmente ganó** (60x para 1ra, 20x para 2da, 8x para
3ra), no con una tarifa genérica. Esta prueba existe específicamente
porque, en esa misma sesión, casi se "corrigió" por error código que en
realidad ya estaba bien — la prueba deja esa lógica de negocio protegida
para que ese error de diagnóstico no se repita nunca más, ni de mi parte
ni de quien toque este código después.

## Fase 6 — Frontend móvil (vendedor / admin_sucursal / admin_empresa) — núcleo completado

Rediseñado por completo con enfoque **mobile-first**: Óscar (super_admin)
trabaja desde PC, pero los administradores de sucursal y vendedores —la
gran mayoría de usuarios reales— trabajan desde el teléfono. Prioridad de
diseño en consecuencia.

- Navegación por pestañas inferiores (patrón estándar de apps móviles,
  más cómodo a una mano que un menú lateral de escritorio).
- Pantallas: Login (con código de empresa), Vender, Historial, Caja,
  Resultados (solo admin_sucursal/admin_empresa).
- Conectado a la API real multi-tenant (`/api/auth/login`, `/api/jugadas`,
  `/api/reportes/resumen`, `/api/caja/cerrar`, `/api/resultados`, etc).
- Tamaños táctiles ≥46px, `font-size:16px` en inputs (evita el zoom
  automático de iOS al enfocar un campo), soporte de "safe area" para
  notch/barra inferior de iPhone.
- PWA instalable (mismo `manifest.json`/`sw.js` de antes, versión de caché
  incrementada para forzar actualización).
- `verificar.html` actualizado a la ruta pública multi-tenant
  (`/api/verificar/:codigoEmpresa/:folio`), con formulario manual si no
  vienen los parámetros en la URL.
- Se encontró y corrigió, antes de entregar, un bug real de bucle
  potencialmente infinito: las pantallas de Historial/Caja/Resultados
  volvían a disparar su propia carga en cada `render()` si el resultado
  llegaba vacío — corregido separando "cargando" de "vacío de verdad" con
  banderas explícitas.

**Pendiente (no bloqueante, siguiente iteración):**
- Panel de plataforma para Óscar (super_admin) — pensado para escritorio,
  todavía no construido: onboarding de empresas, catálogo de loterías,
  carga de resultados oficiales. Hoy solo se puede hacer por API/curl.
- Panel más completo de admin_empresa (gestión de sucursales, usuarios,
  tabla de pagos) — hoy la app cubre lo operativo del día a día (vender,
  historial, caja, resultados) pero no la administración de catálogo.
- No se probó todavía en un teléfono real ni en distintos navegadores
  móviles — solo revisado por código y verificado sintácticamente. Probar
  en un dispositivo real antes de considerar esta fase 100% cerrada.



- **El frontend (`public/js/app.js`, `public/index.html`) sigue apuntando al
  contrato de la API anterior (single-tenant)**: no manda `codigoEmpresa` en
  el login, y `verificar.html` todavía usa `/api/verificar/:folio` en vez de
  `/api/verificar/:codigoEmpresa/:folio`. **No lo toqué en esta entrega** —
  el backend nuevo funciona correctamente probado con curl/Postman, pero la
  interfaz web todavía no. Es el siguiente paso lógico.
- Migración de datos reales desde el SQLite viejo (si ya tienes ventas que
  quieras conservar) — no incluida, hay que escribirla si aplica.
- Automatización resultados oficiales → resultados por empresa (mencionado arriba).
- Rol `app_banca` con permisos mínimos en Postgres (sección 11 de `schema.sql`)
  — el `DATABASE_URL` de ejemplo asume que ya tienes ese rol creado; créalo
  antes de ir a producción, no uses el superusuario de Postgres para la app.
- **Pruebas automatizadas (Fase 3 del roadmap)** — este backend no tiene
  todavía ninguna prueba automatizada, incluida la más importante de todas:
  verificar que el aislamiento RLS entre empresas realmente funciona. Ver
  `ROADMAP-MAESTRO.md` en la raíz del proyecto — es el siguiente paso recomendado.
