import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const db = new PrismaClient();
const directory = path.resolve(
  process.env.PUBLIC_UPLOAD_DIR || (process.env.NODE_ENV === 'production' ? '/data/uploads' : './uploads'),
);
const maxBytes = 200 * 1024;
function imageType(value: string) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  const mime = `image/${match[1]}`;
  const bytes = Buffer.from(match[2], 'base64');
  const valid =
    mime === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mime === 'image/png'
        ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid || bytes.length > maxBytes) return null;
  const extension = mime === 'image/jpeg' ? 'jpg' : match[1];
  return { bytes, extension };
}

let migrated = 0;
let removed = 0;
try {
  await mkdir(directory, { recursive: true });
  const services = await db.service.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });
  for (const service of services) {
    const current = service.imageUrl || '';
    if (/^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/.test(current)) continue;
    const image = imageType(current);
    if (!image) {
      await db.service.update({ where: { id: service.id }, data: { imageUrl: null } });
      removed += 1;
      continue;
    }
    const filename = `${randomUUID()}.${image.extension}`;
    await writeFile(path.join(directory, filename), image.bytes, { flag: 'wx' });
    await db.service.update({ where: { id: service.id }, data: { imageUrl: `/uploads/${filename}` } });
    migrated += 1;
  }
  console.log(
    JSON.stringify({
      migrated,
      removed,
      message: removed
        ? 'Removed invalid, remote, or over-200KB images; re-upload optimized originals from the admin.'
        : 'Legacy service images are now file-backed.',
    }),
  );
} finally {
  await db.$disconnect();
}
