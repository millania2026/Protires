import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Copia portátil de toda la base en un JSON (además de la restauración a un punto en el tiempo de Neon).
// Contiene correos y hashes de contraseñas: guárdala fuera del repositorio y en un lugar privado.
const db = new PrismaClient();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

try {
  const data = {
    users: await db.user.findMany(),
    vehicles: await db.vehicle.findMany(),
    services: await db.service.findMany(),
    appointments: await db.appointment.findMany(),
    inventory: await db.partsInventory.findMany(),
  };
  const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
  const directory = path.resolve(process.env.DATABASE_BACKUP_DIR || './backups');
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `protires-${stamp}.json`);
  await writeFile(destination, JSON.stringify({ exportedAt: new Date().toISOString(), counts, data }, null, 2), {
    flag: 'wx',
  });
  const reread = JSON.parse(await readFile(destination, 'utf8')) as { counts: Record<string, number> };
  if (JSON.stringify(reread.counts) !== JSON.stringify(counts)) throw new Error('La copia no coincide con la base.');
  console.log(JSON.stringify({ backup: destination, countsMatch: true, counts }, null, 2));
} finally {
  await db.$disconnect();
}
