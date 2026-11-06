import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  Target,
  Wallet,
  X,
} from "lucide-react";
import { api, json, today } from "./api";
import type { Account, Category, Filters, Movement } from "./api";
import { ErrorBox, FilterBar, Modal, Toast } from "./ui";
import Dashboard from "./Dashboard";
import Movements, { MovementForm } from "./Movements";
import Budgets from "./Budgets";
import ImportExport from "./ImportExport";
import Settings from "./Settings";
type Page = "dashboard" | "movements" | "budgets" | "import" | "settings";
const pages = [
  { id: "dashboard", label: "Vista general", icon: LayoutDashboard },
  { id: "movements", label: "Movimientos", icon: ArrowDownLeft },
  { id: "budgets", label: "Presupuestos", icon: Target },
  { id: "import", label: "Importar y exportar", icon: Download },
  { id: "settings", label: "Configuración", icon: SettingsIcon },
] as const;
function initialFilters(): Filters {
  const d = new Date();
  return {
    from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
    to: today(),
    accountId: "",
    categoryId: "",
  };
}
export default function App() {
  const [token, setToken] = useState(sessionStorage.getItem("finanza-token"));
  const [page, setPage] = useState<Page>("dashboard");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [period, setPeriod] = useState("month");
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Movement>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mobile, setMobile] = useState(false);
  const [review, setReview] = useState(false);
  const [dark, setDark] = useState(
    localStorage.getItem("finanza-dark") === "true",
  );
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const notify = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 4500);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("finanza-dark", String(dark));
  }, [dark]);
  useEffect(() => {
    const fn = () => setToken(null);
    window.addEventListener("auth-expired", fn);
    return () => window.removeEventListener("auth-expired", fn);
  }, []);
  useEffect(() => {
    if (!token) return;
    Promise.all([api<Account[]>("/accounts"), api<Category[]>("/categories")])
      .then(([a, c]) => {
        setAccounts(a);
        setCategories(c);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [token, version]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (token) setAdding(true);
      }
      if (e.key === "Escape") {
        setAdding(false);
        setEdit(undefined);
        setMobile(false);
      }
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [token]);
  function changePeriod(value: string) {
    setPeriod(value);
    const d = new Date();
    const year = d.getFullYear();
    const month = d.getMonth();
    const first =
      value === "year"
        ? new Date(year, 0, 1)
        : value === "quarter"
          ? new Date(year, Math.floor(month / 3) * 3, 1)
          : new Date(year, month, 1);
    const from = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-01`;
    if (value !== "custom") setFilters((f) => ({ ...f, from, to: today() }));
  }
  if (!token)
    return (
      <Login
        onLogin={(value) => {
          sessionStorage.setItem("finanza-token", value);
          setToken(value);
        }}
      />
    );
  const title = pages.find((p) => p.id === page)?.label;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("dashboard");
          }}
        >
          <span className="brand-mark">
            <ChartNoAxesCombined size={23} />
          </span>
          finanza<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">P</span>
          <div>
            <strong>Mi espacio personal</strong>
            <small>Un poco más de tranquilidad</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">TU DÍA A DÍA</p>
        <nav>
          {pages.map((p) => (
            <button
              key={p.id}
              className={page === p.id ? "active" : ""}
              onClick={() => {
                setPage(p.id);
                setMobile(false);
                setReview(false);
              }}
            >
              <p.icon size={19} />
              {p.label}
              {p.id === "dashboard" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">
            <ShieldCheck size={22} />
          </span>
          <strong>Tu dinero, bajo tu control</strong>
          <p>Cada pequeño paso cuenta. Empieza por saber dónde estás.</p>
          <button
            onClick={() => {
              setPage("budgets");
              setMobile(false);
            }}
          >
            Revisa tus presupuestos <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setDark(!dark)}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}Modo{" "}
            {dark ? "claro" : "oscuro"}
          </button>
          <button
            onClick={() => {
              sessionStorage.removeItem("finanza-token");
              setToken(null);
            }}
          >
            <LogOut size={18} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-backdrop"
          onClick={() => setMobile(false)}
          aria-label="Cerrar menú"
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(!mobile)}
              aria-label="Abrir menú"
            >
              {mobile ? <X size={21} /> : <Menu size={21} />}
            </button>
            <span>Mi espacio</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <span className="private-badge">
              <span /> Espacio privado
            </span>
            <button
              className="icon-button"
              title="Pendientes de revisión"
              aria-label="Ver pendientes de revisión"
              onClick={() => {
                setReview(true);
                setPage("movements");
              }}
            >
              <Bell size={19} />
            </button>
            <span className="user-avatar">YO</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">TU DINERO, EN PERSPECTIVA</div>
              <h1>
                {page === "dashboard" ? "Una mirada a tus finanzas" : title}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {page === "dashboard"
                  ? "Todo lo que necesitas para tomar mejores decisiones."
                  : page === "movements"
                    ? "Cada movimiento cuenta. Encuentra, organiza y revisa los tuyos."
                    : page === "budgets"
                      ? "Pon intención a tus gastos y espacio a tus objetivos."
                      : page === "import"
                        ? "Tus cuentas conectadas, sin perder el control de tus datos."
                        : "Un espacio que se adapta a ti."}
              </p>
            </div>
            <button className="button primary" onClick={() => setAdding(true)}>
              <Plus size={18} />
              Añadir movimiento
            </button>
          </div>
          {error && <ErrorBox message={error} />}
          <div className="period-row">
            <div className="segmented">
              {[
                ["month", "Este mes"],
                ["quarter", "Trimestre"],
                ["year", "Este año"],
                ["custom", "Personalizado"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={period === id ? "selected" : ""}
                  onClick={() => changePeriod(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="period-label">
              {new Intl.DateTimeFormat("es-ES", {
                month: "long",
                year: "numeric",
              }).format(new Date())}
              <ChevronDown size={14} />
            </div>
          </div>
          <FilterBar
            filters={filters}
            setFilters={(f) => {
              setPeriod("custom");
              setFilters(f);
            }}
            accounts={accounts}
            categories={categories}
          />
          {page === "dashboard" && (
            <Dashboard key={`d${version}`} filters={filters} />
          )}{" "}
          {page === "movements" && (
            <Movements
              key={`m${version}`}
              filters={filters}
              categories={categories}
              accounts={accounts}
              review={review}
              onEdit={(m) => {
                setEdit(m);
                setAdding(true);
              }}
              onChange={refresh}
              notify={notify}
            />
          )}{" "}
          {page === "budgets" && (
            <Budgets
              key={`b${version}`}
              filters={filters}
              categories={categories}
              notify={notify}
            />
          )}{" "}
          {page === "import" && (
            <ImportExport
              filters={filters}
              accounts={accounts}
              notify={notify}
              onChange={refresh}
            />
          )}{" "}
          {page === "settings" && (
            <Settings
              accounts={accounts}
              categories={categories}
              onChange={refresh}
              notify={notify}
            />
          )}
          <footer className="footer">
            <span>
              <ShieldCheck size={14} /> Tus datos te pertenecen. Siempre.
            </span>
            <span>Hecho para cuidar de tu tranquilidad.</span>
          </footer>
        </main>
      </div>
      {adding && (
        <Modal
          title={edit ? "Editar movimiento" : "Nuevo movimiento"}
          onClose={() => {
            setAdding(false);
            setEdit(undefined);
          }}
        >
          <MovementForm
            movement={edit}
            accounts={accounts}
            categories={categories}
            onSaved={() => {
              setAdding(false);
              setEdit(undefined);
              refresh();
              notify(edit ? "Movimiento actualizado" : "Movimiento añadido");
            }}
          />
        </Modal>
      )}
      {notice && <Toast text={notice} />}
    </div>
  );
}
function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ token: string }>(
        `/auth/${register ? "register" : "login"}`,
        {
          method: "POST",
          body: json({ email, password, ...(register ? { name } : {}) }),
        },
      );
      onLogin(result.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-story">
        <a className="brand" href="#">
          <span className="brand-mark">
            <ChartNoAxesCombined size={24} />
          </span>
          finanza.
        </a>
        <div>
          <span className="eyebrow">MENOS DUDAS. MÁS CLARIDAD.</span>
          <h1>
            Haz espacio para
            <br />
            lo que importa.
          </h1>
          <p>
            Entiende tus hábitos, organiza tus cuentas y construye una relación
            más tranquila con tu dinero.
          </p>
          <div className="login-illustration">
            <Wallet size={48} />
            <div>
              <small>Tu próximo capítulo</small>
              <strong>Empieza con una buena decisión.</strong>
            </div>
          </div>
        </div>
        <span className="login-foot">
          <ShieldCheck size={16} />
          Privado. Personal. Bajo tu control.
        </span>
      </div>
      <section className="login-form">
        <span className="mini-brand">
          <ChartNoAxesCombined /> finanza.
        </span>
        <h2>
          {register
            ? "Tu tranquilidad empieza aquí"
            : "Qué bien tenerte por aquí"}
        </h2>
        <p>
          {register
            ? "Crea tu espacio financiero personal."
            : "Entra en tu espacio y pon tus números en perspectiva."}
        </p>
        <form onSubmit={submit}>
          {error && <ErrorBox message={error} />}{" "}
          {register && (
            <label>
              Tu nombre
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Correo electrónico
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              minLength={register ? 12 : 1}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                register ? "Al menos 12 caracteres" : "Tu contraseña"
              }
            />
          </label>
          <button className="button primary full" disabled={busy}>
            {busy
              ? "Un momento…"
              : register
                ? "Crear mi espacio"
                : "Entrar en mi espacio"}
            <ArrowUpRight size={18} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register
            ? "Ya tengo una cuenta. Entrar"
            : "¿Primera vez? Crea tu cuenta"}
        </button>
        <p className="login-help">
          <CircleHelp size={16} />
          Si usaste el seed, consulta las credenciales de desarrollo en el
          README.
        </p>
      </section>
    </div>
  );
}
