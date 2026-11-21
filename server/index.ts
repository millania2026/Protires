import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const secret = process.env.JWT_SECRET || '';
const erpSecret = process.env.ERP_WEBHOOK_KEY || '';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL debe configurarse.');
if (Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET debe configurarse con al menos 32 bytes aleatorios.');
if (Buffer.byteLength(erpSecret) < 32)
  throw new Error('ERP_WEBHOOK_KEY debe configurarse con al menos 32 bytes aleatorios.');
if (secret === erpSecret) throw new Error('JWT_SECRET y ERP_WEBHOOK_KEY deben ser distintos.');

const ISSUER = 'protires-services';
const AUDIENCE = 'protires-portal';
const db = new PrismaClient();
const app = express();
const dummyPasswordHash = await bcrypt.hash(randomUUID(), 12);
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 4000);
const appointmentCapacity = Number(process.env.APPOINTMENT_CAPACITY || 1);
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 1);
const uploadDirectory = path.resolve(process.env.PUBLIC_UPLOAD_DIR || (production ? '/data/uploads' : './uploads'));
const dist = path.resolve(process.cwd(), 'dist');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
if (!Number.isInteger(appointmentCapacity) || appointmentCapacity < 1 || appointmentCapacity > 20)
  throw new Error('APPOINTMENT_CAPACITY debe estar entre 1 y 20.');
if (production && (!Number.isInteger(trustProxyHops) || trustProxyHops < 1 || trustProxyHops > 5))
  throw new Error('TRUST_PROXY_HOPS debe estar entre 1 y 5 en producción.');

app.disable('x-powered-by');
app.set('trust proxy', production ? trustProxyHops : false);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-src https://www.google.com https://maps.google.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  );
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
);
app.use(
  cors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      const local = !production && !!origin && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
      if (!origin || allowedOrigins.has(origin) || local) return callback(null, true);
      return callback(new Error('Origen no autorizado'));
    },
  }),
);
app.use(express.json({ limit: '100kb', strict: true }));

