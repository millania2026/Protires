import { del, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/services\/[a-f0-9-]+\.(?:jpg|png|webp)$/i;
const LOCAL_URL = /^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/;

export class StorageNotConfiguredError extends Error {
  statusCode = 503;
}

export type ImageStorage = {
  kind: 'blob' | 'local' | 'none';
  localDirectory: string | null;
  save(buffer: Buffer, extension: string, contentType: string): Promise<string>;
  remove(url: string): Promise<void>;
};

/** Sólo se publican URLs que generó este sistema; cualquier otro valor guardado se descarta. */
export function safeImageUrl(value: unknown) {
  if (value == null || value === '') return null;
  return typeof value === 'string' && (BLOB_URL.test(value) || LOCAL_URL.test(value)) ? value : undefined;
}

export function createImageStorage(): ImageStorage {
  // En Vercel: Vercel Blob (el disco de una función se borra). La integración crea BLOB_READ_WRITE_TOKEN.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      kind: 'blob',
      localDirectory: null,
      async save(buffer, extension, contentType) {
        const blob = await put(`services/${randomUUID()}.${extension}`, buffer, {
          access: 'public',
          contentType,
          addRandomSuffix: false,
          cacheControlMaxAge: 31_536_000,
        });
        return blob.url;
      },
      async remove(url) {
        if (BLOB_URL.test(url)) await del(url);
      },
    };
  }
  if (process.env.VERCEL) {
    return {
      kind: 'none',
      localDirectory: null,
      async save() {
        throw new StorageNotConfiguredError('Conecta un almacén de Vercel Blob al proyecto para subir fotos.');
      },
      async remove() {},
    };
  }
  // Local / desarrollo: carpeta en disco servida en /uploads.
  const directory = path.resolve(process.env.PUBLIC_UPLOAD_DIR || './uploads');
  return {
    kind: 'local',
    localDirectory: directory,
    async save(buffer, extension) {
      const filename = `${randomUUID()}.${extension}`;
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, filename), buffer, { flag: 'wx' });
      return `/uploads/${filename}`;
    },
    async remove(url) {
      if (LOCAL_URL.test(url)) await unlink(path.join(directory, path.basename(url)));
    },
  };
}
