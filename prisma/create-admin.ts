import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL) throw new Error('Configura DATABASE_URL antes de crear el administrador.');
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase() || '';
const password = process.env.ADMIN_PASSWORD || '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL debe ser un correo válido.');
if (password.length < 14 || password.length > 72) throw new Error('ADMIN_PASSWORD debe tener entre 14 y 72 caracteres.');
if (['admin@protires.local', 'demo@protires.local'].includes(email)) throw new Error('No uses una dirección demo para el administrador.');

const db = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 12);
  const revokedHash = await bcrypt.hash(randomUUID(), 12);
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new Error('Ya existe una cuenta con ADMIN_EMAIL.');
  const admin = await db.$transaction(async tx => {
    await tx.user.updateMany({
      where: { email: { in: ['admin@protires.local', 'demo@protires.local'] } },
      data: { passwordHash: revokedHash, role: 'CUSTOMER', tokenVersion: { increment: 1 } },
    });
    return tx.user.create({ data: { name: 'Administrador Protires', email, passwordHash, role: 'ADMIN' } });
  });
  console.log(`Administrador creado: ${admin.email}`);
} finally {
  await db.$disconnect();
}