type AuthedRequest = Request & { uid?: string; tokenVersion?: number };
type Limiter = { windowMs: number; limit: number; message: string };
function rateLimit({ windowMs, limit, message }: Limiter) {
  const hits = new Map<string, { count: number; expires: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.expires <= now) entry = { count: 0, expires: now + windowMs };
    entry.count += 1;
    hits.set(key, entry);
    if (hits.size > 10000) for (const [candidate, value] of hits) if (value.expires <= now) hits.delete(candidate);
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
    if (entry.count > limit) return res.status(429).json({ error: message });
    next();
  };
}
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  message: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
});
const bookingLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  message: 'Se alcanzó el límite temporal de solicitudes de cita.',
});
const imageLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  message: 'Se alcanzó el límite temporal de carga de imágenes.',
});

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
function signToken(user: { id: string; tokenVersion: number }) {
  return jwt.sign({ sub: user.id, ver: user.tokenVersion }, secret, {
    algorithm: 'HS256',
    expiresIn: '12h',
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}
async function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as JwtPayload;
    if (typeof payload.sub !== 'string' || !Number.isSafeInteger(payload.ver))
      return res.status(401).json({ error: 'Inicia sesión para continuar' });
    const user = await db.user.findUnique({ where: { id: payload.sub }, select: { tokenVersion: true } });
    if (!user || user.tokenVersion !== payload.ver)
      return res.status(401).json({ error: 'Inicia sesión para continuar' });
    req.uid = payload.sub;
    req.tokenVersion = payload.ver as number;
    next();
  } catch {
    return res.status(401).json({ error: 'Inicia sesión para continuar' });
  }
}
function erpOnly(req: Request, res: Response, next: NextFunction) {
  const supplied = Buffer.from(String(req.headers['x-erp-key'] || ''));
  const expected = Buffer.from(erpSecret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return res.status(401).json({ error: 'Clave ERP inválida' });
  next();
}
async function adminOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const user = await db.user.findUnique({ where: { id: req.uid }, select: { role: true } });
    if (user?.role !== 'ADMIN') return res.status(403).json({ error: 'Acceso exclusivo para administradores' });
    next();
  } catch {
    return res.status(500).json({ error: 'No se pudo validar el acceso' });
  }
}
function safeImageUrl(value: unknown) {
  if (value == null || value === '') return null;
  return typeof value === 'string' && /^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/.test(value) ? value : undefined;
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

app.use('/api/erp', erpOnly);
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const body = req.body;
  const name = isRecord(body) ? text(body.name, 80, true) : null;
  const userEmail = isRecord(body) ? email(body.email) : null;
  const password = isRecord(body) && typeof body.password === 'string' ? body.password : '';
  if (!name || !userEmail || password.length < 10 || password.length > 72)
    return res.status(400).json({ error: 'Revisa nombre, correo y contraseña (10 a 72 caracteres).' });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({ data: { name, email: userEmail, passwordHash } });
    return res
      .status(201)
      .json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch {
    await bcrypt.compare(password, dummyPasswordHash);
    return res.status(409).json({ error: 'No se pudo crear una cuenta con esos datos.' });
  }
});
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const body = req.body;
  const userEmail = isRecord(body) ? email(body.email) : null;
  const password = isRecord(body) && typeof body.password === 'string' ? body.password.slice(0, 72) : '';
  if (!userEmail || !password) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  const user = await db.user.findUnique({ where: { email: userEmail } });
  const matches = await bcrypt.compare(password, user?.passwordHash || dummyPasswordHash);
  if (!user || !matches) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  return res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
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
app.get('/api/services', async (_req, res) => {
  const services = await db.service.findMany({
    where: { active: true },
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
  return res.json(services.map(service => ({ ...service, imageUrl: safeImageUrl(service.imageUrl) })));
});
app.get('/api/vehicles', auth, async (req: AuthedRequest, res) =>
  res.json(await db.vehicle.findMany({ where: { userId: req.uid } })),
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
    return res.status(400).json({ error: 'No se pudo guardar el vehículo.' });
  }
});
app.get('/api/inventory', async (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .toLocaleLowerCase('es');
  const vehicleMake = String(req.query.vehicleMake || '')
    .trim()
    .toLocaleLowerCase('es');
  const vehicleModel = String(req.query.vehicleModel || req.query.vehicle || '')
    .trim()
    .toLocaleLowerCase('es');
  const rows = await db.partsInventory.findMany({ where: { active: true } });
  const contains = (value: string | null | undefined, needle: string) =>
    String(value || '')
      .toLocaleLowerCase('es')
      .includes(needle);
  return res.json(
    rows.filter(item => {
      const searchable = [
        item.name,
        item.sku,
        item.productBrand,
        item.productModel,
        item.vehicleMake,
        item.vehicleModel,
        item.category,
        item.tireSize,
      ].some(value => contains(value, q));
      if (q && !searchable) return false;
      if (!vehicleMake && !vehicleModel) return true;
      if (item.vehicleMake || item.vehicleModel)
        return (
          (!item.vehicleMake || item.vehicleMake.toLocaleLowerCase('es') === vehicleMake) &&
          (!item.vehicleModel || item.vehicleModel.toLocaleLowerCase('es') === vehicleModel)
        );
      const legacy = String(item.compatibility || '').toLocaleLowerCase('es');
      return vehicleModel ? legacy.includes(vehicleModel) : !vehicleMake || legacy.includes(vehicleMake);
    }),
  );
});

