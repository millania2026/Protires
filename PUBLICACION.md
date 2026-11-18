# Protires Services: preparación y publicación

Este repositorio es la única copia del proyecto para pruebas y publicación. No desplegar carpetas o paquetes antiguos.

## Antes de publicar

- Configura en el hosting `DATABASE_URL=file:/data/protires.db`, `DATABASE_BACKUP_DIR=/data/backups` y `PUBLIC_UPLOAD_DIR=/data/uploads` sobre un volumen persistente montado en `/data`.
- `JWT_SECRET` y `ERP_WEBHOOK_KEY` deben ser dos secretos aleatorios distintos, de al menos 32 bytes. No uses `.env.example` ni subas `.env` al repositorio.
- Configura `CORS_ORIGINS` con el dominio final exacto, `APPOINTMENT_CAPACITY` según las bahías disponibles y `TRUST_PROXY_HOPS=1` para Fly.io.
- El plan usa una sola máquina y SQLite. No escales a réplicas: SQLite, las fotos y el volumen son locales a esa máquina.
- Revisa los precios y duraciones de los 11 servicios desde el administrador. El catálogo de servicios inicial deja esos valores en cero hasta que el taller los confirme.

## Publicar con Fly.io

El proyecto incluye `Dockerfile`, `.dockerignore` y `fly.toml`. El archivo configura la región Miami, un volumen de 1 GB en `/data`, HTTPS, un chequeo de salud y una máquina de 512 MB. El nombre `protires` debe estar disponible en Fly.io; si no, cambia `app` en `fly.toml` antes de crear la aplicación.

1. Instala `flyctl` en Windows y autentícate con `fly auth signup` o `fly auth login`.
2. Desde esta carpeta, crea la aplicación indicada en `fly.toml` y el volumen:

   ```powershell
   fly apps create protires
   fly volumes create protires_data --region mia --size 1
   ```

3. Genera secretos localmente y cárgalos sin ponerlos en el código:

   ```powershell
   $jwtSecret = node -p "require('crypto').randomBytes(48).toString('hex')"
   $erpKey = node -p "require('crypto').randomBytes(48).toString('hex')"
   fly secrets set "JWT_SECRET=$jwtSecret" "ERP_WEBHOOK_KEY=$erpKey" "CORS_ORIGINS=https://protires.fly.dev"
   Remove-Variable jwtSecret,erpKey
   ```

   Si usas un dominio propio, configura aquí el origen HTTPS final. Guarda `ERP_WEBHOOK_KEY` también en el sistema ERP, solo del lado servidor.

4. Publica la aplicación:

   ```powershell
   fly deploy
   ```

5. Inicializa la base y el catálogo una sola vez sobre el volumen persistente:

   ```powershell
   fly ssh console -C "npm run db:backup"
   fly ssh console -C "npx prisma db push --skip-generate"
   fly ssh console -C "npm run db:migrate-service-images"
   fly ssh console -C "npm run db:services"
   ```

6. Crea el primer administrador con un correo del taller y una contraseña única de al menos 14 caracteres. Para ello, establece `ADMIN_EMAIL` y `ADMIN_PASSWORD` temporalmente como secretos de Fly, ejecuta `fly ssh console -C "npm run db:create-admin"` y quita inmediatamente esas dos variables con `fly secrets unset ADMIN_EMAIL ADMIN_PASSWORD`. El script elimina el acceso de las cuentas demo heredadas e invalida sus sesiones. No reutilices una contraseña personal.
7. Comprueba `/api/health`, crea un cliente real de prueba, registra vehículo, reserva una cita, acepta la cita desde el administrador y confirma que una petición ERP sin `x-erp-key` devuelve 401.
8. Añade el dominio propio y DNS cuando el cliente lo tenga. Después actualiza `CORS_ORIGINS` al dominio final y repite la prueba.

No ejecutes `db:services` cada vez que inicia el servidor: es una inicialización que vuelve a publicar el catálogo. Los servicios nuevos y sus fotos se gestionan desde la administración.

## Instalación local

```powershell
npm ci
Copy-Item .env.example .env
npx prisma db push
npm run db:services
npm run dev
```

Completa `JWT_SECRET` y `ERP_WEBHOOK_KEY` en `.env` con valores distintos antes de iniciar la API. En local el frontend queda en `http://localhost:5173` y el API en `http://localhost:4000`.

## Citas e imágenes

La API limita las solicitudes, valida campos antes de escribirlos y admite como máximo dos citas pendientes futuras por usuario. `APPOINTMENT_CAPACITY` controla las citas simultáneas permitidas; el valor inicial es una bahía. Se rechazan domingos y servicios que excedan el horario del taller en Caracas.

Las fotos se aceptan como JPG, PNG o WebP de hasta 200 KB, se guardan en `/data/uploads` y la base almacena únicamente su ruta. Ejecuta `db:migrate-service-images` una vez en bases que ya tengan fotos antiguas: convierte las imágenes base64 válidas de hasta 200 KB y elimina imágenes ajenas, inválidas o demasiado grandes, que se pueden volver a cargar optimizadas desde el administrador. La API pública tampoco entrega fotos base64. Las imágenes de respaldo del catálogo son locales; agrega fotos propias desde el administrador para personalizar cada servicio.

## Respaldos

`npm run db:backup` crea una copia SQLite consistente y valida integridad y conteos. Configura además una copia diaria fuera del volumen y del proveedor; prueba una restauración antes de abrir al público. Las fotos del directorio `/data/uploads` también deben copiarse junto con la base, ya que las rutas de servicio apuntan a esos archivos.

## Elementos que dependen del cliente/hosting

- Cuenta de Fly.io y medio de pago, dominio y acceso a su DNS.
- Dirección de correo administrativa y contraseña exclusiva.
- Precios, duraciones, capacidad real del taller y autorización de la clave ERP.
- Destino externo para respaldos y procedimiento de restauración.
- Aviso de privacidad y términos para el tratamiento de nombres, correos y placas.
