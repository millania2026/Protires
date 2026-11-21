import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const db = new PrismaClient();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

try {
  const databases = await db.$queryRawUnsafe<Array<{ name: string; file: string }>>('PRAGMA database_list');
  const source = databases.find(database => database.name === 'main')?.file;
  if (!source) throw new Error('No se pudo resolver la ruta de la base SQLite.');
  const directory = path.resolve(process.env.DATABASE_BACKUP_DIR || './backups');
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `protires-${stamp}.db`);
  const escaped = destination.replace(/'/g, "''");
  await db.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);

  const countRows = async (client: PrismaClient) => ({
    users: await client.user.count(),
    vehicles: await client.vehicle.count(),
    services: await client.service.count(),
    appointments: await client.appointment.count(),
    inventory: await client.partsInventory.count(),
  });
  const originalCounts = await countRows(db);
  const copy = new PrismaClient({ datasources: { db: { url: `file:${destination.replace(/\\/g, '/')}` } } });
  try {
    const integrity = await copy.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
    const backupCounts = await countRows(copy);
    if (integrity[0]?.integrity_check !== 'ok') throw new Error('La copia no pasó PRAGMA integrity_check.');
    if (JSON.stringify(originalCounts) !== JSON.stringify(backupCounts))
      throw new Error('La copia no coincide con la base original.');
    console.log(
      JSON.stringify(
        { backup: destination, integrity: integrity[0].integrity_check, countsMatch: true, counts: backupCounts },
        null,
        2,
      ),
    );
  } finally {
    await copy.$disconnect();
  }
} finally {
  await db.$disconnect();
}
