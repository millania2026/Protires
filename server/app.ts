import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRateLimiter } from './rateLimit.js';
import { createImageStorage, safeImageUrl, StorageNotConfiguredError } from './storage.js';
import {
  caracasDayStart,
  caracasParts,
  daySlots,
  fitsCapacity,
  MAX_DAYS_AHEAD,
  parseStartsAt,
  scheduleProblem,
  type Interval,
} from './schedule.js';

// ---------------------------------------------------------------------------
// Configuración (falla al arrancar si falta algo crítico)
// ---------------------------------------------------------------------------
const secret = process.env.JWT_SECRET || '';
const erpSecret = process.env.ERP_WEBHOOK_KEY || '';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL debe configurarse.');
if (Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET debe configurarse con al menos 32 bytes aleatorios.');
if (Buffer.byteLength(erpSecret) < 32)
  throw new Error('ERP_WEBHOOK_KEY debe configurarse con al menos 32 bytes aleatorios.');
if (secret === erpSecret) throw new Error('JWT_SECRET y ERP_WEBHOOK_KEY deben ser distintos.');

const ISSUER = 'protires-services';
const AUDIENCE = 'protires-portal';
const production = process.env.NODE_ENV === 'production';
const onVercel = Boolean(process.env.VERCEL);
const appointmentCapacity = Number(process.env.APPOINTMENT_CAPACITY || 1);
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 1);
if (!Number.isInteger(appointmentCapacity) || appointmentCapacity < 1 || appointmentCapacity > 20)
  throw new Error('APPOINTMENT_CAPACITY debe estar entre 1 y 20.');
if (production && (!Number.isInteger(trustProxyHops) || trustProxyHops < 1 || trustProxyHops > 5))
  throw new Error('TRUST_PROXY_HOPS debe estar entre 1 y 5 en producción.');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Hash bcrypt de un valor aleatorio descartado: iguala el tiempo de respuesta cuando el correo no existe.
const DUMMY_PASSWORD_HASH = '$2b$12$SOUv2HWjLBP52xE/8/YpGeCH4kPA6jI81I8IW9EdBcfv1T0FNKRI.';
const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'];
const JSON_LIMIT_BYTES = 100 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_LIMIT_BYTES = 1024 * 1024; // el panel optimiza las fotos a ~900 KB antes de subirlas

export const db = new PrismaClient();
const limiter = createRateLimiter(db);
const storage = createImageStorage();
export const app = express();

