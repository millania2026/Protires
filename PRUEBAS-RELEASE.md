# Lista para la persona que probará y publicará

## Instalar y revisar el código

Desde la carpeta del proyecto:

```powershell
npm ci
Copy-Item .env.example .env
# Edita .env y crea dos secretos aleatorios diferentes para JWT_SECRET y ERP_WEBHOOK_KEY.
npx prisma db push
npm run db:migrate-service-images
npm run db:services
npm run build
npx tsc --noEmit
npm run dev
```

Prueba el portal en `http://localhost:5173`. La API local queda en `http://localhost:4000`. Para producción, sigue `PUBLICACION.md`; no publiques el archivo `.env`, la carpeta `backups`, `uploads` ni una base de desarrollo.

## Revisión funcional y de seguridad

- Registra e inicia sesión con una cuenta de prueba creada durante la prueba.
- Crea un vehículo y confirma que una solicitud con objetos anidados o campos de propietario/citas no puede crear registros adicionales ni cambiar el dueño.
- Prueba una cita válida, una fuera del horario, una superpuesta y una tercera solicitud pendiente del mismo usuario.
- Comprueba que las fotos de servicio JPG, PNG y WebP válidas de hasta 200 KB se cargan; una foto mayor, MIME distinto o archivo con firma falsa debe rechazarse.
- Confirma que las imágenes públicas salen de `/uploads/...` o de `public/images`, y que ninguna respuesta de API contiene `data:image/...`.
- Actualiza precios, duración y visibilidad en el panel; confirma que el portal refleja los cambios.
- Verifica que las solicitudes repetidas de login/reserva reciben 429 después del límite configurado.
- Comprueba que `/api/erp/inventory` sin `x-erp-key` devuelve 401 y que con la clave secreta correcta responde.
- Comprueba que `/api/health` responde `{"status":"ok"}` y que HTTPS queda activo en el dominio publicado.
- Genera un respaldo, restaura una copia en un entorno aislado y verifica que las fotos siguen cargando.

## Antes de abrir al público

- Cambia `app` en `fly.toml` si el nombre no está disponible y configura dominio, DNS, secretos y origen CORS definitivo.
- Crea el administrador real con contraseña única de 14 caracteres o más; no uses las cuentas demo.
- El taller debe completar los precios y duraciones reales de los 11 servicios, cargar su inventario inicial y confirmar la capacidad de bahías.
- Configura respaldos externos diarios de base y fotos y una alerta de disponibilidad.
- Confirma con el cliente el aviso de privacidad y los términos para datos de contacto y placas.
