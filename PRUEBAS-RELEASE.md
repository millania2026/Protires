# Lista para la persona que probará y publicará

## Revisar el código en local

```powershell
npm ci
npm run typecheck
npm run build
```

Para probarlo en local con base de datos, sigue "Desarrollo local" en `PUBLICACION.md`.

## Prueba funcional en la URL de Vercel (vista previa o producción)

- `/api/health` responde `{"status":"ok"}` y el sitio abre con HTTPS.
- Registra una cuenta de prueba, inicia sesión y agrega un vehículo.
- Reserva: al elegir servicio y fecha sólo aparecen horarios disponibles. Un domingo muestra "Los domingos el taller está cerrado". Después de reservar, ese horario ya no se ofrece.
- En "Mi panel" la cita aparece como **Pendiente** (no "Confirmada") y se puede cancelar.
- Con la misma cuenta, una tercera solicitud pendiente se rechaza con un mensaje claro.
- En el panel de administración:
  - Confirma una cita; el cliente la ve **Confirmada**. Rechaza otra; el cliente la ve **Cancelada**.
  - Los filtros Próximas, Pendientes y Todas cambian la lista.
  - Crea un artículo sin marca ni modelo de vehículo (por ejemplo, un aceite) y edítalo: debe guardarse.
  - Sube una foto de servicio tomada con el celular (2-5 MB): se optimiza sola y aparece en el portal. Ninguna respuesta de la API contiene `data:image/...`.
  - **Clave temporal de cliente:** genera una para la cuenta de prueba y entra con ella.
  - **Cambiar mi contraseña** cierra la sesión y permite entrar con la nueva.
- **Cerrar sesión** invalida el token: volver atrás en el navegador no recupera el panel.
- 9 intentos de login con contraseña incorrecta para el mismo correo dan 429; ese cliente sigue pudiendo entrar desde otra conexión.
- `/api/erp/inventory` sin `x-erp-key` devuelve 401 y con la clave correcta responde.
- Si se usa un dominio propio, repite el login y la reserva desde ese dominio, con y sin `www`.

## Antes de abrir al público

- Plan Pro de Vercel, dominio, Neon y Blob conectados (ver `PUBLICACION.md`).
- Administrador real con contraseña única de 14 caracteres o más; borra la cuenta de prueba desde la base.
- El taller completa precios y duraciones de los 11 servicios, carga su inventario y confirma la capacidad.
- Restauración probada en Neon y un `npm run db:backup` guardado fuera de la plataforma.
- Alerta de disponibilidad sobre `/api/health`.
- Aviso de privacidad y cifras de la portada confirmados por el cliente.