// La misma política se repite en vercel.json para el HTML y los archivos estáticos que sirve Vercel.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
  "connect-src 'self'",
  'frame-src https://www.google.com https://maps.google.com',
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.disable('x-powered-by');
app.set('trust proxy', production ? trustProxyHops : false);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  // Sin includeSubDomains: el dominio propio del taller puede tener subdominios sin HTTPS.
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------------------
// CORS: el portal y la API comparten dominio, así que el mismo origen siempre pasa
// (también en las vistas previas de Vercel y en www/sin www). CORS_ORIGINS sólo agrega otros.
// ---------------------------------------------------------------------------
const extraOrigins = new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
function requestHosts(req: Request) {
  const headers = production ? [req.headers['x-forwarded-host'], req.headers.host] : [req.headers.host];
  return headers
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}
function originAllowed(req: Request) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (extraOrigins.has(origin)) return true;
  if (!production && LOCAL_ORIGIN.test(origin)) return true;
  try {
    return requestHosts(req).includes(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}
app.use(
  cors((req, callback) => {
    if (!originAllowed(req as Request)) return callback(new Error('Origen no autorizado'));
    callback(null, { origin: Boolean(req.headers.origin), maxAge: 600 });
  }),
);
// En Vercel el runtime lee el cuerpo antes que Express (helpers de Node) y express.json no llega a
// aplicar su límite: se valida aquí por Content-Length para que el tope sea el mismo en ambos entornos.
app.use((req, res, next) => {
  const type = String(req.headers['content-type'] || '');
  if (type.startsWith('application/json') && Number(req.headers['content-length'] || 0) > JSON_LIMIT_BYTES)
    return res.status(413).json({ error: 'La solicitud supera el tamaño permitido.' });
  next();
});
app.use(express.json({ limit: JSON_LIMIT_BYTES, strict: true }));

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
type AuthedRequest = Request & { uid?: string; role?: string };

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max: number, required = false) {
  if (typeof value !== 'string') return required ? null : '';
  const result = value.trim().replace(/\s+/g, ' ');
  return result.length <= max && (!required || result.length > 0) ? result : null;
}
function email(value: unknown) {
  const valueText = text(value, 254, true);
  return valueText && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valueText) ? valueText.toLowerCase() : null;
}
function integer(value: unknown, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
/** bcrypt sólo usa los primeros 72 bytes: se rechaza lo que no cabe en vez de truncarlo en silencio. */
function newPasswordProblem(value: unknown) {
  if (typeof value !== 'string' || value.length < 10 || Buffer.byteLength(value) > 72)
    return 'La contraseña debe tener al menos 10 caracteres (máximo 72 bytes).';
  return null;
}
function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
function signToken(user: { id: string; tokenVersion: number }) {
  return jwt.sign({ sub: user.id, ver: user.tokenVersion }, secret, {
    algorithm: 'HS256',
    expiresIn: '12h',
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}
function publicUser(user: { id: string; name: string; email: string; role: string }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
function withSafeImage<T extends { imageUrl: string | null }>(service: T) {
  return { ...service, imageUrl: safeImageUrl(service.imageUrl) ?? null };
}

async function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  let payload: JwtPayload;
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE }) as JwtPayload;
  } catch {
    return res.status(401).json({ error: 'Tu sesión terminó. Inicia sesión de nuevo.' });
  }
  if (typeof payload.sub !== 'string' || !Number.isSafeInteger(payload.ver))
    return res.status(401).json({ error: 'Tu sesión terminó. Inicia sesión de nuevo.' });
  const user = await db.user.findUnique({ where: { id: payload.sub }, select: { tokenVersion: true, role: true } });
  if (!user || user.tokenVersion !== payload.ver)
    return res.status(401).json({ error: 'Tu sesión terminó. Inicia sesión de nuevo.' });
  req.uid = payload.sub;
  req.role = user.role;
  next();
}
function adminOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.role !== 'ADMIN') return res.status(403).json({ error: 'Acceso exclusivo para administradores' });
  next();
}
function erpOnly(req: Request, res: Response, next: NextFunction) {
  const supplied = Buffer.from(String(req.headers['x-erp-key'] || ''));
  const expected = Buffer.from(erpSecret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return res.status(401).json({ error: 'Clave ERP inválida' });
  next();
}
function imageSignature(buffer: Buffer, mime: string) {
  if (mime === 'image/jpeg')
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png')
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/webp')
    return (
      buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  return false;
}

/** Citas activas (pendientes o confirmadas) que empiezan dentro de [from, to). */
async function busyIntervals(client: Prisma.TransactionClient | PrismaClient, from: Date, to: Date) {
  const rows = await client.appointment.findMany({
    where: { startsAt: { gte: from, lt: to }, status: { in: ACTIVE_STATUSES } },
    select: { startsAt: true, service: { select: { durationMin: true } } },
  });
  return rows.map<Interval>(row => ({
    begin: row.startsAt.getTime(),
    end: row.startsAt.getTime() + row.service.durationMin * MINUTE,
  }));
}

const appointmentInclude = {
  vehicle: true,
  service: {
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      durationMin: true,
      priceCents: true,
      imageUrl: true,
    },
  },
} satisfies Prisma.AppointmentInclude;

// ---------------------------------------------------------------------------
// Cuenta y sesión
// ---------------------------------------------------------------------------
app.use('/api/erp', erpOnly);

app.post('/api/auth/register', async (req, res) => {
  if ((await limiter.hit(`register:${clientIp(req)}`, HOUR)) > 20)
    return res
      .status(429)
      .json({ error: 'Se alcanzó el límite de registros desde esta conexión. Intenta en una hora.' });
  const body = isRecord(req.body) ? req.body : {};
  const name = text(body.name, 80, true);
  const userEmail = email(body.email);
  const passwordProblem = newPasswordProblem(body.password);
  if (!name || !userEmail || passwordProblem)
    return res.status(400).json({ error: passwordProblem || 'Revisa tu nombre y tu correo.' });
  const passwordHash = await bcrypt.hash(body.password as string, 12);
  try {
    const user = await db.user.create({ data: { name, email: userEmail, passwordHash } });
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return res
        .status(409)
        .json({ error: 'No se pudo crear la cuenta. Si ya te registraste con ese correo, inicia sesión.' });
    throw error;
  }
});

app.post('/api/auth/login', async (req, res) => {
  const ip = clientIp(req);
  // Por conexión, con margen para redes compartidas (CGNAT de las operadoras, wifi del taller).
  if ((await limiter.hit(`auth-ip:${ip}`, 15 * MINUTE)) > 100)
    return res.status(429).json({ error: 'Demasiados intentos desde esta conexión. Espera unos minutos.' });
  const body = isRecord(req.body) ? req.body : {};
  const userEmail = email(body.email);
  const password = typeof body.password === 'string' && body.password.length <= 1024 ? body.password : '';
  if (!userEmail || !password) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  // Sólo cuentan los intentos fallidos, por correo y conexión (y un tope por correo para ataques repartidos).
  const failKey = `login-fail:${userEmail}:${ip}`;
  const accountKey = `login-fail:${userEmail}`;
  if ((await limiter.peek(failKey)) >= 8 || (await limiter.peek(accountKey)) >= 50)
    return res.status(429).json({
      error:
        'Demasiados intentos fallidos con este correo. Espera 15 minutos o llama al taller para una clave temporal.',
    });
  const user = await db.user.findUnique({ where: { email: userEmail } });
  const matches = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
  if (!user || !matches) {
    await limiter.hit(failKey, 15 * MINUTE);
    await limiter.hit(accountKey, HOUR);
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }
  await limiter.clear(failKey);
  return res.json({ token: signToken(user), user: publicUser(user) });
});

// Cerrar sesión invalida el token en el servidor (todas las sesiones abiertas de la cuenta).
app.post('/api/auth/logout', auth, async (req: AuthedRequest, res) => {
  await db.user.update({ where: { id: req.uid }, data: { tokenVersion: { increment: 1 } } });
  return res.status(204).end();
});

app.post('/api/auth/password', auth, async (req: AuthedRequest, res) => {
  if ((await limiter.hit(`password:${req.uid}`, HOUR)) > 10)
    return res.status(429).json({ error: 'Demasiados intentos. Espera una hora.' });
  const body = isRecord(req.body) ? req.body : {};
  const problem = newPasswordProblem(body.newPassword);
  if (typeof body.currentPassword !== 'string' || problem)
    return res.status(400).json({ error: problem || 'Escribe tu contraseña actual.' });
  const user = await db.user.findUnique({ where: { id: req.uid } });
  if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash)))
    return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  const updated = await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword as string, 12), tokenVersion: { increment: 1 } },
  });
  return res.json({ token: signToken(updated), user: publicUser(updated) });
});

