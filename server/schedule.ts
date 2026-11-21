// Reglas de horario del taller (Caracas, UTC-4 fijo desde 2016, sin horario de verano).
export const CARACAS_OFFSET = '-04:00';
export const OPEN_MINUTE = 8 * 60 + 30; // 8:30 a. m.
export const CLOSE_MINUTE = 17 * 60 + 30; // 5:30 p. m.
export const SLOT_STEP_MINUTES = 30; // turnos que ofrece el portal
export const MAX_DAYS_AHEAD = 90; // evita reservas a años vista que bloquean la agenda

export type Interval = { begin: number; end: number };

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Caracas',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function caracasParts(date: Date) {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return {
    weekday: get('weekday'),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Inicio (00:00 en Caracas) del día `YYYY-MM-DD`. */
export function caracasDayStart(day: string) {
  return new Date(`${day}T00:00:00${CARACAS_OFFSET}`);
}

/** Interpreta la fecha del formulario; sin zona horaria se asume hora de Caracas. */
export function parseStartsAt(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const textValue = value.trim();
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(textValue) ? textValue : `${textValue}${CARACAS_OFFSET}`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** null si el horario es válido; si no, el motivo para el cliente. */
export function scheduleProblem(startsAt: Date, durationMin: number, now = new Date()) {
  if (startsAt.getTime() <= now.getTime()) return 'Elige una fecha y hora futuras.';
  if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000)
    return `Puedes reservar con hasta ${MAX_DAYS_AHEAD} días de anticipación.`;
  const { weekday, minute } = caracasParts(startsAt);
  if (weekday === 'Sun' || minute < OPEN_MINUTE || minute + durationMin > CLOSE_MINUTE)
    return 'Horario de atención: lunes a sábado, de 8:30 a. m. a 5:30 p. m.';
  return null;
}

/** ¿Cabe una cita [start, end) sin superar `capacity` citas simultáneas? */
export function fitsCapacity(existing: Interval[], start: number, end: number, capacity: number) {
  const events: Array<{ time: number; delta: number }> = [
    { time: start, delta: 1 },
    { time: end, delta: -1 },
  ];
  for (const item of existing) {
    if (item.begin < end && item.end > start) {
      events.push({ time: Math.max(item.begin, start), delta: 1 }, { time: Math.min(item.end, end), delta: -1 });
    }
  }
  // A igual hora, primero salen y luego entran: dos citas seguidas no se cuentan como simultáneas.
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let concurrent = 0;
  for (const event of events) {
    concurrent += event.delta;
    if (concurrent > capacity) return false;
  }
  return true;
}

/** Turnos del día para un servicio de `durationMin` minutos. */
export function daySlots(day: string, durationMin: number) {
  const start = caracasDayStart(day).getTime();
  const slots: Array<{ time: string; startsAt: Date }> = [];
  for (let minute = OPEN_MINUTE; minute + durationMin <= CLOSE_MINUTE; minute += SLOT_STEP_MINUTES) {
    const hh = String(Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    slots.push({ time: `${hh}:${mm}`, startsAt: new Date(start + minute * 60_000) });
  }
  return slots;
}
