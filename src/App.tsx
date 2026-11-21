import { useEffect, useState } from 'react';
import AdminPanel from './AdminPanel';
import BookingFields from './BookingFields';
import VehicleCatalogFields from './VehicleCatalogFields';
import { apiFetch, errorText, SessionExpiredError } from './api';
import { dayNumber, money, monthShort, priceLabel, STATUS_LABEL, timeLabel } from './format';
import {
  ArrowUpRight,
  Car,
  Clock,
  ShieldCheck,
  Search,
  Plus,
  X,
  Check,
  Disc3,
  CalendarDays,
  KeyRound,
  LogOut,
  UserRound,
  ChevronRight,
} from 'lucide-react';

type S = {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  imageUrl?: string | null;
};
type V = { id: string; make: string; model: string; year: number; plate: string; engine?: string; tireSize?: string };
type I = {
  id: string;
  sku: string;
  name: string;
  category: string;
  priceCents: number;
  stock: number;
  productBrand?: string | null;
  productModel?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  active: boolean;
  tireSize?: string;
};
type A = {
  id: string;
  startsAt: string;
  status: string;
  notes?: string;
  estimateCents: number;
  vehicle: V;
  service: S;
};
type Profile = { name: string; email: string; role?: string };
type Session = { token: string; user: Profile & { role: string } };

const SHOP_PHONE = '0424-1091552';

const serviceArt = (service: S) => {
  if (service.imageUrl) return service.imageUrl; // la API sólo entrega URLs propias del taller
  const name = service.name.toLocaleLowerCase('es');
  if (name.includes('diagnóstico') || name.includes('escáner')) return '/images/service-diagnosis.jpeg';
  if (name.includes('aceite') || name.includes('filtro') || name.includes('inyector'))
    return '/images/service-oil.jpeg';
  if (
    name.includes('alineación') ||
    name.includes('balanceo') ||
    name.includes('caucho') ||
    name.includes('tpms') ||
    name.includes('blindaje')
  )
    return '/images/service-alignment.jpeg';
  return '/images/workshop-armada.webp';
};