app.get('/api/me', auth, async (req: AuthedRequest, res) => {
  const user = await db.user.findUnique({
    where: { id: req.uid },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  return res.json(user);
});

app.get('/api/health', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    return res.json({ status: 'ok' });
  } catch {
    return res.status(503).json({ status: 'error' });
  }
});

// ---------------------------------------------------------------------------
// Catálogo público
// ---------------------------------------------------------------------------
app.get('/api/services', async (_req, res) => {
  const services = await db.service.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      durationMin: true,
      priceCents: true,
      active: true,
      imageUrl: true,
    },
  });
  return res.json(services.map(withSafeImage));
});

app.get('/api/inventory', async (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .slice(0, 80);
  const vehicleMake = String(req.query.vehicleMake || '')
    .trim()
    .toLocaleLowerCase('es');
  const vehicleModel = String(req.query.vehicleModel || req.query.vehicle || '')
    .trim()
    .toLocaleLowerCase('es');
  const contains = { contains: q, mode: 'insensitive' as const };
  const rows = await db.partsInventory.findMany({
    where: {
      active: true,
      ...(q
        ? {
            OR: [
              { name: contains },
              { sku: contains },
              { productBrand: contains },
              { productModel: contains },
              { vehicleMake: contains },
              { vehicleModel: contains },
              { category: contains },
              { tireSize: contains },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: 300,
  });
  const matches = rows.filter(item => {
    if (!vehicleMake && !vehicleModel) return true;
    if (item.vehicleMake || item.vehicleModel)
      return (
        (!item.vehicleMake || item.vehicleMake.toLocaleLowerCase('es') === vehicleMake) &&
        (!item.vehicleModel || item.vehicleModel.toLocaleLowerCase('es') === vehicleModel)
      );
    const legacy = String(item.compatibility || '').toLocaleLowerCase('es');
    if (!legacy) return true; // artículo de uso general
    return vehicleModel ? legacy.includes(vehicleModel) : !vehicleMake || legacy.includes(vehicleMake);
  });
  return res.json(
    matches.map(item => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      priceCents: item.priceCents,
      stock: item.stock,
      productBrand: item.productBrand,
      productModel: item.productModel,
      vehicleMake: item.vehicleMake,
      vehicleModel: item.vehicleModel,
      tireSize: item.tireSize,
      active: item.active,
    })),
  );
});

// Turnos de un día para un servicio: el portal sólo ofrece horarios que el servidor aceptará.
app.get('/api/availability', async (req, res) => {
  const serviceId = text(req.query.serviceId, 64, true);
  const day = String(req.query.date || '');
  if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    return res.status(400).json({ error: 'Fecha o servicio inválido.' });
  const dayStart = caracasDayStart(day);
  if (Number.isNaN(dayStart.getTime())) return res.status(400).json({ error: 'Fecha inválida.' });
  const service = await db.service.findFirst({ where: { id: serviceId, active: true } });
  if (!service) return res.status(404).json({ error: 'Servicio no disponible.' });
  const now = new Date();
  const nextDay = new Date(dayStart.getTime() + DAY);
  const reply = (reason: string | null, slots: Array<{ time: string; startsAt: string; available: boolean }> = []) =>
    res.json({ date: day, durationMin: service.durationMin, reason, slots });
  if (caracasParts(new Date(dayStart.getTime() + 12 * HOUR)).weekday === 'Sun')
    return reply('Los domingos el taller está cerrado.');
  if (nextDay <= now) return reply('Esa fecha ya pasó.');
  if (dayStart.getTime() > now.getTime() + MAX_DAYS_AHEAD * DAY)
    return reply(`Puedes reservar con hasta ${MAX_DAYS_AHEAD} días de anticipación.`);
  const busy = await busyIntervals(db, dayStart, nextDay);
  const slots = daySlots(day, service.durationMin).map(slot => {
    const start = slot.startsAt.getTime();
    const available =
      !scheduleProblem(slot.startsAt, service.durationMin, now) &&
      fitsCapacity(busy, start, start + service.durationMin * MINUTE, appointmentCapacity);
    return { time: slot.time, startsAt: slot.startsAt.toISOString(), available };
  });
  return reply(slots.some(slot => slot.available) ? null : 'No quedan horarios disponibles ese día.', slots);
});

// ---------------------------------------------------------------------------
// Vehículos y citas del cliente
// ---------------------------------------------------------------------------
app.get('/api/vehicles', auth, async (req: AuthedRequest, res) =>
  res.json(await db.vehicle.findMany({ where: { userId: req.uid }, orderBy: { make: 'asc' } })),
);

app.post('/api/vehicles', auth, async (req: AuthedRequest, res) => {
  const body = req.body;
  if (!isRecord(body)) return res.status(400).json({ error: 'Datos del vehículo inválidos.' });
  const make = text(body.make, 40, true),
    model = text(body.model, 60, true),
    plateValue = text(body.plate, 12, true)?.toUpperCase();
  const year = integer(body.year, 1950, new Date().getFullYear() + 1);
  const engine = body.engine == null || body.engine === '' ? null : text(body.engine, 40);
  const tireSize = body.tireSize == null || body.tireSize === '' ? null : text(body.tireSize, 20);
  if (
    !make ||
    !model ||
    !plateValue ||
    !/^[A-Z0-9 -]{4,12}$/.test(plateValue) ||
    year === null ||
    (engine === null && body.engine != null && body.engine !== '') ||
    (tireSize === null && body.tireSize != null && body.tireSize !== '')
  )
    return res.status(400).json({ error: 'Revisa marca, modelo, año, placa, motor y medida del caucho.' });
  try {
    const vehicle = await db.vehicle.create({
      data: { make, model, plate: plateValue, year, engine, tireSize, userId: req.uid! },
    });
    return res.status(201).json(vehicle);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return res.status(409).json({ error: 'Esa placa ya está registrada en tu cuenta.' });
    throw error;
  }
});

app.post('/api/appointments', auth, async (req: AuthedRequest, res) => {
  const body = req.body;
  if (!isRecord(body)) return res.status(400).json({ error: 'Datos de la cita inválidos.' });
  const vehicleId = text(body.vehicleId, 64, true),
    serviceId = text(body.serviceId, 64, true);
  const startsAt = parseStartsAt(body.startsAt);
  const notes = body.notes == null || body.notes === '' ? null : text(body.notes, 1000);
  if (!vehicleId || !serviceId || !startsAt || (notes === null && body.notes != null && body.notes !== ''))
    return res.status(400).json({ error: 'Revisa vehículo, servicio, fecha y notas.' });
  const [vehicle, service] = await Promise.all([
    db.vehicle.findFirst({ where: { id: vehicleId, userId: req.uid } }),
    db.service.findUnique({ where: { id: serviceId } }),
  ]);
  if (!vehicle || !service || !service.active)
    return res.status(400).json({ error: 'Selecciona un vehículo tuyo y un servicio disponible.' });
  const problem = scheduleProblem(startsAt, service.durationMin);
  if (problem) return res.status(400).json({ error: problem });
  // Sólo cuentan las reservas creadas: un horario mal elegido no bloquea al cliente.
  const ipKey = `booking:${clientIp(req)}`;
  if ((await limiter.peek(ipKey)) >= 15)
    return res
      .status(429)
      .json({ error: 'Se alcanzó el límite diario de reservas desde esta conexión. Llama al taller.' });
  const dayStart = caracasDayStart(caracasParts(startsAt).date);
  const nextDay = new Date(dayStart.getTime() + DAY);
  const start = startsAt.getTime();
  const end = start + service.durationMin * MINUTE;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const appointment = await db.$transaction(
        async tx => {
          const userPending = await tx.appointment.count({
            where: { userId: req.uid, status: 'PENDING', startsAt: { gte: new Date() } },
          });
          if (userPending >= 2)
            throw new HttpError(
              429,
              'Puedes tener hasta dos solicitudes de cita pendientes. Espera la respuesta del taller o cancela una.',
            );
          if (!fitsCapacity(await busyIntervals(tx, dayStart, nextDay), start, end, appointmentCapacity))
            throw new HttpError(409, 'Ese horario ya está ocupado; elige otro.');
          return tx.appointment.create({
            data: { userId: req.uid!, vehicleId, serviceId, startsAt, notes, estimateCents: service.priceCents },
            include: appointmentInclude,
          });
        },
        // Serializable: dos reservas simultáneas no pueden tomar el mismo cupo.
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await limiter.hit(ipKey, DAY);
      return res.status(201).json({ ...appointment, service: withSafeImage(appointment.service) });
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        if (attempt < 4) continue;
        return res.status(409).json({ error: 'Ese horario se está reservando en este momento; elige otro.' });
      }
      throw error;
    }
  }
});

