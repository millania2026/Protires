// Servidor local / fuera de Vercel. En Vercel la entrada es api/index.ts.
import { app } from './app.js';

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');

app.listen(port, host, () => console.log(`Aplicación disponible en http://${host}:${port}`));
