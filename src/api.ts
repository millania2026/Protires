/** El token guardado ya no sirve (venció, se cerró la sesión o cambió la contraseña). */
export class SessionExpiredError extends Error {}

type Options = { method?: string; token?: string; body?: unknown; raw?: Blob };

/** fetch a la API con mensajes en español y detección de sesión vencida. */
export async function apiFetch<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = 'Bearer ' + options.token;
  let body: BodyInit | undefined;
  if (options.raw) {
    // Binario como octet-stream (Vercel lo entrega intacto); el tipo real va aparte.
    body = options.raw;
    headers['Content-Type'] = 'application/octet-stream';
    headers['X-Image-Type'] = options.raw.type;
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(path, { method: options.method || (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new Error('No responde el servidor. Revisa tu conexión e inténtalo de nuevo.');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (response.status === 401 && options.token)
    throw new SessionExpiredError(data?.error || 'Tu sesión terminó. Inicia sesión de nuevo.');
  if (!response.ok) throw new Error(data?.error || `No se pudo completar la solicitud (${response.status}).`);
  return data as T;
}

export const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
