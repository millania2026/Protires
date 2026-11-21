import { useEffect, useState } from 'react';
import { Car, Plus } from 'lucide-react';
import { apiFetch, errorText } from './api';
import { addDays, caracasDay, priceLabel, timeLabel } from './format';

type Vehicle = { id: string; make: string; model: string; plate: string };
type Service = { id: string; name: string; priceCents: number };
type Slot = { time: string; startsAt: string; available: boolean };
type Availability = { reason: string | null; slots: Slot[] };

// Mismo tope que el servidor (server/schedule.ts → MAX_DAYS_AHEAD).
const MAX_DAYS_AHEAD = 90;

/**
 * Campos de una reserva. La hora se elige entre los turnos que devuelve /api/availability,
 * así el cliente nunca envía un horario que el servidor vaya a rechazar.
 */
export default function BookingFields({
  vehicles,
  services,
  vehicleId,
  onVehicleChange,
  serviceId,
  onServiceChange,
  onAddVehicle,
  refreshKey = 0,
}: {
  vehicles: Vehicle[];
  services: Service[];
  vehicleId: string;
  onVehicleChange: (id: string) => void;
  serviceId: string;
  onServiceChange: (id: string) => void;
  onAddVehicle?: () => void;
  refreshKey?: number;
}) {
  const today = caracasDay(new Date());
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState('');
  const [state, setState] = useState<{ loading: boolean; reason: string | null; slots: Slot[] }>({
    loading: false,
    reason: null,
    slots: [],
  });

  useEffect(() => {
    setSlot('');
    if (!serviceId || !day) {
      setState({ loading: false, reason: null, slots: [] });
      return;
    }
    let cancelled = false;
    setState(current => ({ ...current, loading: true }));
    apiFetch<Availability>('/api/availability?' + new URLSearchParams({ serviceId, date: day }))
      .then(data => !cancelled && setState({ loading: false, reason: data.reason, slots: data.slots }))
      .catch(
        error =>
          !cancelled && setState({ loading: false, reason: errorText(error, 'No se pudo consultar.'), slots: [] }),
      );
    return () => {
      cancelled = true;
    };
  }, [serviceId, day, refreshKey]);

  const open = state.slots.filter(item => item.available);
  const slotPlaceholder = !serviceId
    ? 'Elige servicio'
    : !day
      ? 'Elige fecha'
      : state.loading
        ? 'Cargando…'
        : open.length
          ? 'Elige hora'
          : 'Sin horarios';

  return (
    <>
      <label>Tu vehículo</label>
      <div className="selectrow">
        <Car size={17} />
        <select name="vehicleId" value={vehicleId} onChange={e => onVehicleChange(e.target.value)} required>
          <option value="">{vehicles.length ? 'Selecciona vehículo' : 'Agrega un vehículo'}</option>
          {vehicles.map(v => (
            <option key={v.id} value={v.id}>
              {v.make} {v.model} · {v.plate}
            </option>
          ))}
        </select>
        {onAddVehicle && (
          <button type="button" onClick={onAddVehicle} aria-label="Agregar vehículo">
            <Plus size={17} />
          </button>
        )}
      </div>
      <label>Servicio</label>
      <select
        className="field"
        name="serviceId"
        value={serviceId}
        onChange={e => onServiceChange(e.target.value)}
        required
      >
        <option value="">¿Qué necesita tu auto?</option>
        {services.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} · {priceLabel(s.priceCents)}
          </option>
        ))}
      </select>
      <div className="twocol">
        <div>
          <label>Fecha</label>
          <input
            className="field"
            type="date"
            value={day}
            min={today}
            max={addDays(today, MAX_DAYS_AHEAD)}
            onChange={e => setDay(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Hora</label>
          <select
            className="field"
            name="startsAt"
            value={slot}
            onChange={e => setSlot(e.target.value)}
            disabled={!open.length}
            required
          >
            <option value="">{slotPlaceholder}</option>
            {open.map(item => (
              <option key={item.startsAt} value={item.startsAt}>
                {timeLabel(item.startsAt)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {state.reason && !state.loading && <small className="formHint">{state.reason}</small>}
      <label>
        Notas <small>(opcional)</small>
      </label>
      <input className="field" name="notes" maxLength={1000} placeholder="Cuéntanos qué necesita tu vehículo" />
    </>
  );
}