app.get('/api/appointments', auth, async (req: AuthedRequest, res) => {
  const appointments = await db.appointment.findMany({
    where: { userId: req.uid },
    include: appointmentInclude,
    orderBy: { startsAt: 'asc' },
  });
  return res.json(appointments.map(item => ({ ...item, service: withSafeImage(item.service) })));
});

app.post('/api/appointments/:id/cancel', auth, async (req: AuthedRequest, res) => {
  const result = await db.appointment.updateMany({
    where: {
      id: String(req.params.id),
      userId: req.uid,
      status: { in: ACTIVE_STATUSES },
      startsAt: { gt: new Date() },
    },
    data: { status: 'CANCELLED' },
  });
  if (!result.count)
    return res.status(409).json({ error: 'Esta cita ya no se puede cancelar desde el portal. Llama al taller.' });
  return res.json({ id: String(req.params.id), status: 'CANCELLED' });
});

// ---------------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------------
app.get('/api/admin/appointments', auth, adminOnly, async (_req, res) => {
  const appointments = await db.appointment.findMany({
    where: { startsAt: { gte: new Date(Date.now() - 30 * DAY) } },
    include: { user: { select: { name: true, email: true } }, ...appointmentInclude },
    orderBy: { startsAt: 'asc' },
  });
  return res.json(appointments.map(item => ({ ...item, service: withSafeImage(item.service) })));
});