app.post('/api/appointments', auth, bookingLimiter, async (req: AuthedRequest, res) => {
  const body = req.body;
  if (!isRecord(body)) return res.status(400).json({ error: 'Datos de la cita inválidos.' });
  const vehicleId = text(body.vehicleId, 64, true),
    serviceId = text(body.serviceId, 64, true);
  const startsAtText = typeof body.startsAt === 'string' ? body.startsAt : '';
  const startsAt = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(startsAtText) ? startsAtText : `${startsAtText}-04:00`);
  const notes = body.notes == null || body.notes === '' ? null : text(body.notes, 1000);
  if (
    !vehicleId ||
    !serviceId ||
    !startsAtText ||
    Number.isNaN(startsAt.getTime()) ||
    startsAt < new Date() ||
    (notes === null && body.notes != null && body.notes !== '')
  )
    return res.status(400).json({ error: 'Revisa vehículo, servicio, fecha y notas.' });
  const [vehicle, service] = await Promise.all([
    db.vehicle.findFirst({ where: { id: vehicleId, userId: req.uid } }),
    db.service.findUnique({ where: { id: serviceId } }),
  ]);
  if (!vehicle || !service || !service.active)
    return res.status(400).json({ error: 'Selecciona un vehículo tuyo y un servicio disponible.' });
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Caracas',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(startsAt);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  const hour = Number(get('hour')),
    minute = Number(get('minute'));
  const startMinute = hour * 60 + minute;
  if (get('weekday') === 'Sun' || startMinute < 510 || startMinute + service.durationMin > 1050)
    return res.status(400).json({ error: 'Horario de atención: 8:30 a. m. a 5:30 p. m., de lunes a sábado.' });
  const dayStart = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00-04:00`);
  const nextDay = new Date(dayStart.getTime() + 86400000);
  const requestedEnd = startsAt.getTime() + service.durationMin * 60000;
  try {
    const appointment = await db.$transaction(async tx => {
      const userPending = await tx.appointment.count({
        where: { userId: req.uid, status: 'PENDING', startsAt: { gte: new Date() } },
      });
      if (userPending >= 2)
        throw Object.assign(
          new Error('Puedes tener hasta dos solicitudes de cita pendientes. Contacta al taller si necesitas ayuda.'),
          { statusCode: 429 },
        );
      const existing = await tx.appointment.findMany({
        where: { startsAt: { gte: dayStart, lt: nextDay }, status: { in: ['PENDING', 'CONFIRMED'] } },
        include: { service: { select: { durationMin: true } } },
      });
      const events: Array<{ time: number; delta: number }> = [
        { time: startsAt.getTime(), delta: 1 },
        { time: requestedEnd, delta: -1 },
      ];
      for (const item of existing) {
        const begin = new Date(item.startsAt).getTime();
        const end = begin + item.service.durationMin * 60000;
        if (begin < requestedEnd && end > startsAt.getTime()) {
          events.push(
            { time: Math.max(begin, startsAt.getTime()), delta: 1 },
            { time: Math.min(end, requestedEnd), delta: -1 },
          );
        }
      }
      events.sort((a, b) => a.time - b.time || a.delta - b.delta);
      let concurrent = 0;
      for (const event of events) {
        concurrent += event.delta;
        if (concurrent > appointmentCapacity)
          throw Object.assign(new Error('Horario ocupado; selecciona otro.'), { statusCode: 409 });
      }
      return tx.appointment.create({
        data: { userId: req.uid!, vehicleId, serviceId, startsAt, notes, estimateCents: service.priceCents },
      });
    });
    return res.status(201).json(appointment);
  } catch (error: any) {
    if (error?.statusCode === 409) return res.status(409).json({ error: error.message });
    if (error?.statusCode === 429) return res.status(429).json({ error: error.message });
    return res.status(400).json({ error: 'No se pudo reservar la cita.' });
  }
});
app.get('/api/appointments', auth, async (req: AuthedRequest, res) => {
  const appointments = await db.appointment.findMany({
    where: { userId: req.uid },
    include: { vehicle: true, service: true },
    orderBy: { startsAt: 'asc' },
  });
  return res.json(
    appointments.map(appointment => ({
      ...appointment,
      service: { ...appointment.service, imageUrl: safeImageUrl(appointment.service.imageUrl) },
    })),
  );
});

app.get('/api/admin/overview', auth, adminOnly, async (_req, res) => {
  const now = new Date();
  const [pending, lowStock, appointments] = await Promise.all([
    db.appointment.count({ where: { status: 'PENDING' } }),
    db.partsInventory.count({ where: { stock: { lte: 4 } } }),
    db.appointment.findMany({
      include: { user: { select: { name: true, email: true } }, vehicle: true, service: true },
      orderBy: { startsAt: 'asc' },
    }),
  ]);
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const today = appointments.filter(
    item =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Caracas',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(item.startsAt) === todayKey,
  ).length;
  return res.json({ pending, lowStock, today });
});
app.get('/api/admin/appointments', auth, adminOnly, async (_req, res) => {
  const appointments = await db.appointment.findMany({
    include: { user: { select: { name: true, email: true } }, vehicle: true, service: true },
    orderBy: { startsAt: 'asc' },
  });
  return res.json(
    appointments.map(appointment => ({
      ...appointment,
      service: { ...appointment.service, imageUrl: safeImageUrl(appointment.service.imageUrl) },
    })),
  );
});
app.patch('/api/admin/appointments/:id', auth, adminOnly, async (req, res) => {
  const status = isRecord(req.body) ? req.body.status : null;
  if (!['CONFIRMED', 'CANCELLED', 'PENDING'].includes(String(status)))
    return res.status(400).json({ error: 'Estado inválido.' });
  try {
    return res.json(
      await db.appointment.update({ where: { id: String(req.params.id) }, data: { status: String(status) } }),
    );
  } catch {
    return res.status(404).json({ error: 'Cita no encontrada.' });
  }
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
  if (
    !sku ||
    !name ||
    !category ||
    priceCents === null ||
    stock === null ||
    (productBrand === null && body.productBrand != null && body.productBrand !== '') ||
    (productModel === null && body.productModel != null && body.productModel !== '') ||
    (vehicleMake === null && body.vehicleMake != null && body.vehicleMake !== '') ||
    (vehicleModel === null && body.vehicleModel != null && body.vehicleModel !== '') ||
    (tireSize === null && body.tireSize != null && body.tireSize !== '') ||
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
  } catch {
    return res.status(400).json({ error: 'SKU duplicado o datos de inventario inválidos.' });
  }
});
app.patch('/api/admin/inventory/:id', auth, adminOnly, async (req, res) => {
  if (!isRecord(req.body)) return res.status(400).json({ error: 'Artículo inválido.' });
  const allowed = [
    'sku',
    'name',
    'category',
    'compatibility',
    'productBrand',
    'productModel',
    'vehicleMake',
    'vehicleModel',
    'tireSize',
    'priceCents',
    'stock',
    'active',
  ];
  if (Object.keys(req.body).some(key => !allowed.includes(key)))
    return res.status(400).json({ error: 'El artículo contiene campos no permitidos.' });
  const data: Record<string, unknown> = {};
  for (const key of [
    'sku',
    'name',
    'category',
    'compatibility',
    'productBrand',
    'productModel',
    'vehicleMake',
    'vehicleModel',
    'tireSize',
  ]) {
    if (req.body[key] === undefined) continue;
    const max =
      key === 'name'
        ? 120
        : key === 'compatibility'
          ? 180
          : key === 'sku'
            ? 60
            : key === 'category'
              ? 60
              : key === 'tireSize'
                ? 30
                : 80;
    const optional = ['productBrand', 'productModel', 'vehicleMake', 'vehicleModel', 'tireSize'].includes(key);
    const value =
      req.body[key] == null || req.body[key] === '' ? (optional ? null : '') : text(req.body[key], max, !optional);
    if (
      (value === null && !optional) ||
      (value === null && req.body[key] != null && req.body[key] !== '') ||
      value === ''
    )
      return res.status(400).json({ error: 'Campo de artículo inválido.' });
    data[key] = value;
  }
  for (const key of ['priceCents', 'stock'])
    if (req.body[key] !== undefined) {
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
  } catch {
    return res.status(400).json({ error: 'No se pudo guardar el artículo.' });
  }
});
app.get('/api/admin/services', auth, adminOnly, async (_req, res) => {
  const services = await db.service.findMany({ orderBy: { category: 'asc' } });
  return res.json(services.map(service => ({ ...service, imageUrl: safeImageUrl(service.imageUrl) })));
});
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
    ['durationMin', 5, 720],
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
  imageLimiter,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '200kb' }),
  async (req: AuthedRequest, res) => {
    const mime = req.headers['content-type']?.split(';')[0].trim() || '';
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length || !imageSignature(buffer, mime))
      return res.status(400).json({ error: 'Imagen inválida. Usa JPG, PNG o WebP.' });
    const service = await db.service.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado.' });
    const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
    const filename = `${randomUUID()}.${extension}`;
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(path.join(uploadDirectory, filename), buffer, { flag: 'wx' });
    return res.status(201).json({ imageUrl: `/uploads/${filename}` });
  },
);
app.post('/api/admin/services', auth, adminOnly, async (req, res) => {
  if (
    !isRecord(req.body) ||
    Object.keys(req.body).some(
      key => !['name', 'description', 'category', 'durationMin', 'priceCents', 'active', 'imageUrl'].includes(key),
    )
  )
    return res.status(400).json({ error: 'Datos del servicio inválidos.' });
  const data = serviceFields(req.body);
  if (!data)
    return res.status(400).json({ error: 'Revisa nombre, descripción, categoría, duración, precio e imagen.' });
  try {
    return res.status(201).json(await db.service.create({ data: data as Prisma.ServiceCreateInput }));
  } catch {
    return res.status(400).json({ error: 'No se pudo crear el servicio.' });
  }
});
app.patch('/api/admin/services/:id', auth, adminOnly, async (req, res) => {
  if (
    !isRecord(req.body) ||
    Object.keys(req.body).some(
      key => !['name', 'description', 'category', 'durationMin', 'priceCents', 'active', 'imageUrl'].includes(key),
    )
  )
    return res.status(400).json({ error: 'Datos del servicio inválidos.' });
  const data = serviceFields(req.body, true);
  if (!data) return res.status(400).json({ error: 'Revisa los campos del servicio.' });
  try {
    return res.json(await db.service.update({ where: { id: String(req.params.id) }, data }));
  } catch {
    return res.status(400).json({ error: 'No se pudo actualizar el servicio.' });
  }
});

app.get('/api/erp/inventory', async (_req, res) => res.json(await db.partsInventory.findMany()));
app.post('/api/erp/appointments', async (req, res) => {
  if (!isRecord(req.body)) return res.status(400).json({ error: 'Cuerpo de cita inválido.' });
  console.info(JSON.stringify({ event: 'erp_appointment_received', mode: 'mock', at: new Date().toISOString() }));
  return res.status(202).json({ accepted: true, mode: 'mock' });
});
app.post('/api/erp/sync-prices', async (req, res) => {
  const items = isRecord(req.body) ? req.body.items : null;
  if (!Array.isArray(items) || items.length < 1 || items.length > 200)
    return res.status(400).json({ error: 'Envía entre 1 y 200 artículos.' });
  const seen = new Set<string>();
  for (const entry of items) {
    if (!isRecord(entry)) return res.status(400).json({ error: 'Artículo de sincronización inválido.' });
    const sku = text(entry.sku, 60, true),
      priceCents = integer(entry.priceCents, 0, 1_000_000_000),
      stock = integer(entry.stock, 0, 1_000_000);
    if (!sku || seen.has(sku) || priceCents === null || stock === null)
      return res.status(400).json({ error: 'SKU, precio o stock inválido.' });
    seen.add(sku);
  }
  try {
    await db.$transaction(
      items.map(entry =>
        db.partsInventory.update({
          where: { sku: String((entry as Record<string, unknown>).sku).trim() },
          data: {
            priceCents: Number((entry as Record<string, unknown>).priceCents),
            stock: Number((entry as Record<string, unknown>).stock),
          },
        }),
      ),
    );
    return res.json({ updated: items.length });
  } catch {
    return res.status(400).json({ error: 'SKU inexistente o sincronización fallida.' });
  }
});

app.use(
  '/uploads',
  express.static(uploadDirectory, { fallthrough: false, maxAge: production ? '1d' : 0, immutable: true }),
);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta API no encontrada.' }));
if (production && existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error?.type === 'entity.too.large')
    return res.status(413).json({ error: 'La solicitud supera el tamaño permitido.' });
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (error?.message === 'Origen no autorizado') return res.status(403).json({ error: 'Origen no autorizado.' });
  console.error(
    JSON.stringify({
      event: 'request_error',
      message: String(error?.message || 'unknown'),
      at: new Date().toISOString(),
    }),
  );
  return res.status(500).json({ error: 'Ocurrió un error al procesar la solicitud.' });
});

app.listen(port, '0.0.0.0', () => console.log(`Aplicación disponible en el puerto ${port}`));