export default function App() {
  const [token, T] = useState(localStorage.getItem('token') || ''),
    [services, S] = useState<S[]>([]),
    [vehicles, V] = useState<V[]>([]),
    [items, I] = useState<I[]>([]),
    [appointments, AP] = useState<A[]>([]),
    [profile, PR] = useState<Profile | null>(null),
    [view, SV] = useState(
      localStorage.getItem('role') === 'ADMIN' ? 'admin' : localStorage.getItem('token') ? 'dashboard' : 'home',
    ),
    [selected, Q] = useState(''),
    [query, U] = useState(''),
    [debouncedQuery, setDebouncedQuery] = useState(''),
    [bookingService, BS] = useState(''),
    [modal, M] = useState(''),
    [notice, N] = useState(''),
    [slotsVersion, setSlotsVersion] = useState(0),
    [busy, setBusy] = useState(false);

  function clearSession(message = '') {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    T('');
    PR(null);
    V([]);
    AP([]);
    Q('');
    SV('home');
    if (message) N(message);
  }
  function handleError(error: unknown, fallback: string) {
    if (error instanceof SessionExpiredError) {
      clearSession(error.message);
      M('login');
      return;
    }
    N(errorText(error, fallback));
  }
  async function logout() {
    const current = token;
    clearSession('Sesión cerrada.');
    // Invalida el token también en el servidor; si falla, el token vence solo en 12 h.
    if (current) await apiFetch('/api/auth/logout', { method: 'POST', token: current }).catch(() => undefined);
  }
  function startSession(session: Session) {
    const role = session.user.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER';
    localStorage.setItem('token', session.token);
    localStorage.setItem('role', role);
    T(session.token);
    PR(session.user);
    SV(role === 'ADMIN' ? 'admin' : 'dashboard');
  }

  useEffect(() => {
    apiFetch<S[]>('/api/services')
      .then(S)
      .catch(() => S([]));
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([
      apiFetch<Profile & { role: string }>('/api/me', { token }),
      apiFetch<V[]>('/api/vehicles', { token }),
      apiFetch<A[]>('/api/appointments', { token }),
    ])
      .then(([me, myVehicles, myAppointments]) => {
        if (cancelled) return;
        PR(me);
        localStorage.setItem('role', me.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER');
        if (me.role === 'ADMIN' && view === 'dashboard') SV('admin');
        V(myVehicles);
        Q(current => current || myVehicles[0]?.id || '');
        AP(myAppointments);
      })
      .catch(error => !cancelled && handleError(error, 'No se pudieron cargar tus datos.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const v = vehicles.find(x => x.id === selected);
    let cancelled = false;
    apiFetch<I[]>(
      '/api/inventory?' +
        new URLSearchParams({ q: debouncedQuery, vehicleMake: v?.make || '', vehicleModel: v?.model || '' }),
    )
      .then(data => !cancelled && I(data))
      .catch(() => !cancelled && I([]));
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, selected, vehicles]);

  async function account(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const path = modal === 'register' ? '/api/auth/register' : '/api/auth/login';
    setBusy(true);
    try {
      const session = await apiFetch<Session>(path, { method: 'POST', body: data });
      startSession(session);
      M('');
      N(session.user.role === 'ADMIN' ? 'Panel de administración' : 'Sesión iniciada');
    } catch (error) {
      N(errorText(error, 'No se pudo completar la solicitud'));
    } finally {
      setBusy(false);
    }
  }
  async function vehicle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    formData.make = (formData.make || '').trim().replace(/\s+/g, ' ');
    formData.model = (formData.model || '').trim().replace(/\s+/g, ' ');
    if (!formData.make || !formData.model) {
      N('Ingresa la marca y el modelo del vehículo');
      return;
    }
    try {
      const saved = await apiFetch<V>('/api/vehicles', { method: 'POST', token, body: formData });
      V([...vehicles, saved]);
      Q(saved.id);
      M(modal === 'vehicle-then-book' ? 'appointment' : '');
      N('Vehículo guardado');
    } catch (error) {
      handleError(error, 'No se pudo guardar el vehículo.');
    }
  }
  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      M('login');
      N('Inicia sesión o crea tu cuenta para reservar.');
      return;
    }
    const form = e.currentTarget;
    const formData = Object.fromEntries(new FormData(form));
    if (!formData.startsAt) {
      N('Elige una fecha y un horario disponible.');
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch<A>('/api/appointments', { method: 'POST', token, body: formData });
      N(
        created.estimateCents > 0
          ? `Solicitud enviada. El taller te confirmará la cita en tu panel. Estimado: ${money(created.estimateCents)}`
          : 'Solicitud enviada. El taller te confirmará la cita y el precio en tu panel.',
      );
      AP(await apiFetch<A[]>('/api/appointments', { token }));
      setSlotsVersion(v => v + 1);
      M('');
      form.reset();
    } catch (error) {
      handleError(error, 'No se pudo reservar la cita.');
      setSlotsVersion(v => v + 1);
    } finally {
      setBusy(false);
    }
  }
  async function cancelAppointment(appointment: A) {
    if (!window.confirm(`¿Cancelar la cita de ${appointment.service.name}?`)) return;
    try {
      await apiFetch(`/api/appointments/${appointment.id}/cancel`, { method: 'POST', token });
      AP(list => list.map(a => (a.id === appointment.id ? { ...a, status: 'CANCELLED' } : a)));
      setSlotsVersion(v => v + 1);
      N('Cita cancelada.');
    } catch (error) {
      handleError(error, 'No se pudo cancelar la cita.');
    }
  }
  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (data.newPassword !== data.confirmPassword) {
      N('La nueva contraseña y su confirmación no coinciden.');
      return;
    }
    try {
      const session = await apiFetch<Session>('/api/auth/password', {
        method: 'POST',
        token,
        body: { currentPassword: data.currentPassword, newPassword: data.newPassword },
      });
      startSession(session);
      M('');
      N('Contraseña actualizada. Se cerraron tus otras sesiones.');
    } catch (error) {
      handleError(error, 'No se pudo cambiar la contraseña.');
    }
  }
  const goToBooking = () => {
    SV('home');
    setTimeout(() => document.getElementById('agenda')?.scrollIntoView({ behavior: 'smooth' }), 80);
  };

  if (token && view === 'admin')
    return <AdminPanel token={token} onLogout={logout} onSessionExpired={message => clearSession(message)} />;

  const now = Date.now();
  const upcoming = appointments.filter(a => new Date(a.startsAt).getTime() >= now);
  const past = appointments
    .filter(a => new Date(a.startsAt).getTime() < now)
    .reverse()
    .slice(0, 5);
  const appointmentRow = (a: A, isPast = false) => {
    const cancellable = !isPast && (a.status === 'PENDING' || a.status === 'CONFIRMED');
    return (
      <article className={'appointmentRow' + (isPast ? ' past' : '')} key={a.id}>
        <div className="dateTile">
          <b>{dayNumber(a.startsAt)}</b>
          <small>{monthShort(a.startsAt)}</small>
        </div>
        <div className="appointmentInfo">
          <b>{a.service.name}</b>
          <small>
            {a.vehicle.make} {a.vehicle.model} · {timeLabel(a.startsAt)}
            {a.estimateCents > 0 ? ` · Estimado ${money(a.estimateCents)}` : ''}
          </small>
        </div>
        <div className="appointmentMeta">
          <span className={'statusTag ' + a.status.toLowerCase()}>{STATUS_LABEL[a.status] || a.status}</span>
          {cancellable && (
            <button type="button" className="cancelLink" onClick={() => cancelAppointment(a)}>
              Cancelar
            </button>
          )}
        </div>
      </article>
    );
  };

  if (token && view === 'dashboard')
    return (
      <div className="dashboard">
        <nav className="dashNav">
          <a className="brand logoCrop" href="#" aria-label="Pro Tires Services" onClick={() => SV('home')}>
            <img src="/images/protires-logo.png" alt="Pro Tires Services" />
          </a>
          <div className="dashLinks">
            <button className="active">
              <UserRound size={16} /> Mi panel
            </button>
            <button onClick={goToBooking}>
              <CalendarDays size={16} /> Agendar cita
            </button>
            <button onClick={() => M('password')}>
              <KeyRound size={16} /> Contraseña
            </button>
          </div>
          <div className="dashUser">
            <span>
              {profile?.name
                ?.split(' ')
                .map(x => x[0])
                .slice(0, 2)
                .join('') || 'U'}
            </span>
            <div>
              <b>{profile?.name || 'Mi cuenta'}</b>
              <small>{profile?.email}</small>
            </div>
            <button className="logout" onClick={logout} aria-label="Cerrar sesión">
              <LogOut size={17} />
            </button>
          </div>
        </nav>
        <main className="dashMain">
          <div className="dashWelcome">
            <div>
              <div className="eyebrow dark">
                <i /> TU ESPACIO PERSONAL
              </div>
              <h1>
                Hola, {profile?.name?.split(' ')[0] || 'bienvenido'}
                <span>.</span>
              </h1>
              <p>Todo listo para que sigas tu camino con tranquilidad.</p>
            </div>
            <button className="btn" onClick={goToBooking}>
              Agendar servicio <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="dashStats">
            <article>
              <span className="dashIcon">
                <Car />
              </span>
              <div>
                <small>VEHÍCULOS</small>
                <b>{vehicles.length}</b>
              </div>
            </article>
            <article>
              <span className="dashIcon">
                <CalendarDays />
              </span>
              <div>
                <small>PRÓXIMAS CITAS</small>
                <b>{upcoming.filter(a => a.status !== 'CANCELLED').length}</b>
              </div>
            </article>
            <article>
              <span className="dashIcon">
                <ShieldCheck />
              </span>
              <div>
                <small>CUENTA</small>
                <b>Activa</b>
              </div>
            </article>
          </div>
          <div className="dashGrid">
            <section className="dashPanel">
              <div className="panelHead">
                <div>
                  <small>MI GARAJE</small>
                  <h2>Mis vehículos</h2>
                </div>
                <button className="outlineBtn" onClick={() => M('vehicle')}>
                  <Plus size={15} /> Agregar
                </button>
              </div>
              <div className="vehicleCards">
                {vehicles.map(v => (
                  <article className="vehicleCard" key={v.id}>
                    <div className="vehicleVisual">
                      <Car size={34} />
                      <span>{v.year}</span>
                    </div>
                    <div className="vehicleInfo">
                      <div>
                        <b>
                          {v.make} {v.model}
                        </b>
                        <small>{v.engine || 'Vehículo registrado'}</small>
                      </div>
                      <span className="plate">{v.plate}</span>
                    </div>
                    {v.tireSize && (
                      <small className="tireSpec">
                        <Disc3 size={13} /> Caucho {v.tireSize}
                      </small>
                    )}
                  </article>
                ))}
                {!vehicles.length && (
                  <div className="dashEmpty">
                    Aún no tienes vehículos. Agrega uno para ver sus citas y repuestos compatibles.
                  </div>
                )}
              </div>
            </section>
            <section className="dashPanel appointmentsPanel">
              <div className="panelHead">
                <div>
                  <small>PRÓXIMAS VISITAS</small>
                  <h2>Mis citas</h2>
                </div>
                <CalendarDays className="panelIcon" />
              </div>
              {upcoming.map(a => appointmentRow(a))}
              {!upcoming.length && (
                <div className="dashEmpty">No tienes citas próximas. Reserva tu próxima visita.</div>
              )}
              {upcoming.some(a => a.status === 'PENDING') && (
                <div className="dashEmpty">
                  Las citas pendientes esperan la confirmación del taller. Te avisamos aquí mismo.
                </div>
              )}
              {past.length > 0 && (
                <>
                  <div className="panelSubhead">ANTERIORES</div>
                  {past.map(a => appointmentRow(a, true))}
                </>
              )}
              <button className="textLink" onClick={goToBooking}>
                Reservar una cita <ChevronRight size={15} />
              </button>
            </section>
          </div>
          <section className="dashPanel compatiblePanel">
            <div className="panelHead">
              <div>
                <small>SELECCIÓN PARA TU VEHÍCULO</small>
                <h2>Repuestos compatibles</h2>
              </div>
              <button className="textLink" onClick={() => SV('home')}>
                Ver catálogo <ChevronRight size={15} />
              </button>
            </div>
            <div className="dashProducts">
              {items.slice(0, 3).map(p => (
                <article className="dashProduct" key={p.id}>
                  <div className="dashProductIcon">
                    <Disc3 />
                  </div>
                  <div>
                    <small>{p.category}</small>
                    <b>{p.name}</b>
                    <span>
                      {money(p.priceCents)} · {p.stock} en stock
                    </span>
                  </div>
                </article>
              ))}
              {!items.length && (
                <div className="dashEmpty">El catálogo se mostrará al registrar un vehículo compatible.</div>
              )}
            </div>
          </section>
          <div className="dashFooter">
            PRO TIRES SERVICES <span>Servicio claro. Camino seguro.</span>
          </div>
        </main>
        {notice && (
          <div className="toast" role="status">
            <Check size={16} />
            {notice}
            <button onClick={() => N('')} aria-label="Cerrar aviso">
              <X size={15} />
            </button>
          </div>
        )}
        {modal && (
          <div className="overlay" onClick={() => M('')}>
            <form
              className="modal"
              onSubmit={modal === 'password' ? changePassword : vehicle}
              onClick={e => e.stopPropagation()}
            >
              <button className="close" type="button" onClick={() => M('')} aria-label="Cerrar">
                <X />
              </button>
              {modal === 'password' ? (
                <>
                  <div className="eyebrow dark">
                    <i /> TU CUENTA
                  </div>
                  <h2>Cambia tu contraseña</h2>
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
                    minLength={10}
                    placeholder="Nueva contraseña (10 caracteres mínimo)"
                    autoComplete="new-password"
                    required
                  />
                  <input
                    className="field"
                    name="confirmPassword"
                    type="password"
                    minLength={10}
                    placeholder="Repite la nueva contraseña"
                    autoComplete="new-password"
                    required
                  />
                  <button className="btn full">Guardar contraseña</button>
                </>
              ) : (
                <>
                  <div className="eyebrow dark">
                    <i /> TU GARAJE
                  </div>
                  <h2>Agrega tu vehículo</h2>
                  <VehicleCatalogFields />
                  <div className="twocol">
                    <input className="field" name="year" type="number" placeholder="Año" required />
                    <input className="field" name="plate" placeholder="Placa" required />
                  </div>
                  <input className="field" name="engine" placeholder="Motor (opcional)" />
                  <input className="field" name="tireSize" placeholder="Medida caucho (opcional)" />
                  <button className="btn full">Guardar vehículo</button>
                </>
              )}
            </form>
          </div>
        )}
      </div>
    );

  const selectedVehicle = vehicles.find(v => v.id === selected);
  return (
    <>
      <nav className="nav wrap">
        <a className="brand logoCrop" href="#" aria-label="Pro Tires Services">
          <img src="/images/protires-logo.png" alt="Pro Tires Services" />
        </a>
        <div className="links">
          <a href="#servicios">Servicios</a>
          <a href="#repuestos">Repuestos</a>
          <a href="#agenda">Agendar</a>
        </div>
        {token ? (
          <button
            className="login"
            onClick={() => SV(localStorage.getItem('role') === 'ADMIN' ? 'admin' : 'dashboard')}
          >
            Mi panel <UserRound size={15} />
          </button>
        ) : (
          <button className="login" onClick={() => M('login')}>
            Iniciar sesión ↗
          </button>
        )}
      </nav>
      <header className="hero">
        <div className="herobg" />
        <div className="wrap heroContent">
          <div className="eyebrow">
            <i /> TALLER ESPECIALIZADO · CARACAS, VENEZUELA
          </div>
          <h1>
            Tu auto en
            <br />
            buenas <em>manos.</em>
          </h1>
          <p>
            Mecánica honesta, servicio experto y la confianza de saber que tu vehículo está listo para lo que sigue.
          </p>
          <div className="actions">
            <a className="btn" href="#agenda">
              Agendar mi visita <ArrowUpRight size={16} />
            </a>
            <a className="ghost" href="#servicios">
              Conocer servicios
            </a>
          </div>
          <div className="trust">
            <span>
              <ShieldCheck /> Técnicos certificados
            </span>
            <span>
              <Clock /> Atención puntual
            </span>
          </div>
        </div>
      </header>
      <section className="stats">
        <div className="wrap statsin">
          <div>
            <b>
              12<span>+</span>
            </b>
            <small>AÑOS DE EXPERIENCIA</small>
          </div>
          <div>
            <b>
              4.9<span>★</span>
            </b>
            <small>CALIFICACIÓN CLIENTES</small>
          </div>
          <div>
            <b>2.4k</b>
            <small>VEHÍCULOS ATENDIDOS</small>
          </div>
          <p>
            Cuidamos cada detalle,
            <br />
            como si fuera nuestro.
          </p>
        </div>
      </section>
      <section id="servicios" className="section wrap">
        <div className="heading">
          <div>
            <div className="eyebrow dark">
              <i /> LO QUE HACEMOS
            </div>
            <h2>
              Todo lo que tu auto
              <br />
              necesita. <em>En un lugar.</em>
            </h2>
          </div>
          <p>Diagnóstico claro, trabajo garantizado y precios transparentes antes de empezar.</p>
        </div>
        <div className="services">
          {services.map((service, index) => (
            <article className="service" key={service.id}>
              <img
                className="serviceThumb"
                src={serviceArt(service)}
                alt={'Imagen ilustrativa: ' + service.name}
                loading="lazy"
                onError={e => {
                  // Si la foto subida no carga, se usa la ilustración local.
                  const img = e.currentTarget;
                  const fallback = serviceArt({ ...service, imageUrl: null });
                  if (!img.src.endsWith(fallback)) img.src = fallback;
                }}
              />
              <div className="serviceCopy">
                <small>
                  {String(index + 1).padStart(2, '0')} · {service.category}
                </small>
                <h3>{service.name}</h3>
                <p>{service.description}</p>
                <b className="servicePrice">
                  {service.priceCents > 0 ? `Desde ${money(service.priceCents)}` : 'Precio por consultar'}
                </b>
              </div>
              <button
                type="button"
                className="serviceBook"
                onClick={() => {
                  BS(service.id);
                  M(token ? 'appointment' : 'login');
                  if (!token) N('Inicia sesión o crea tu cuenta para reservar.');
                }}
              >
                Agendar cita <ArrowUpRight size={15} />
              </button>
            </article>
          ))}
          {!services.length && <p className="empty">Los servicios estarán disponibles en breve.</p>}
        </div>
      </section>
      <section id="agenda" className="booking">
        <div className="wrap bookinggrid">
          <div>
            <div className="eyebrow">
              <i /> SIMPLE Y RÁPIDO
            </div>
            <h2>
              Tu próxima visita
              <br />
              empieza <em>aquí.</em>
            </h2>
            <p>Elige tu vehículo, cuéntanos qué necesita y reserva el horario que mejor te acomode.</p>
            <div className="steps">01 — Vehículo　　 02 — Servicio　　 03 — Horario</div>
          </div>
          <form className="bookcard" onSubmit={book}>
            <div className="cardhead">
              <div>
                <small>RESERVA ONLINE</small>
                <h3>Agendar una cita</h3>
              </div>
              <span>● DISPONIBLE</span>
            </div>
            <BookingFields
              vehicles={vehicles}
              services={services}
              vehicleId={selected}
              onVehicleChange={Q}
              serviceId={bookingService}
              onServiceChange={BS}
              onAddVehicle={() => M(token ? 'vehicle' : 'login')}
              refreshKey={slotsVersion}
            />
            <button className="btn full" disabled={busy}>
              {busy ? 'Enviando…' : 'Solicitar cita'} <ArrowUpRight size={16} />
            </button>
            <div className="fine">
              Lunes a sábado, 8:30 a. m. – 5:30 p. m. · El taller confirma tu solicitud · Sin costo de reserva
            </div>
          </form>
        </div>
      </section>
      <section id="repuestos" className="section wrap">
        <div className="heading">
          <div>
            <div className="eyebrow dark">
              <i /> CATÁLOGO COMPATIBLE
            </div>
            <h2>
              Las piezas correctas.
              <br />
              <em>Para tu vehículo.</em>
            </h2>
          </div>
          <p>Consulta stock y precios estimados. La compatibilidad se ajusta al vehículo seleccionado.</p>
        </div>
        <div className="catalogbar">
          <div>
            <b>
              <Disc3 size={19} /> Repuestos y cauchos
            </b>
            <small>
              {selectedVehicle
                ? `Compatible con ${selectedVehicle.make} ${selectedVehicle.model}`
                : 'Selecciona tu vehículo para filtrar'}
            </small>
          </div>
          <div className="search">
            <Search size={16} />
            <input
              placeholder="Medida, nombre o código..."
              value={query}
              maxLength={80}
              onChange={e => U(e.target.value)}
            />
          </div>
        </div>
        <div className="products">
          {items.map(p => (
            <article className="product" key={p.id}>
              <div className="productIcon">
                <Disc3 />
              </div>
              <span className="tag">{p.category}</span>
              <h3>{p.name}</h3>
              <small>
                {p.sku}
                {p.tireSize ? ' · ' + p.tireSize : ''}
              </small>
              <div className="productBottom">
                <b>{money(p.priceCents)}</b>
                <span className={p.stock ? 'stock' : 'out'}>● {p.stock ? `${p.stock} en stock` : 'Agotado'}</span>
              </div>
            </article>
          ))}
          {!items.length && <p className="empty">No encontramos productos para esta búsqueda.</p>}
        </div>
      </section>
      <section className="cta">
        <div className="wrap ctarow">
          <div>
            <div className="eyebrow">
              <i /> ¿LISTO PARA EL CAMINO?
            </div>
            <h2>Nosotros nos encargamos.</h2>
          </div>
          <a className="btn" href="#agenda">
            Reserva tu hora ↗
          </a>
        </div>
      </section>
      <footer className="footer">
        <a className="logoCrop footerLogo" href="#" aria-label="Protires Services">
          <img src="/images/protires-logo.png" alt="Protires Services" />
        </a>
        <div className="footerBusiness">
          <b>Protires Services</b>
          <span>RIF J-500192975</span>
          <span>Atención: lunes a sábado, 8:30 a. m. – 5:30 p. m.</span>
        </div>
        <address className="footerContact">
          <span>Av. principal de La Guairita, vía Cementerio del Este, 200 m después del arco de El Hatillo</span>
          <span>
            <a href="tel:+584241091552">0424-1091552</a> · <a href="tel:+584241111912">0424-1111912</a>
          </span>
          <span>
            <a href="mailto:Protires2020@gmail.com">Protires2020@gmail.com</a> ·{' '}
            <a href="https://instagram.com/Protires2020" target="_blank" rel="noreferrer">
              @Protires2020
            </a>
          </span>
          <span>
            <a href="https://www.google.com/maps?q=10.4501389,-66.8219722" target="_blank" rel="noreferrer">
              Ver ubicación: 10°27'00.5&quot;N, 66°49'19.1&quot;W
            </a>
          </span>
        </address>
        <iframe
          className="footerMap"
          title="Mapa de Protires Services"
          src="https://maps.google.com/maps?q=10.4501389,-66.8219722&z=15&output=embed"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        <span className="footerCopyright">© 2026 Protires Services · Caracas, Venezuela</span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button onClick={() => N('')} aria-label="Cerrar aviso">
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div className="overlay" onClick={() => M('')}>
          <form
            className="modal"
            onSubmit={modal === 'appointment' ? book : modal.startsWith('vehicle') ? vehicle : account}
            onClick={e => e.stopPropagation()}
          >
            <button className="close" type="button" onClick={() => M('')} aria-label="Cerrar">
              <X />
            </button>
            <div className="eyebrow dark">
              <i />
              {modal === 'appointment' ? 'RESERVA ONLINE' : modal.startsWith('vehicle') ? 'TU GARAJE' : 'BIENVENIDO'}
            </div>
            <h2>
              {modal === 'appointment'
                ? 'Agenda tu visita'
                : modal.startsWith('vehicle')
                  ? 'Agrega tu vehículo'
                  : modal === 'register'
                    ? 'Crea tu cuenta.'
                    : modal === 'adminlogin'
                      ? 'Acceso administración.'
                      : 'Qué bueno verte.'}
            </h2>
            {modal === 'appointment' ? (
              <>
                <BookingFields
                  vehicles={vehicles}
                  services={services}
                  vehicleId={selected}
                  onVehicleChange={Q}
                  serviceId={bookingService}
                  onServiceChange={BS}
                  onAddVehicle={() => M('vehicle-then-book')}
                  refreshKey={slotsVersion}
                />
                <button className="btn full" disabled={busy}>
                  {busy ? 'Enviando…' : 'Solicitar cita'} <ArrowUpRight size={16} />
                </button>
                <small className="modalHint">El taller confirma tu solicitud y la verás en tu panel.</small>
              </>
            ) : modal.startsWith('vehicle') ? (
              <>
                <VehicleCatalogFields />
                <div className="twocol">
                  <input className="field" name="year" type="number" placeholder="Año" required />
                  <input className="field" name="plate" placeholder="Placa" required />
                </div>
                <input className="field" name="engine" placeholder="Motor (opcional)" />
                <input className="field" name="tireSize" placeholder="Medida caucho (opcional)" />
                <button className="btn full">Guardar vehículo</button>
              </>
            ) : (
              <>
                {modal === 'register' && <input className="field" name="name" placeholder="Tu nombre" required />}
                <input
                  className="field"
                  name="email"
                  type="email"
                  placeholder="Correo electrónico"
                  autoComplete="email"
                  required
                />
                <input
                  className="field"
                  name="password"
                  type="password"
                  minLength={modal === 'register' ? 10 : undefined}
                  placeholder={modal === 'register' ? 'Contraseña (10 caracteres mínimo)' : 'Contraseña'}
                  autoComplete={modal === 'register' ? 'new-password' : 'current-password'}
                  required
                />
                <button className="btn full" disabled={busy}>
                  {busy ? 'Un momento…' : modal === 'register' ? 'Crear cuenta' : 'Iniciar sesión'}
                </button>
                <button type="button" className="switch" onClick={() => M(modal === 'register' ? 'login' : 'register')}>
                  {modal === 'register' ? 'Ya tengo cuenta' : 'Crear cuenta'}
                </button>
                {modal !== 'register' && (
                  <small className="modalHint">
                    ¿Olvidaste tu contraseña? Llama al taller al {SHOP_PHONE} y te damos una clave temporal.
                  </small>
                )}
                <button type="button" className="switch" onClick={() => M('adminlogin')}>
                  Acceso administrador
                </button>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}