// Pendiente → aceptada o rechazada; aceptada → cancelada. Una cita cancelada no se reactiva
// (liberó su cupo y otro cliente pudo tomarlo): el cliente pide una nueva.
const STATUS_FROM: Record<string, string[]> = { CONFIRMED: ['PENDING'], CANCELLED: ['PENDING', 'CONFIRMED'] };
app.patch('/api/admin/appointments/:id', auth, adminOnly, async (req, res) => {
  const status = isRecord(req.body) ? String(req.body.status) : '';
  if (!STATUS_FROM[status]) return res.status(400).json({ error: 'Estado inválido.' });
  const id = String(req.params.id);
  const result = await db.appointment.updateMany({
    where: { id, status: { in: STATUS_FROM[status] } },
    data: { status },
  });
  if (!result.count) {
    const exists = await db.appointment.findUnique({ where: { id }, select: { status: true } });
    if (!exists) return res.status(404).json({ error: 'Cita no encontrada.' });
    return res.status(409).json({ error: 'Esa cita ya fue procesada; actualiza la lista.' });
  }
  const updated = await db.appointment.findUnique({
    where: { id },
    include: { user: { select: { name: true, email: true } }, ...appointmentInclude },
  });
  return res.json(updated ? { ...updated, service: withSafeImage(updated.service) } : { id, status });
});

