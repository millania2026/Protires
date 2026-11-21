import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock,
  Disc3,
  KeyRound,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  UserRoundCog,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, errorText, SessionExpiredError } from './api';
import { caracasDay, money as cash, STATUS_LABEL } from './format';
import { optimizeImage } from './imageOptimize';

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
type Filter = 'upcoming' | 'pending' | 'all';
const toCents = (amount: unknown) => Math.round(Number(amount) * 100);

export default function AdminPanel({
  token,
  onLogout,
  onSessionExpired,
}: {
  token: string;
  onLogout: () => void;
  onSessionExpired: (message: string) => void;
}) {
  const [tab, ST] = useState<'appointments' | 'inventory' | 'services'>('appointments'),
    [items, SI] = useState<Item[]>([]),
    [appts, SA] = useState<Appt[]>([]),
    [services, SS] = useState<Service[]>([]),
    [filter, SFilter] = useState<Filter>('upcoming'),
    [modal, SM] = useState(false),
    [itemEditor, EI] = useState<Item | null>(null),
    [serviceEditor, SE] = useState<'create' | Service | null>(null),
    [accountModal, SAccount] = useState<'' | 'reset' | 'password'>(''),
    [resetResult, SReset] = useState<{ email: string; name: string; temporaryPassword: string } | null>(null),
    [query, SQ] = useState(''),
    [message, SN] = useState(''),
    [saving, SSaving] = useState(false),
    [version, SVersion] = useState(0);

  function fail(error: unknown, fallback: string) {
    if (error instanceof SessionExpiredError) return onSessionExpired(error.message);
    SN(errorText(error, fallback));
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<Appt[]>('/api/admin/appointments', { token }),
      apiFetch<Item[]>('/api/admin/inventory', { token }),
      apiFetch<Service[]>('/api/admin/services', { token }),
    ])
      .then(([a, i, s]) => {
        if (cancelled) return;
        SA(a);
        SI(i);
        SS(s);
      })
      .catch(error => !cancelled && fail(error, 'No se pudo cargar la administración. Verifica el servidor.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, version]);

  async function changeStatus(appointment: Appt, status: 'CONFIRMED' | 'CANCELLED') {
    if (status === 'CANCELLED' && appointment.status === 'CONFIRMED') {
      if (!window.confirm(`¿Cancelar la cita confirmada de ${appointment.user.name}? Avísale por teléfono.`)) return;
    }
    try {
      const updated = await apiFetch<Appt>(`/api/admin/appointments/${appointment.id}`, {
        method: 'PATCH',
        token,
        body: { status },
      });
      SA(x => x.map(a => (a.id === appointment.id ? { ...a, ...updated } : a)));
      SN(status === 'CONFIRMED' ? 'Cita confirmada' : 'Cita cancelada');
    } catch (error) {
      fail(error, 'No se pudo actualizar la cita');
    }
  }
  async function resetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      SReset(await apiFetch('/api/admin/users/reset-password', { method: 'POST', token, body: { email: data.email } }));
    } catch (error) {
      fail(error, 'No se pudo generar la clave temporal');
    }
  }
  async function changeOwnPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (data.newPassword !== data.confirmPassword) return SN('La nueva contraseña y su confirmación no coinciden.');
    try {
      await apiFetch('/api/auth/password', {
        method: 'POST',
        token,
        body: { currentPassword: data.currentPassword, newPassword: data.newPassword },
      });
      // El cambio cierra todas las sesiones; se vuelve a entrar con la clave nueva.
      onSessionExpired('Contraseña actualizada. Inicia sesión con la nueva.');
    } catch (error) {
      fail(error, 'No se pudo cambiar la contraseña');
    }
  }
  function itemPayload(form: HTMLFormElement) {
    const d = Object.fromEntries(new FormData(form)),
      vehicleMake = String(d.vehicleMake || '').trim(),
      vehicleModel = String(d.vehicleModel || '').trim();
    return {
      sku: String(d.sku).trim(),
      name: String(d.name).trim(),
      category: String(d.category).trim(),
      productBrand: String(d.productBrand || '').trim() || null,
      productModel: String(d.productModel || '').trim() || null,
      vehicleMake: vehicleMake || null,
      vehicleModel: vehicleModel || null,
      // Vacía = artículo de uso general (el servidor lo acepta al crear y al editar).
      compatibility: [vehicleMake, vehicleModel].filter(Boolean).join(' '),
      tireSize: String(d.tireSize || '').trim() || null,
      priceCents: toCents(d.priceCents),
      stock: Number(d.stock),
      active: d.active === undefined ? true : d.active === 'on',
    };
  }
  async function addItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const saved = await apiFetch<Item>('/api/admin/inventory', {
        method: 'POST',
        token,
        body: { ...itemPayload(e.currentTarget), active: true },
      });
      SI(x => [saved, ...x]);
      SM(false);
      SN('Artículo agregado');
    } catch (error) {
      fail(error, 'No se pudo agregar el artículo');
    }
  }
  async function saveItem(e: React.FormEvent<HTMLFormElement>, item: Item) {
    e.preventDefault();
    const data = itemPayload(e.currentTarget);
    // Conserva la compatibilidad antigua (texto libre) si no se cargó marca/modelo de vehículo.
    if (!data.compatibility) data.compatibility = item.vehicleMake || item.vehicleModel ? '' : item.compatibility || '';
    try {
      const saved = await apiFetch<Item>('/api/admin/inventory/' + item.id, { method: 'PATCH', token, body: data });
      SI(x => x.map(i => (i.id === item.id ? saved : i)));
      EI(null);
      SN('Artículo actualizado');
    } catch (error) {
      fail(error, 'No se pudo guardar el artículo');
    }
  }
  async function toggleItem(item: Item) {
    const active = !item.active;
    try {
      const saved = await apiFetch<Item>('/api/admin/inventory/' + item.id, {
        method: 'PATCH',
        token,
        body: { active },
      });
      SI(x => x.map(i => (i.id === item.id ? saved : i)));
      SN(active ? 'Artículo visible en la web' : 'Artículo oculto en la web');
    } catch (error) {
      fail(error, 'No se pudo cambiar la visibilidad');
    }
  }
  function serviceFormData(form: HTMLFormElement) {
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
      },
      file: file && file.size ? file : null,
    };
  }
  /** Sube la foto ya optimizada y la vincula al servicio. */
  async function persistServiceImage(saved: Service, file: File | null): Promise<Service> {
    if (!file) return saved;
    const optimized = await optimizeImage(file);
    const upload = await apiFetch<{ imageUrl: string }>('/api/admin/services/' + saved.id + '/image', {
      method: 'POST',
      token,
      raw: optimized,
    });
    return apiFetch<Service>('/api/admin/services/' + saved.id, {
      method: 'PATCH',
      token,
      body: { imageUrl: upload.imageUrl },
    });
  }
  async function submitService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!serviceEditor) return;
    const form = serviceFormData(e.currentTarget);
    SSaving(true);
    let saved: Service | null = null;
    try {
      saved =
        serviceEditor === 'create'
          ? await apiFetch<Service>('/api/admin/services', { method: 'POST', token, body: form.data })
          : await apiFetch<Service>('/api/admin/services/' + serviceEditor.id, {
              method: 'PATCH',
              token,
              body: form.data,
            });
      const withImage = await persistServiceImage(saved, form.file);
      SS(x =>
        (x.some(s => s.id === withImage.id)
          ? x.map(s => (s.id === withImage.id ? withImage : s))
          : [...x, withImage]
        ).sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es')),
      );
      SE(null);
      SN(serviceEditor === 'create' ? 'Servicio creado' : 'Servicio actualizado');
    } catch (error) {
      if (saved && !(error instanceof SessionExpiredError)) {
        // Los datos quedaron guardados; sólo falló la foto.
        const stored = saved;
        SS(x => (x.some(s => s.id === stored.id) ? x.map(s => (s.id === stored.id ? stored : s)) : [...x, stored]));
        SE(null);
        SN(`Servicio guardado, pero la foto no se subió: ${errorText(error, 'error desconocido')}`);
      } else fail(error, 'No se pudo guardar el servicio');
    } finally {
      SSaving(false);
    }
  }

  const now = Date.now();
  const today = caracasDay(new Date());
  const future = (a: Appt) => new Date(a.startsAt).getTime() >= now;
  const pending = appts.filter(a => a.status === 'PENDING' && future(a)).length;
  const low = items.filter(i => i.stock <= 4).length;
  const shown = appts.filter(a =>
    filter === 'pending'
      ? a.status === 'PENDING' && future(a)
      : filter === 'upcoming'
        ? future(a) && a.status !== 'CANCELLED'
        : true,
  );
  const visibleItems = items.filter(i =>
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
  );

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
          <button onClick={() => SAccount('password')}>
            <KeyRound size={16} /> Cambiar mi contraseña
          </button>
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
              <i /> SISTEMA ACTIVO
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
            <div className="adminWelcomeActions">
              <button
                className="adminRefresh"
                onClick={() => {
                  SReset(null);
                  SAccount('reset');
                }}
              >
                <UserRoundCog size={15} /> Clave temporal de cliente
              </button>
              <button className="adminRefresh" onClick={() => SVersion(v => v + 1)}>
                <RefreshCw size={15} /> Actualizar
              </button>
            </div>
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
                <CalendarDays />
              </div>
              <div>
                <small>CITAS DE HOY</small>
                <b>
                  {appts.filter(a => a.status !== 'CANCELLED' && caracasDay(new Date(a.startsAt)) === today).length}
                </b>
                <span>Pendientes y confirmadas</span>
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
                <small>CITAS EN LISTA</small>
                <b>{appts.length}</b>
                <span>Últimos 30 días y futuras</span>
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
                  <button className={filter === 'upcoming' ? 'filterActive' : ''} onClick={() => SFilter('upcoming')}>
                    Próximas <b>{appts.filter(a => future(a) && a.status !== 'CANCELLED').length}</b>
                  </button>
                  <button className={filter === 'pending' ? 'filterActive' : ''} onClick={() => SFilter('pending')}>
                    Pendientes <b>{pending}</b>
                  </button>
                  <button className={filter === 'all' ? 'filterActive' : ''} onClick={() => SFilter('all')}>
                    Todas <b>{appts.length}</b>
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
                    {shown.map(a => (
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
                            weekday: 'short',
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
                              {STATUS_LABEL[a.status] || a.status}
                            </span>
                            {a.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  className="acceptBtn"
                                  onClick={() => changeStatus(a, 'CONFIRMED')}
                                  title="Confirmar cita"
                                  aria-label="Confirmar cita"
                                >
                                  <Check size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="rejectBtn"
                                  onClick={() => changeStatus(a, 'CANCELLED')}
                                  title="Rechazar cita"
                                  aria-label="Rechazar cita"
                                >
                                  <X size={15} />
                                </button>
                              </>
                            )}
                            {a.status === 'CONFIRMED' && future(a) && (
                              <button
                                type="button"
                                className="rejectBtn"
                                onClick={() => changeStatus(a, 'CANCELLED')}
                                title="Cancelar cita confirmada"
                                aria-label="Cancelar cita confirmada"
                              >
                                <X size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!shown.length && (
                  <div className="adminEmpty">
                    {appts.length ? 'No hay citas con este filtro.' : 'No hay citas todavía.'}
                  </div>
                )}
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
                  {visibleItems.length} de {items.length} artículos
                </span>
              </div>
              <div className="inventoryList">
                {visibleItems.map(i => (
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
                          {[i.productBrand, i.productModel].filter(Boolean).join(' ') || 'Marca/modelo sin especificar'}
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
            Panel de administración <span>Precios expresados en dólares estadounidenses (USD)</span>
          </footer>
        </div>
      </main>
      {message && (
        <div className="toast" role="status">
          <Check size={16} />
          {message}
          <button onClick={() => SN('')} aria-label="Cerrar aviso">
            <X size={15} />
          </button>
        </div>
      )}
      {accountModal && (
        <div className="overlay" onClick={() => SAccount('')}>
          <form
            className="modal adminModal"
            onSubmit={accountModal === 'reset' ? resetPassword : changeOwnPassword}
            onClick={e => e.stopPropagation()}
          >
            <button className="close" type="button" onClick={() => SAccount('')} aria-label="Cerrar">
              <X />
            </button>
            {accountModal === 'reset' ? (
              <>
                <div className="eyebrow dark">
                  <i /> ATENCIÓN AL CLIENTE
                </div>
                <h2>Clave temporal</h2>
                <p className="modalHint">
                  Úsala cuando un cliente llame porque olvidó su contraseña. Verifica su identidad antes de dársela; sus
                  sesiones abiertas se cierran.
                </p>
                <input className="field" name="email" type="email" placeholder="Correo del cliente" required />
                {resetResult && (
                  <div className="tempPassword">
                    <small>
                      Clave temporal de {resetResult.name} ({resetResult.email}):
                    </small>
                    <b>{resetResult.temporaryPassword}</b>
                    <small>Dísela por teléfono y pídele que la cambie en "Contraseña" al entrar.</small>
                  </div>
                )}
                <button className="adminPrimary full">
                  Generar clave temporal <ArrowUpRight size={16} />
                </button>
              </>
            ) : (
              <>
                <div className="eyebrow dark">
                  <i /> TU CUENTA
                </div>
                <h2>Cambiar mi contraseña</h2>
                <input
                  className="field"
                  name="currentPassword"
                  type="password"
                  placeholder="Contraseña actual"
                  autoComplete="current-password"
                  required
                />
                <input
                  className="field"
                  name="newPassword"
                  type="password"
                  minLength={14}
                  placeholder="Nueva contraseña (14 caracteres o más)"
                  autoComplete="new-password"
                  required
                />
                <input
                  className="field"
                  name="confirmPassword"
                  type="password"
                  minLength={14}
                  placeholder="Repite la nueva contraseña"
                  autoComplete="new-password"
                  required
                />
                <button className="adminPrimary full">
                  Guardar contraseña <ArrowUpRight size={16} />
                </button>
              </>
            )}
          </form>
        </div>
      )}
      {modal && (
        <div className="overlay" onClick={() => SM(false)}>
          <form className="modal adminModal inventoryModal" onSubmit={addItem} onClick={e => e.stopPropagation()}>
            <button className="close" type="button" onClick={() => SM(false)} aria-label="Cerrar">
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
            onSubmit={e => saveItem(e, itemEditor)}
            onClick={e => e.stopPropagation()}
          >
            <button className="close" type="button" onClick={() => EI(null)} aria-label="Cerrar">
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
            <input type="hidden" name="active" value="off" />
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
        <div className="overlay" onClick={() => !saving && SE(null)}>
          <form className="modal adminModal serviceModal" onSubmit={submitService} onClick={e => e.stopPropagation()}>
            <button className="close" type="button" onClick={() => SE(null)} aria-label="Cerrar" disabled={saving}>
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
                max="540"
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
              Foto del servicio (JPG, PNG o WebP; se optimiza automáticamente)
              <input className="field" type="file" name="image" accept="image/jpeg,image/png,image/webp" />
            </label>
            {serviceEditor !== 'create' && serviceEditor.imageUrl && (
              <img className="serviceImagePreview" src={serviceEditor.imageUrl} alt="Foto actual del servicio" />
            )}
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
            <button className="adminPrimary full" disabled={saving}>
              {saving ? 'Guardando…' : serviceEditor === 'create' ? 'Crear servicio' : 'Guardar cambios'}{' '}
              <ArrowUpRight size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
