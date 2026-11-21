const TZ = 'America/Caracas';

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

/** "desde $20.00" o "precio por consultar" cuando el taller aún no fijó el precio. */
export const priceLabel = (cents: number, prefix = 'desde') =>
  cents > 0 ? `${prefix} ${money(cents)}` : 'precio por consultar';

export const caracasDay = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export const addDays = (day: string, days: number) =>
  caracasDay(new Date(new Date(`${day}T12:00:00-04:00`).getTime() + days * 86_400_000));

export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

export const dayNumber = (iso: string) => new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', timeZone: TZ });

export const monthShort = (iso: string) => new Date(iso).toLocaleDateString('es-VE', { month: 'short', timeZone: TZ });

export const dateLong = (iso: string) =>
  new Date(iso).toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
};