// Sin correo saliente, la recuperación la hace el taller: el cliente llama y el admin genera una clave temporal.
app.post('/api/admin/users/reset-password', auth, adminOnly, async (req: AuthedRequest, res) => {
  const userEmail = isRecord(req.body) ? email(req.body.email) : null;
  if (!userEmail) return res.status(400).json({ error: 'Escribe el correo del cliente.' });
  const user = await db.user.findUnique({ where: { email: userEmail } });
  if (!user) return res.status(404).json({ error: 'No hay ninguna cuenta con ese correo.' });
  if (user.role === 'ADMIN')
    return res.status(403).json({ error: 'Un administrador cambia su clave desde "Cambiar mi contraseña".' });
  const temporaryPassword = randomBytes(9).toString('base64url');
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(temporaryPassword, 12), tokenVersion: { increment: 1 } },
  });
  console.info(
    JSON.stringify({ event: 'admin_password_reset', by: req.uid, user: user.id, at: new Date().toISOString() }),
  );
  return res.json({ email: user.email, name: user.name, temporaryPassword });
});

app.get('/api/admin/inventory', auth, adminOnly, async (_req, res) =>
  res.json(await db.partsInventory.findMany({ orderBy: { name: 'asc' } })),
);

function inventoryFields(body: Record<string, unknown>) {
  const sku = text(body.sku, 60, true),
    name = text(body.name, 120, true),
    category = text(body.category, 60, true);
  const priceCents = integer(body.priceCents, 0, 1_000_000_000),
    stock = integer(body.stock, 0, 1_000_000);
  const optional = (key: string, max: number) => (body[key] == null || body[key] === '' ? null : text(body[key], max));
  const productBrand = optional('productBrand', 80),
    productModel = optional('productModel', 80),
    vehicleMake = optional('vehicleMake', 80),
    vehicleModel = optional('vehicleModel', 80),
    tireSize = optional('tireSize', 30);
  const compatibility =
    body.compatibility == null ? [vehicleMake, vehicleModel].filter(Boolean).join(' ') : text(body.compatibility, 180);
  const invalidOptional = (value: string | null, key: string) =>
    value === null && body[key] != null && body[key] !== '';
  if (
    !sku ||
    !name ||
    !category ||
    priceCents === null ||
    stock === null ||
    invalidOptional(productBrand, 'productBrand') ||
    invalidOptional(productModel, 'productModel') ||
    invalidOptional(vehicleMake, 'vehicleMake') ||
    invalidOptional(vehicleModel, 'vehicleModel') ||
    invalidOptional(tireSize, 'tireSize') ||
    compatibility === null
  )
    return null;
  return {
    sku,
    name,
    category,
    priceCents,
    stock,
    productBrand,
    productModel,
    vehicleMake,
    vehicleModel,
    tireSize,
    compatibility,
    active: body.active !== false,
  };
}

