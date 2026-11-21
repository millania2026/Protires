import type { PrismaClient } from '@prisma/client';

/**
 * Contadores de intentos en Postgres, compartidos por todas las instancias de Vercel.
 * Si la base falla, el límite deja pasar (fail-open) y lo registra: nunca bloquea a un cliente por un error propio.
 */
export function createRateLimiter(db: PrismaClient) {
  async function hit(key: string, windowMs: number): Promise<number> {
    try {
      const now = BigInt(Date.now());
      const expires = now + BigInt(windowMs);
      const rows = await db.$queryRaw<Array<{ count: number }>>`
        INSERT INTO "RateLimit" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expires})
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "RateLimit"."expiresAt" <= ${now} THEN 1 ELSE "RateLimit"."count" + 1 END,
          "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= ${now} THEN ${expires} ELSE "RateLimit"."expiresAt" END
        RETURNING "count"`;
      if (Math.random() < 0.02) void sweep();
      return Number(rows[0]?.count ?? 0);
    } catch (error) {
      console.error(JSON.stringify({ event: 'rate_limit_error', key: key.split(':')[0], message: String(error) }));
      return 0;
    }
  }

  async function peek(key: string): Promise<number> {
    try {
      const row = await db.rateLimit.findUnique({ where: { key } });
      return row && row.expiresAt > BigInt(Date.now()) ? row.count : 0;
    } catch (error) {
      console.error(JSON.stringify({ event: 'rate_limit_error', key: key.split(':')[0], message: String(error) }));
      return 0;
    }
  }

  async function clear(key: string) {
    try {
      await db.rateLimit.deleteMany({ where: { key } });
    } catch {
      // No es crítico: el contador vence solo.
    }
  }

  async function sweep() {
    try {
      await db.rateLimit.deleteMany({ where: { expiresAt: { lt: BigInt(Date.now()) } } });
    } catch {
      // Limpieza oportunista; se reintenta en otra petición.
    }
  }

  return { hit, peek, clear };
}
