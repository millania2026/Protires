import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Disc3,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
type Item = {
  id: string;
  sku: string;
  name: string;
  category: string;
  productBrand?: string | null;
  productModel?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  priceCents: number;
  stock: number;
  compatibility: string;
  tireSize?: string | null;
  active: boolean;
};
type Appt = {
  id: string;
  startsAt: string;
  status: string;
  notes?: string | null;
  estimateCents: number;
  user: { name: string; email: string };
  vehicle: { make: string; model: string; plate: string };
  service: { name: string };
};
type Service = {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  active: boolean;
  durationMin: number;
  imageUrl?: string | null;
};
const cash = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const toCents = (amount: unknown) => Math.round(Number(amount) * 100);
const caracasDay = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
const sampleItems: Item[] = [
  {
    id: 'demo-tire',
    sku: 'TIRE-2755022',
    name: 'Caucho all terrain 275/50 R22',
    category: 'Cauchos',
    priceCents: 19581,
    stock: 4,
    compatibility: 'Armada',
    productBrand: 'Roadcruza',
    productModel: 'RA1100',
    vehicleMake: 'Nissan',
    vehicleModel: 'Armada',
    active: true,
    tireSize: '275/50 R22',
  },
  {
    id: 'demo-oil',
    sku: 'OIL-5W30',
    name: 'Aceite sintético 5W-30 (4L)',
    category: 'Lubricantes',
    priceCents: 3392,
    stock: 12,
    compatibility: 'Corolla,Civic,Mazda 3',
    productBrand: 'Toyota',
    productModel: '5W-30',
    active: true,
  },
];
const requestedServices: Service[] = [
  {
    id: 'offline-service-0',
    name: 'Alineación',
    category: 'Cauchera',
    description: 'Alineación de ruedas para estabilidad y desgaste uniforme.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-1',
    name: 'Balanceo estático',
    category: 'Cauchera',
    description: 'Balanceo estático de ruedas.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-2',
    name: 'Balanceo dinámico',
    category: 'Cauchera',
    description: 'Balanceo dinámico para corregir vibraciones.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-3',
    name: 'Reparación de cauchos',
    category: 'Cauchera',
    description: 'Inspección y reparación de cauchos.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-4',
    name: 'Instalación de sistemas de blindaje para cauchos',
    category: 'Cauchera',
    description: 'Instalación de sistemas de blindaje para cauchos.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-5',
    name: 'Sensores TPMS',
    category: 'Cauchera',
    description: 'Servicio de sensores de presión TPMS.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-6',
    name: 'Mecánica ligera (tren delantero y trasero)',
    category: 'Mecánica',
    description: 'Mecánica ligera para tren delantero y trasero.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-7',
    name: 'Frenos',
    category: 'Mecánica',
    description: 'Revisión y servicio del sistema de frenos.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-8',
    name: 'Servicio de escáner y entonación',
    category: 'Mecánica',
    description: 'Diagnóstico electrónico y entonación.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-9',
    name: 'Limpieza de inyectores',
    category: 'Mecánica',
    description: 'Limpieza del sistema de inyección.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
  {
    id: 'offline-service-10',
    name: 'Rectificación de discos de freno',
    category: 'Mecánica',
    description: 'Evaluación y rectificación de discos.',
    priceCents: 0,
    durationMin: 30,
    active: true,
  },
];
const sampleAppointments: Appt[] = [
  {
    id: 'demo-pending',
    startsAt: new Date(Date.now() + 259200000).toISOString(),
    status: 'PENDING',
    notes: 'Solicitud para revisar frenos',
    estimateCents: 2578,
    user: { name: 'Alex Demo', email: 'demo@protires.local' },
    vehicle: { make: 'Nissan', model: 'Armada', plate: 'DEMO-01' },
    service: { name: 'Revisión de frenos' },
  },
  {
    id: 'demo-confirmed',
    startsAt: new Date(Date.now() + 172800000).toISOString(),
    status: 'CONFIRMED',
    notes: 'Revisar vibración en carretera',
    estimateCents: 3918,
    user: { name: 'Alex Demo', email: 'demo@protires.local' },
    vehicle: { make: 'Nissan', model: 'Armada', plate: 'DEMO-01' },
    service: { name: 'Alineación y balanceo' },
  },
];
export default function AdminPanel({
  token,
  demoMode,
  onLogout,
}: {
  token: string;
  demoMode: boolean;
  onLogout: () => void;
}) {
  const [tab, ST] = useState<'appointments' | 'inventory' | 'services'>('appointments'),
    [items, SI] = useState<Item[]>(demoMode ? sampleItems : []),
    [appts, SA] = useState<Appt[]>(demoMode ? sampleAppointments : []),
    [services, SS] = useState<Service[]>(demoMode ? requestedServices : []),
    [fallback, SF] = useState(demoMode),
    [modal, SM] = useState(false),
    [itemEditor, EI] = useState<Item | null>(null),
    [serviceEditor, SE] = useState<'create' | Service | null>(null),
    [query, SQ] = useState(''),
    [message, SN] = useState('');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  useEffect(() => {
    if (demoMode) return;
    let failed = false;
    Promise.all([
      fetch('/api/admin/appointments', { headers }).then(r => (r.ok ? r.json() : Promise.reject())),
      fetch('/api/admin/inventory', { headers }).then(r => (r.ok ? r.json() : Promise.reject())),
      fetch('/api/admin/services', { headers }).then(r => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([a, i, s]) => {
        SA(a);
        SI(i);
        SS(s);
      })
      .catch(() => {
        failed = true;
        if (!import.meta.env.DEV) {
          SN('No se pudo cargar la administración. Verifica el servidor.');
          return;
        }
        SF(true);
        SA(sampleAppointments);
        SI(sampleItems);
        SS(requestedServices);
      });
    return () => {
      failed = true;
    };
  }, [token, demoMode]);
  async function changeStatus(id: string, status: string) {
    if (fallback) {
      SA(x => x.map(a => (a.id === id ? { ...a, status } : a)));
      SN(status === 'CONFIRMED' ? 'Cita aceptada' : 'Cita rechazada');
      return;
    }
    try {
      const r = await fetch(`/api/admin/appointments/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw Error();
      SA(x => x.map(a => (a.id === id ? { ...a, status } : a)));
      SN(status === 'CONFIRMED' ? 'Cita aceptada' : 'Cita rechazada');
    } catch {
      SN('No se pudo actualizar la cita');
    }
  }
  async function addItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget)),
      vehicleMake = String(d.vehicleMake || '').trim(),
      vehicleModel = String(d.vehicleModel || '').trim(),
      item = {
        id: 'new-' + Date.now(),
        sku: String(d.sku).trim(),
        name: String(d.name).trim(),
        category: String(d.category).trim(),
        productBrand: String(d.productBrand || '').trim() || null,
        productModel: String(d.productModel || '').trim() || null,
        vehicleMake: vehicleMake || null,
        vehicleModel: vehicleModel || null,
        priceCents: toCents(d.priceCents),
        stock: Number(d.stock),
        compatibility: [vehicleMake, vehicleModel].filter(Boolean).join(' '),
        tireSize: String(d.tireSize || '').trim() || null,
        active: true,
      };
    if (fallback) {
      SI(x => [item, ...x]);
      SM(false);
      SN('Artículo agregado al demo');
      return;
    }
    try {
      const r = await fetch('/api/admin/inventory', { method: 'POST', headers, body: JSON.stringify(item) }),
        saved = await r.json();
      if (!r.ok) throw Error(saved.error);
      SI(x => [saved, ...x]);
      SM(false);
      SN('Artículo agregado');
    } catch (err) {
      SN(err instanceof Error ? err.message : 'No se pudo agregar el artículo');
    }
  }
  async function saveItem(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget)),
      vehicleMake = String(d.vehicleMake || '').trim(),
      vehicleModel = String(d.vehicleModel || '').trim(),
      data = {
        sku: String(d.sku).trim(),
        name: String(d.name).trim(),
        category: String(d.category).trim(),
        productBrand: String(d.productBrand || '').trim() || null,
        productModel: String(d.productModel || '').trim() || null,
        vehicleMake: vehicleMake || null,
        vehicleModel: vehicleModel || null,
        compatibility:
          [vehicleMake, vehicleModel].filter(Boolean).join(' ') || items.find(i => i.id === id)?.compatibility || '',
        tireSize: String(d.tireSize || '').trim() || null,
        priceCents: toCents(d.priceCents),
        stock: Number(d.stock),
        active: d.active === 'on',
      };
    if (fallback) {
      SI(x => x.map(i => (i.id === id ? { ...i, ...data } : i)));
      EI(null);
      SN('Artículo actualizado en demo');
      return;
    }
    try {
      const r = await fetch('/api/admin/inventory/' + id, { method: 'PATCH', headers, body: JSON.stringify(data) }),
        saved = await r.json();
      if (!r.ok) throw Error(saved.error);
      SI(x => x.map(i => (i.id === id ? saved : i)));
      EI(null);
      SN('Artículo actualizado');
    } catch (err) {
      SN(err instanceof Error ? err.message : 'No se pudo guardar el artículo');
    }
  }
  async function toggleItem(item: Item) {
    const active = !item.active;
    if (fallback) {
      SI(x => x.map(i => (i.id === item.id ? { ...i, active } : i)));
      SN(active ? 'Artículo activado en la web demo' : 'Artículo inactivado en la web demo');
      return;
    }
    try {
      const r = await fetch('/api/admin/inventory/' + item.id, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ active }),
        }),
        saved = await r.json();
      if (!r.ok) throw Error(saved.error);
      SI(x => x.map(i => (i.id === item.id ? saved : i)));
      SN(active ? 'Artículo activado en la web' : 'Artículo inactivado en la web');
    } catch (err) {
      SN(err instanceof Error ? err.message : 'No se pudo cambiar la visibilidad');
    }
  }
  async function serviceFormData(form: HTMLFormElement) {
    const d = Object.fromEntries(new FormData(form));
    const file = d.image as File;
    return {
      data: {
        name: String(d.name).trim(),
        description: String(d.description).trim(),
        category: String(d.category).trim(),
        durationMin: Number(d.durationMin),
        priceCents: toCents(d.priceCents),
        active: d.active === 'on',
        imageUrl: String(d.imageUrl || '') || null,
      },
      file: file && file.size ? file : null,
    };
  }
  async function persistServiceImage(id: string, file: File | null, data: Record<string, unknown>) {
    if (!file) return data;
    if (file.size > 200 * 1024) throw new Error('La foto debe pesar como máximo 200 KB.');
    const upload = await fetch('/api/admin/services/' + id + '/image', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': file.type },
        body: file,
      }),
      result = await upload.json();
    if (!upload.ok) throw Error(result.error || 'No se pudo cargar la imagen');
    const update = await fetch('/api/admin/services/' + id, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ imageUrl: result.imageUrl }),
      }),
      saved = await update.json();
    if (!update.ok) throw Error(saved.error || 'No se pudo vincular la imagen');
    return { ...data, ...saved };
  }
  async function saveService(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const form = await serviceFormData(e.currentTarget),
      data = form.data;
    if (fallback) {
      SS(x => x.map(s => (s.id === id ? { ...s, ...data } : s)));
      SE(null);
      SN('Servicio actualizado en demo');
      return;
    }
    try {
      const r = await fetch('/api/admin/services/' + id, { method: 'PATCH', headers, body: JSON.stringify(data) });
      let saved = await r.json();
      if (!r.ok) throw Error(saved.error);
      saved = await persistServiceImage(id, form.file, saved);
      SS(x => x.map(s => (s.id === id ? saved : s)));
      SE(null);
      SN('Servicio actualizado');
    } catch (err) {
      SN(err instanceof Error ? err.message : 'No se pudo guardar el servicio');
    }
  }
  async function createService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = await serviceFormData(e.currentTarget),
      data = form.data;
    if (fallback) {
      SS(x => [{ ...data, id: 'demo-service-' + Date.now() }, ...x]);
      SE(null);
      SN('Servicio creado en demo');
      return;
    }
    try {
      const r = await fetch('/api/admin/services', { method: 'POST', headers, body: JSON.stringify(data) });
      let saved = await r.json();
      if (!r.ok) throw Error(saved.error);
      saved = await persistServiceImage(saved.id, form.file, saved);
      SS(x => [...x, saved].sort((a, b) => a.category.localeCompare(b.category, 'es')));
      SE(null);
      SN('Servicio creado');
    } catch (err) {
      SN(err instanceof Error ? err.message : 'No se pudo crear el servicio');
    }
  }
  const pending = appts.filter(a => a.status === 'PENDING').length,
    low = items.filter(i => i.stock <= 4).length;
  return (
    <div className="adminApp">
      <aside className="adminSide">
        <a className="adminBrand" href="#">
          <img src="/images/protires-logo.png" alt="Pro Tires Services" />
        </a>
        <div className="adminLabel">OPERACIONES</div>
        <button className={tab === 'appointments' ? 'selected' : ''} onClick={() => ST('appointments')}>
          <Activity size={17} /> Citas <span>{pending}</span>
        </button>
        <button className={tab === 'inventory' ? 'selected' : ''} onClick={() => ST('inventory')}>
          <Package size={17} /> Inventario {low > 0 && <span>{low}</span>}
        </button>
        <button className={tab === 'services' ? 'selected' : ''} onClick={() => ST('services')}>
          <Settings2 size={17} /> Servicios y precios
        </button>
        <div className="adminSideBottom">
          <div className="adminSecure">
            <ShieldCheck size={17} />
            <span>
              Panel protegido<small>Acceso administrador</small>
            </span>
          </div>
          <button onClick={onLogout}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="adminMain">
        <header className="adminTop">
          <div>
            <small>PRO TIRES SERVICES / ADMINISTRACIÓN</small>
            <h1>{tab === 'appointments' ? 'Citas' : tab === 'inventory' ? 'Inventario' : 'Servicios y precios'}</h1>
          </div>
          <div className="adminTopRight">
            <span className="adminLive">
              <i /> {fallback ? 'MODO DEMO' : 'SISTEMA ACTIVO'}
            </span>
            <span className="adminAvatar">PT</span>
          </div>
        </header>
        <div className="adminContent">
          <div className="adminWelcome">
            <div>
              <b>Centro de operaciones</b>
              <p>Gestiona la atención y mantén el catálogo al día.</p>
            </div>
            <button className="adminRefresh" onClick={() => location.reload()}>
              <RefreshCw size={15} /> Actualizar
            </button>
          </div>
          <div className="adminMetrics">
            <article>
              <div className="metricIcon amber">
                <Clock />
              </div>
              <div>
                <small>PENDIENTES</small>
                <b>{pending}</b>
                <span>Requieren respuesta</span>
              </div>
            </article>
            <article>
              <div className="metricIcon green">
                <CalendarDaysIcon />
              </div>
              <div>
                <small>CITAS DE HOY</small>
                <b>{appts.filter(a => caracasDay(new Date(a.startsAt)) === caracasDay(new Date())).length}</b>
                <span>En agenda</span>
              </div>
            </article>
            <article>
              <div className="metricIcon coral">
                <Package />
              </div>
              <div>
                <small>STOCK BAJO</small>
                <b>{low}</b>
                <span>4 unidades o menos</span>
              </div>
            </article>
            <article>
              <div className="metricIcon slate">
                <Users />
              </div>
              <div>
                <small>CITAS REGISTRADAS</small>
                <b>{appts.length}</b>
                <span>Todos los estados</span>
              </div>
            </article>
          </div>
          {tab === 'appointments' && (
            <section className="adminCard">
              <div className="adminCardHead">
                <div>
                  <small>AGENDA DEL TALLER</small>
                  <h2>Solicitudes de cita</h2>
                </div>
                <div className="adminFilters">
                  <button className="filterActive">
                    Todas <b>{appts.length}</b>
                  </button>
                  <button>
                    Pendientes <b>{pending}</b>
                  </button>
                </div>
              </div>
              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>CLIENTE</th>
                      <th>VEHÍCULO</th>
                      <th>SERVICIO</th>
                      <th>FECHA Y HORA</th>
                      <th>ESTIMADO</th>
                      <th>ESTADO / ACCIÓN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appts.map(a => (
                      <tr key={a.id}>
                        <td>
                          <b>{a.user.name}</b>
                          <small>{a.user.email}</small>
                        </td>
                        <td>
                          {a.vehicle.make} {a.vehicle.model}
                          <small>Placa: {a.vehicle.plate}</small>
                        </td>
                        <td>
                          {a.service.name}
                          <small>{a.notes || 'Sin notas adicionales'}</small>
                        </td>
                        <td>
                          {new Date(a.startsAt).toLocaleDateString('es-VE', {
                            day: '2-digit',
                            month: 'short',
                            timeZone: 'America/Caracas',
                          })}
                          <small>
                            {new Date(a.startsAt).toLocaleTimeString('es-VE', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'America/Caracas',
                            })}
                          </small>
                        </td>
                        <td>{a.estimateCents > 0 ? cash(a.estimateCents) : 'Por cotizar'}</td>
                        <td>
                          <div className="appointmentActions">
                            <span className={'statusTag ' + a.status.toLowerCase()}>
                              {a.status === 'PENDING'
                                ? 'Pendiente'
                                : a.status === 'CONFIRMED'
                                  ? 'Aceptada'
                                  : 'Rechazada'}
                            </span>
                            {a.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  className="acceptBtn"
                                  onClick={() => changeStatus(a.id, 'CONFIRMED')}
                                  title="Aceptar cita"
                                >
                                  <Check size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="rejectBtn"
                                  onClick={() => changeStatus(a.id, 'CANCELLED')}
                                  title="Rechazar cita"
                                >
                                  <X size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!appts.length && <div className="adminEmpty">No hay citas todavía.</div>}
              </div>
            </section>
          )}
          {tab === 'inventory' && (
            <section className="adminCard">
              <div className="adminCardHead">
                <div>
                  <small>REPUESTOS Y CAUCHOS</small>
                  <h2>Control de inventario</h2>
                </div>
                <button className="adminPrimary" onClick={() => SM(true)}>
                  <Plus size={16} /> Cargar artículo
                </button>
              </div>
              <div className="inventoryToolbar">
                <div>
                  <Search size={16} />
                  <input
                    placeholder="Buscar nombre, SKU, marca/modelo del artículo o vehículo"
                    value={query}
                    onChange={e => SQ(e.target.value)}
                  />
                </div>
                <span>
                  {
                    items.filter(i =>
                      [
                        i.name,
                        i.sku,
                        i.productBrand,
                        i.productModel,
                        i.vehicleMake,
                        i.vehicleModel,
                        i.category,
                        i.compatibility,
                        i.tireSize,
                      ].some(value =>
                        String(value || '')
                          .toLocaleLowerCase('es')
                          .includes(query.toLocaleLowerCase('es')),
                      ),
                    ).length
                  }{' '}
                  de {items.length} artículos
                </span>
              </div>
              <div className="inventoryList">
                {items
                  .filter(i =>
                    [
                      i.name,
                      i.sku,
                      i.productBrand,
                      i.productModel,
                      i.vehicleMake,
                      i.vehicleModel,
                      i.category,
                      i.compatibility,
                      i.tireSize,
                    ].some(value =>
                      String(value || '')
                        .toLocaleLowerCase('es')
                        .includes(query.toLocaleLowerCase('es')),
                    ),
                  )
                  .map(i => (
                    <article className={'inventoryRow ' + (!i.active ? 'inventoryInactive' : '')} key={i.id}>
                      <div className="inventoryItem">
                        <div className="inventoryDisc">
                          <Disc3 />
                        </div>
                        <div>
                          <b>{i.name}</b>
                          <small>
                            {i.sku} · {i.category} {i.tireSize ? '· ' + i.tireSize : ''}
                          </small>
                          <small>
                            Artículo:{' '}
                            {[i.productBrand, i.productModel].filter(Boolean).join(' ') ||
                              'Marca/modelo sin especificar'}
                          </small>
                          <small>
                            Vehículos:{' '}
                            {[i.vehicleMake, i.vehicleModel].filter(Boolean).join(' ') ||
                              i.compatibility ||
                              'Compatibilidad general'}
                          </small>
                        </div>
                      </div>
                      <div className="inventoryNumbers">
                        <b>{cash(i.priceCents)}</b>
                        <small>{i.stock} unidades</small>
                      </div>
                      <span className={i.active ? 'inventoryVisibility visible' : 'inventoryVisibility hidden'}>
                        {i.active ? 'Visible en web' : 'Oculto en web'}
                      </span>
                      <div className="inventoryActions">
                        <button className="saveStock" type="button" onClick={() => EI(i)}>
                          Editar
                        </button>
                        <button
                          className={i.active ? 'inventoryToggle off' : 'inventoryToggle on'}
                          type="button"
                          onClick={() => toggleItem(i)}
                        >
                          {i.active ? 'Inactivar' : 'Activar'}
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!items.length && (
                <div className="adminEmpty">Todavía no hay artículos. Carga el primero para comenzar.</div>
              )}
            </section>
          )}
          {tab === 'services' && (
            <section className="adminCard">
              <div className="adminCardHead">
                <div>
                  <small>LISTA DE SERVICIOS</small>
                  <h2>Servicios publicados</h2>
                </div>
                <button className="adminPrimary" type="button" onClick={() => SE('create')}>
                  <Plus size={16} /> Crear servicio
                </button>
              </div>
              <div className="serviceAdminList">
                {services.map(s => (
                  <article className="serviceAdminRow" key={s.id}>
                    <div>
                      <b>{s.name}</b>
                      <small>
                        {s.category} · {s.durationMin} min · {s.active ? 'Visible en web' : 'Oculto en web'}
                      </small>
                      <small>{s.description}</small>
                    </div>
                    <strong>{s.priceCents > 0 ? cash(s.priceCents) : 'Por cotizar'}</strong>
                    <button className="saveStock" type="button" onClick={() => SE(s)}>
                      Editar servicio
                    </button>
                  </article>
                ))}
                {!services.length && (
                  <div className="adminEmpty">Todavía no hay servicios. Crea el primero para publicarlo.</div>
                )}
              </div>
            </section>
          )}
          <footer className="adminFooter">
            Panel local de administración <span>Precios expresados en dólares estadounidenses (USD)</span>
          </footer>
        </div>
      </main>
      {message && (
        <div className="toast">
          <Check size={16} />
          {message}
          <button onClick={() => SN('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div className="overlay" onClick={() => SM(false)}>
          <form className="modal adminModal inventoryModal" onSubmit={addItem} onClick={e => e.stopPropagation()}>
            <button className="close" type="button" onClick={() => SM(false)}>
              <X />
            </button>
            <div className="eyebrow dark">
              <i /> NUEVO ARTÍCULO
            </div>
            <h2>Cargar artículo</h2>
            <input className="field" name="name" placeholder="Nombre del artículo" required />
            <div className="twocol">
              <input className="field" name="sku" placeholder="SKU / código" required />
              <input className="field" name="category" placeholder="Categoría" required />
            </div>
            <div className="twocol">
              <input className="field" name="productBrand" placeholder="Marca del artículo" />
              <input className="field" name="productModel" placeholder="Modelo del artículo" />
            </div>
            <div className="twocol">
              <input className="field" name="vehicleMake" placeholder="Marca del vehículo compatible" />
              <input className="field" name="vehicleModel" placeholder="Modelo del vehículo compatible" />
            </div>
            <div className="twocol">
              <input
                className="field"
                name="priceCents"
                type="number"
                min="0"
                step="0.01"
                placeholder="Precio en USD"
                required
              />
              <input className="field" name="stock" type="number" min="0" placeholder="Unidades disponibles" required />
            </div>
            <input className="field" name="tireSize" placeholder="Medida del caucho (opcional)" />
            <button className="adminPrimary full">
              Guardar artículo <ArrowUpRight size={16} />
            </button>
          </form>
        </div>
      )}
      {itemEditor && (
        <div className="overlay" onClick={() => EI(null)}>
          <form
            className="modal adminModal inventoryModal"
            onSubmit={e => saveItem(e, itemEditor.id)}
            onClick={e => e.stopPropagation()}
          >
            <button className="close" type="button" onClick={() => EI(null)}>
              <X />
            </button>
            <div className="eyebrow dark">
              <i /> EDITAR ARTÍCULO
            </div>
            <h2>{itemEditor.name}</h2>
            <input
              className="field"
              name="name"
              placeholder="Nombre del artículo"
              defaultValue={itemEditor.name}
              required
            />
            <div className="twocol">
              <input className="field" name="sku" placeholder="SKU / código" defaultValue={itemEditor.sku} required />
              <input
                className="field"
                name="category"
                placeholder="Categoría"
                defaultValue={itemEditor.category}
                required
              />
            </div>
            <div className="twocol">
              <input
                className="field"
                name="productBrand"
                placeholder="Marca del artículo"
                defaultValue={itemEditor.productBrand || ''}
              />
              <input
                className="field"
                name="productModel"
                placeholder="Modelo del artículo"
                defaultValue={itemEditor.productModel || ''}
              />
            </div>
            <div className="twocol">
              <input
                className="field"
                name="vehicleMake"
                placeholder="Marca del vehículo compatible"
                defaultValue={itemEditor.vehicleMake || ''}
              />
              <input
                className="field"
                name="vehicleModel"
                placeholder="Modelo del vehículo compatible"
                defaultValue={itemEditor.vehicleModel || ''}
              />
            </div>
            <div className="twocol">
              <input
                className="field"
                name="priceCents"
                type="number"
                min="0"
                step="0.01"
                placeholder="Precio en USD"
                defaultValue={itemEditor.priceCents / 100}
                required
              />
              <input
                className="field"
                name="stock"
                type="number"
                min="0"
                placeholder="Unidades disponibles"
                defaultValue={itemEditor.stock}
                required
              />
            </div>
            <input
              className="field"
              name="tireSize"
              placeholder="Medida del caucho (opcional)"
              defaultValue={itemEditor.tireSize || ''}
            />
            <label className="inventoryModalToggle">
              <input name="active" type="checkbox" defaultChecked={itemEditor.active} /> Artículo visible en la web
            </label>
            <button className="adminPrimary full">
              Guardar cambios <ArrowUpRight size={16} />
            </button>
          </form>
        </div>
      )}
      {serviceEditor && (
        <div className="overlay" onClick={() => SE(null)}>
          <form
            className="modal adminModal serviceModal"
            onSubmit={serviceEditor === 'create' ? createService : e => saveService(e, serviceEditor.id)}
            onClick={e => e.stopPropagation()}
          >
            <button className="close" type="button" onClick={() => SE(null)}>
              <X />
            </button>
            <div className="eyebrow dark">
              <i />
              {serviceEditor === 'create' ? 'NUEVO SERVICIO' : 'EDITAR SERVICIO'}
            </div>
            <h2>{serviceEditor === 'create' ? 'Crear servicio' : 'Editar servicio'}</h2>
            <input
              className="field"
              name="name"
              placeholder="Nombre del servicio"
              defaultValue={serviceEditor === 'create' ? '' : serviceEditor.name}
              required
            />
            <div className="twocol">
              <input
                className="field"
                name="category"
                placeholder="Categoría (ej. Cauchera)"
                defaultValue={serviceEditor === 'create' ? '' : serviceEditor.category}
                required
              />
              <input
                className="field"
                name="durationMin"
                type="number"
                min="5"
                step="5"
                placeholder="Duración en minutos"
                defaultValue={serviceEditor === 'create' ? '' : serviceEditor.durationMin}
                required
              />
            </div>
            <textarea
              className="field"
              name="description"
              rows={3}
              placeholder="Describe qué incluye el servicio"
              defaultValue={serviceEditor === 'create' ? '' : serviceEditor.description}
              required
            />
            <label className="serviceImageUpload">
              Foto del servicio (JPG, PNG o WebP, máximo 200 KB)
              <input className="field" type="file" name="image" accept="image/jpeg,image/png,image/webp" />
            </label>
            {serviceEditor !== 'create' && serviceEditor.imageUrl && (
              <img className="serviceImagePreview" src={serviceEditor.imageUrl} alt="Foto actual del servicio" />
            )}
            <input
              type="hidden"
              name="imageUrl"
              value={serviceEditor === 'create' ? '' : serviceEditor.imageUrl || ''}
            />
            <div className="twocol">
              <label className="servicePriceInput">
                Precio estimado (USD)
                <input
                  className="field"
                  name="priceCents"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  defaultValue={serviceEditor === 'create' ? '' : serviceEditor.priceCents / 100}
                  required
                />
              </label>
              <label className="toggleService">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={serviceEditor === 'create' ? true : serviceEditor.active}
                />{' '}
                Visible en el portal
              </label>
            </div>
            <button className="adminPrimary full">
              {serviceEditor === 'create' ? 'Crear servicio' : 'Guardar cambios'} <ArrowUpRight size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
function CalendarDaysIcon() {
  return <CalendarDays />;
}