app.post('/api/admin/inventory', auth, adminOnly, async (req, res) => {
  if (!isRecord(req.body)) return res.status(400).json({ error: 'Artículo inválido.' });
  const data = inventoryFields(req.body);
  if (!data) return res.status(400).json({ error: 'Revisa SKU, nombre, categoría, precio y stock.' });
  try {
    return res.status(201).json(await db.partsInventory.create({ data }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return res.status(409).json({ error: 'Ya existe un artículo con ese SKU.' });
    throw error;
  }
});

const INVENTORY_TEXT: Record<string, { max: number; optional: boolean }> = {
  sku: { max: 60, optional: false },
  name: { max: 120, optional: false },
  category: { max: 60, optional: false },
  // Puede quedar vacía: artículos de uso general (aceites, cauchos sin vehículo asignado).
  compatibility: { max: 180, optional: false },
  productBrand: { max: 80, optional: true },
  productModel: { max: 80, optional: true },
  vehicleMake: { max: 80, optional: true },
  vehicleModel: { max: 80, optional: true },
  tireSize: { max: 30, optional: true },
};
app.patch('/api/admin/inventory/:id', auth, adminOnly, async (req, res) => {
  if (!isRecord(req.body)) return res.status(400).json({ error: 'Artículo inválido.' });
  const allowed = [...Object.keys(INVENTORY_TEXT), 'priceCents', 'stock', 'active'];
  if (Object.keys(req.body).some(key => !allowed.includes(key)))
    return res.status(400).json({ error: 'El artículo contiene campos no permitidos.' });
  const data: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(INVENTORY_TEXT)) {
    const raw = req.body[key];
    if (raw === undefined) continue;
    if (raw == null || raw === '') {
      if (rule.optional) data[key] = null;
      else if (key === 'compatibility') data[key] = '';
      else return res.status(400).json({ error: 'SKU, nombre y categoría son obligatorios.' });
      continue;
    }
    const value = text(raw, rule.max, !rule.optional);
    if (value === null) return res.status(400).json({ error: 'Campo de artículo inválido.' });
    data[key] = rule.optional && value === '' ? null : value;
  }
  for (const key of ['priceCents', 'stock']) {
    if (req.body[key] === undefined) continue;
    const value = integer(req.body[key], 0, key === 'stock' ? 1_000_000 : 1_000_000_000);
    if (value === null) return res.status(400).json({ error: 'Precio o stock inválido.' });
    data[key] = value;
  }
  if (req.body.active !== undefined) {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Estado de visibilidad inválido.' });
    data.active = req.body.active;
  }
  try {
    return res.json(await db.partsInventory.update({ where: { id: String(req.params.id) }, data }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return res.status(409).json({ error: 'Ya existe un artículo con ese SKU.' });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
      return res.status(404).json({ error: 'Artículo no encontrado.' });
    throw error;
  }
});

app.get('/api/admin/services', auth, adminOnly, async (_req, res) => {
  const services = await db.service.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  return res.json(services.map(withSafeImage));
});

const SERVICE_KEYS = ['name', 'description', 'category', 'durationMin', 'priceCents', 'active', 'imageUrl'];
function serviceFields(body: Record<string, unknown>, partial = false) {
  const data: Record<string, unknown> = {};
  for (const [key, max] of [
    ['name', 100],
    ['description', 1000],
    ['category', 60],
  ] as const) {
    if (partial && body[key] === undefined) continue;
    const value = text(body[key], max, true);
    if (!value) return null;
    data[key] = value;
  }
  for (const [key, min, max] of [
    ['durationMin', 5, 540],
    ['priceCents', 0, 1_000_000_000],
  ] as const) {
    if (partial && body[key] === undefined) continue;
    const value = integer(body[key], min, max);
    if (value === null || (key === 'durationMin' && value % 5 !== 0)) return null;
    data[key] = value;
  }
  if (!partial || body.active !== undefined) {
    if (body.active !== undefined && typeof body.active !== 'boolean') return null;
    data.active = body.active !== false;
  }
  if (!partial || body.imageUrl !== undefined) {
    const imageUrl = safeImageUrl(body.imageUrl);
    if (imageUrl === undefined) return null;
    data.imageUrl = imageUrl;
  }
  return data;
}

app.post(
  '/api/admin/services/:id/image',
  auth,
  adminOnly,
  // La foto llega como application/octet-stream con su tipo en X-Image-Type: es el único cuerpo binario que
  // el runtime de Vercel entrega intacto en req.body. En local, express.raw lo lee igual (y acepta image/*).
  express.raw({ type: ['application/octet-stream', ...IMAGE_TYPES], limit: IMAGE_LIMIT_BYTES }),
  async (req: AuthedRequest, res) => {
    if ((await limiter.hit(`image:${req.uid}`, HOUR)) > 60)
      return res.status(429).json({ error: 'Se alcanzó el límite temporal de carga de imágenes.' });
    const declared = String(req.headers['x-image-type'] || req.headers['content-type'] || '');
    const mime = declared.split(';')[0].trim().toLowerCase();
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buffer.length > IMAGE_LIMIT_BYTES)
      return res.status(413).json({ error: 'La foto supera 1 MB; súbela desde el panel para que se optimice.' });
    if (!IMAGE_TYPES.includes(mime) || !buffer.length || !imageSignature(buffer, mime))
      return res.status(400).json({ error: 'Imagen inválida. Usa JPG, PNG o WebP.' });
    const service = await db.service.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado.' });
    const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
    return res.status(201).json({ imageUrl: await storage.save(buffer, extension, mime) });
  },
);

app.post('/api/admin/services', auth, adminOnly, async (req, res) => {
  if (!isRecord(req.body) || Object.keys(req.body).some(key => !SERVICE_KEYS.includes(key)))
    return res.status(400).json({ error: 'Datos del servicio inválidos.' });
  const data = serviceFields(req.body);
  if (!data)
    return res.status(400).json({ error: 'Revisa nombre, descripción, categoría, duración, precio e imagen.' });
  const service = await db.service.create({ data: data as Prisma.ServiceCreateInput });
  return res.status(201).json(withSafeImage(service));
});

app.patch('/api/admin/services/:id', auth, adminOnly, async (req, res) => {
  if (!isRecord(req.body) || Object.keys(req.body).some(key => !SERVICE_KEYS.includes(key)))
    return res.status(400).json({ error: 'Datos del servicio inválidos.' });
  const data = serviceFields(req.body, true);
  if (!data) return res.status(400).json({ error: 'Revisa los campos del servicio.' });
  const id = String(req.params.id);
  const before = await db.service.findUnique({ where: { id }, select: { imageUrl: true } });
  if (!before) return res.status(404).json({ error: 'Servicio no encontrado.' });
  const service = await db.service.update({ where: { id }, data });
  // La foto reemplazada se borra del almacén (sin bloquear la respuesta si falla).
  if (before.imageUrl && before.imageUrl !== service.imageUrl)
    storage
      .remove(before.imageUrl)
      .catch(error => console.error(JSON.stringify({ event: 'image_remove_error', message: String(error) })));
  return res.json(withSafeImage(service));
});

// ---------------------------------------------------------------------------
// ERP (servidor a servidor, con x-erp-key)
// ---------------------------------------------------------------------------
app.get('/api/erp/inventory', async (_req, res) =>
  res.json(await db.partsInventory.findMany({ orderBy: { sku: 'asc' } })),
);

app.post('/api/erp/appointments', async (req, res) => {
  if (!isRecord(req.body)) return res.status(400).json({ error: 'Cuerpo de cita inválido.' });
  console.info(JSON.stringify({ event: 'erp_appointment_received', mode: 'mock', at: new Date().toISOString() }));
  return res.status(202).json({ accepted: true, mode: 'mock' });
});

app.post('/api/erp/sync-prices', async (req, res) => {
  const items = isRecord(req.body) ? req.body.items : null;
  if (!Array.isArray(items) || items.length < 1 || items.length > 200)
    return res.status(400).json({ error: 'Envía entre 1 y 200 artículos.' });
  const updates: Array<{ sku: string; priceCents: number; stock: number }> = [];
  for (const entry of items) {
    if (!isRecord(entry)) return res.status(400).json({ error: 'Artículo de sincronización inválido.' });
    const sku = text(entry.sku, 60, true),
      priceCents = integer(entry.priceCents, 0, 1_000_000_000),
      stock = integer(entry.stock, 0, 1_000_000);
    if (!sku || updates.some(item => item.sku === sku) || priceCents === null || stock === null)
      return res.status(400).json({ error: 'SKU, precio o stock inválido.' });
    updates.push({ sku, priceCents, stock });
  }
  try {
    await db.$transaction(
      updates.map(item =>
        db.partsInventory.update({
          where: { sku: item.sku },
          data: { priceCents: item.priceCents, stock: item.stock },
        }),
      ),
    );
    return res.json({ updated: updates.length });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
      return res.status(400).json({ error: 'Algún SKU no existe en el inventario; no se aplicó ningún cambio.' });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Archivos estáticos (sólo fuera de Vercel: allí los sirve su CDN) y errores
// ---------------------------------------------------------------------------
if (storage.kind === 'local' && storage.localDirectory)
  app.use(
    '/uploads',
    express.static(storage.localDirectory, {
      fallthrough: false,
      maxAge: production ? '1d' : 0,
      immutable: production,
    }),
  );
app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta API no encontrada.' }));
const dist = path.resolve(process.cwd(), 'dist');
if (!onVercel && production && existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (error?.type === 'entity.too.large')
    return res.status(413).json({ error: 'La solicitud supera el tamaño permitido.' });
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (error?.message === 'Origen no autorizado') return res.status(403).json({ error: 'Origen no autorizado.' });
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error instanceof StorageNotConfiguredError) return res.status(503).json({ error: error.message });
  const status = Number(error?.status || error?.statusCode);
  if (status === 404) return res.status(404).json({ error: 'No encontrado.' });
  if ((status >= 400 && status < 500) || error instanceof URIError)
    return res.status(status >= 400 && status < 500 ? status : 400).json({ error: 'Solicitud inválida.' });
  console.error(
    JSON.stringify({
      event: 'request_error',
      message: String(error?.message || 'unknown'),
      at: new Date().toISOString(),
    }),
  );
  return res.status(500).json({ error: 'Ocurrió un error al procesar la solicitud.' });
});

export default app;
