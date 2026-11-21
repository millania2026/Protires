# Protires Services: publicación en Vercel

Este repositorio es la única copia del proyecto. Vercel publica cada push a `main` (producción) y cada rama o PR (vista previa).

## Qué usa

| Pieza | Servicio | Variables que crea |
|---|---|---|
| Portal (Vite) y API (Express en `api/index.ts`) | Vercel | — |
| Base de datos | Neon Postgres, desde el Marketplace de Vercel | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` |
| Fotos de servicios | Vercel Blob (acceso **público**) | `BLOB_READ_WRITE_TOKEN` |

> **Plan de Vercel:** el plan Hobby es sólo para uso personal y no comercial. Para la web de un taller usa el plan **Pro**.

## Primera publicación

1. En vercel.com: **Add New → Project → Import** `millania2026/Protires`. La configuración (Vite, build, carpeta `dist`, cabeceras de seguridad) ya viene en `vercel.json`. Si Vercel intenta un primer deploy antes del paso 3, **fallará el build: es normal**, todavía no hay base de datos.
2. **Storage → Create Database → Neon** y conéctala al proyecto (Production y Preview). Elige la región **AWS us-east-1 (Washington)**, la misma de las funciones de Vercel. Crea `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
   - Recomendado: en la integración de Neon activa **una rama por vista previa**, así las vistas previas no escriben en la base de producción.
3. **Storage → Create → Blob**, con acceso público, y conéctalo al proyecto. Crea `BLOB_READ_WRITE_TOKEN`.
4. **Settings → Environment Variables** (Production y Preview):
   - `JWT_SECRET` y `ERP_WEBHOOK_KEY`: dos valores aleatorios **distintos**. Genera cada uno en PowerShell con:
     ```powershell
     node -p "require('crypto').randomBytes(48).toString('hex')"
     ```
   - `APPOINTMENT_CAPACITY`: citas simultáneas que admite el taller (bahías). Por defecto 1.
   - `TRUST_PROXY_HOPS`: `1`.
   - `CORS_ORIGINS`: déjala vacía. El propio portal, `www`/sin `www`, el dominio propio y las vistas previas ya están permitidos; sólo se usa si otro sitio distinto debe llamar a la API.
5. **Deployments → Redeploy**, o haz un push a `main`. El build ejecuta `prisma migrate deploy` y crea las tablas.
6. Carga el catálogo y crea el administrador **una sola vez** desde tu PC, apuntando a la base de producción. Copia de Vercel el valor de `DATABASE_URL_UNPOOLED` y, en la carpeta del proyecto:
   ```powershell
   npm ci
   $env:DATABASE_URL = "<pega aquí DATABASE_URL_UNPOOLED>"
   $env:DATABASE_URL_UNPOOLED = $env:DATABASE_URL
   npm run db:services
   $env:ADMIN_EMAIL = "correo-del-taller@dominio.com"
   $env:ADMIN_PASSWORD = "<contraseña única de 14 caracteres o más>"
   npm run db:create-admin
   Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD, Env:DATABASE_URL, Env:DATABASE_URL_UNPOOLED
   ```
   `db:services` se puede repetir sin riesgo: sólo crea los servicios que falten y no toca precios, fotos ni servicios creados desde el panel.
7. Comprueba lo que indica `PRUEBAS-RELEASE.md` (salud, registro, reserva, confirmación, foto y ERP).
8. Dominio propio: **Settings → Domains**. No hace falta cambiar CORS ni volver a desplegar.

## Cambios en la base de datos

1. Edita `prisma/schema.prisma`.
2. Contra una base de desarrollo (por ejemplo, una rama de Neon), ejecuta `npm run db:migrate:dev -- --name descripcion-del-cambio`.
3. Haz commit de la carpeta `prisma/migrations`. El próximo deploy la aplica sola.

## Respaldos

- **Neon** guarda el historial y permite restaurar a un punto en el tiempo; la ventana depende del plan. Prueba una restauración antes de abrir al público.
- `npm run db:backup` exporta toda la base a un JSON en `DATABASE_BACKUP_DIR` (por defecto `./backups`). Contiene correos y hashes de contraseñas: guárdalo en un lugar privado y fuera del repositorio.
- Las fotos viven en Vercel Blob y no se borran con la base. Cuando se reemplaza la foto de un servicio, el panel borra la anterior.

## Operación diaria

- **Cliente que olvidó su contraseña:** llama al taller. En el panel, **Clave temporal de cliente** genera una clave y cierra sus sesiones. Verifica su identidad antes de dársela; al entrar, el cliente la cambia en **Contraseña**.
- **Contraseña del administrador:** panel → **Cambiar mi contraseña**.
- **Citas:** el cliente envía una solicitud (pendiente) y el taller la confirma o la rechaza; una confirmada se puede cancelar después. El cliente puede cancelar las suyas desde su panel. Una cita cancelada no se reactiva: su cupo queda libre para otro cliente.
- **Horario:** lunes a sábado, de 8:30 a. m. a 5:30 p. m. (Caracas), turnos cada 30 minutos y hasta 90 días de anticipación. Estas reglas viven en `server/schedule.ts`.
- **Límites contra abuso** (compartidos entre todas las instancias, en la tabla `RateLimit`):
  - Login: 8 fallos por correo y conexión cada 15 minutos (sólo cuentan los fallos) y 100 intentos por conexión cada 15 minutos.
  - Registro: 20 cuentas por conexión cada hora.
  - Reservas: 15 por conexión al día y 2 pendientes por cliente. Un horario mal elegido no cuenta.

## Desarrollo local

```powershell
npm ci
Copy-Item .env.example .env
```

En `.env`, completa `DATABASE_URL` y `DATABASE_URL_UNPOOLED` (una rama de desarrollo de Neon o un Postgres propio) y los dos secretos. Después:

```powershell
npm run db:migrate
npm run db:services
npm run dev
```

El portal queda en `http://localhost:5173` y la API en `http://localhost:4000`. Sin `BLOB_READ_WRITE_TOKEN`, las fotos se guardan en `./uploads`.

## Lo que depende del cliente

- Cuenta de Vercel (plan Pro), dominio y acceso a su DNS.
- Correo administrativo y contraseña exclusiva.
- Precios, duraciones y capacidad real del taller. El catálogo inicial deja precio 0 ("precio por consultar") y 30 minutos.
- Confirmar las cifras de la portada ("12+ años", "4.9★", "2.4k vehículos") o quitarlas.
- Aviso de privacidad y términos para nombres, correos y placas.
- Autorizar la clave ERP y guardarla sólo del lado del servidor del ERP.
