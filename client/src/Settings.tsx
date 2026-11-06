import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Edit3,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, dateLabel, eur, json, today } from "./api";
import type { Account, Category } from "./api";
import { Empty, ErrorBox, Loading, Modal } from "./ui";
type Row = {
  id: string;
  name?: string;
  concept?: string;
  keyword?: string;
  categoryId?: string;
  accountId?: string;
  initialBalanceCents?: number;
  amountCents?: number;
  color?: string;
  icon?: string;
  type?: string;
  parentId?: string;
  frequency?: string;
  nextDate?: string;
  active?: boolean;
  priority?: number;
  notes?: string;
};
type Tab = "accounts" | "categories" | "rules" | "recurrences" | "keys";
type Field = {
  key: string;
  label: string;
  kind?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};
export default function Settings({
  accounts,
  categories,
  onChange,
  notify,
}: {
  accounts: Account[];
  categories: Category[];
  onChange: () => void;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("accounts");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<Row>();
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const names = {
    accounts: "Cuentas",
    categories: "Categorías",
    rules: "Reglas automáticas",
    recurrences: "Recurrentes",
    keys: "API de Telegram",
  };
  useEffect(() => {
    if (tab === "keys") {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    api<Row[]>(`/${tab}`)
      .then((data) => {
        if (active) {
          setRows(data);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, version]);
  const cats = categories.map((c) => ({ value: c.id, label: c.name }));
  const accs = accounts.map((a) => ({ value: a.id, label: a.name }));
  const fields: Field[] =
    tab === "accounts"
      ? [
          { key: "name", label: "Nombre de la cuenta", required: true },
          {
            key: "initialBalance",
            label: "Saldo inicial (€)",
            kind: "number",
            required: true,
          },
        ]
      : tab === "categories"
        ? [
            { key: "name", label: "Nombre", required: true },
            { key: "color", label: "Color", kind: "color" },
            { key: "icon", label: "Icono (emoji)" },
            {
              key: "type",
              label: "Tipo",
              options: [
                { value: "EXPENSE", label: "Gasto" },
                { value: "INCOME", label: "Ingreso" },
              ],
            },
            {
              key: "parentId",
              label: "Categoría superior (opcional)",
              options: cats.filter((c) => c.value !== edit?.id),
            },
          ]
        : tab === "rules"
          ? [
              {
                key: "keyword",
                label: "Palabra clave del concepto",
                required: true,
              },
              {
                key: "categoryId",
                label: "Asignar a la categoría",
                options: cats,
                required: true,
              },
            ]
          : [
              { key: "concept", label: "Concepto", required: true },
              {
                key: "amount",
                label: "Importe (€)",
                kind: "number",
                required: true,
              },
              {
                key: "type",
                label: "Tipo",
                options: [
                  { value: "EXPENSE", label: "Gasto" },
                  { value: "INCOME", label: "Ingreso" },
                ],
              },
              {
                key: "accountId",
                label: "Cuenta",
                options: accs,
                required: true,
              },
              { key: "categoryId", label: "Categoría", options: cats },
              {
                key: "frequency",
                label: "Frecuencia",
                options: [
                  { value: "WEEKLY", label: "Semanal" },
                  { value: "MONTHLY", label: "Mensual" },
                  { value: "YEARLY", label: "Anual" },
                ],
              },
              {
                key: "nextDate",
                label: "Próxima fecha",
                kind: "date",
                required: true,
              },
            ];
  function open(row?: Row) {
    setEdit(row);
    const base: Record<string, string> = {
      initialBalance: "0",
      color: "#187962",
      icon: "●",
      type: "EXPENSE",
      frequency: "MONTHLY",
      nextDate: today(),
      priority: "0",
      accountId: accounts[0]?.id || "",
    };
    if (row)
      Object.entries(row).forEach(([k, v]) => {
        if (v != null) base[k] = String(v);
      });
    if (row?.initialBalanceCents !== undefined)
      base.initialBalance = String(row.initialBalanceCents / 100);
    if (row?.amountCents !== undefined)
      base.amount = String(row.amountCents / 100);
    setForm(base);
    setError("");
    setShow(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {};
      fields.forEach((f) => {
        const value = form[f.key];
        if (value !== undefined && value !== "")
          payload[f.key] =
            f.kind === "number" ? Number(value.replace(",", ".")) : value;
      });
      if (tab === "categories" && !form.parentId) payload.parentId = null;
      if (tab === "recurrences" && !form.categoryId) payload.categoryId = null;
      await api(`/${tab}${edit ? `/${edit.id}` : ""}`, {
        method: edit ? "PUT" : "POST",
        body: json(payload),
      });
      setShow(false);
      setVersion((v) => v + 1);
      if (tab === "accounts" || tab === "categories") onChange();
      notify("Cambios guardados");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: Row) {
    if (
      !confirm(
        `¿Eliminar «${row.name || row.concept || row.keyword}»? Los elementos en uso pueden requerir reasignación.`,
      )
    )
      return;
    try {
      await api(`/${tab}/${row.id}`, { method: "DELETE" });
      setVersion((v) => v + 1);
      if (tab === "accounts" || tab === "categories") onChange();
      notify("Elemento eliminado");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function run() {
    setBusy(true);
    try {
      const result = await api<{ generated: number }>("/recurrences/run", {
        method: "POST",
      });
      notify(`${result.generated} movimientos recurrentes generados`);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-tabs">
        {(Object.keys(names) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setError("");
            }}
            className={t === tab ? "selected" : ""}
          >
            {names[t]}
          </button>
        ))}
      </div>
      {tab === "keys" ? (
        <Keys notify={notify} />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{names[tab]}</h2>
              <p>
                {tab === "accounts"
                  ? "Una vista de todos los lugares donde está tu dinero."
                  : tab === "categories"
                    ? "Organiza tus movimientos a tu manera."
                    : tab === "rules"
                      ? "Si el concepto contiene una palabra, asignamos la categoría."
                      : "Las próximas fechas se generan al procesar los movimientos pendientes."}
              </p>
            </div>
            <div className="inline-actions">
              {tab === "recurrences" && (
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={run}
                >
                  <RefreshCw size={15} />
                  Procesar vencidos
                </button>
              )}
              <button className="button primary small" onClick={() => open()}>
                <Plus size={16} />
                Añadir
              </button>
            </div>
          </div>
          {error && <ErrorBox message={error} />}{" "}
          {loading ? (
            <Loading />
          ) : !rows.length ? (
            <Empty title="Todavía no hay elementos">
              Añade el primero y empieza a personalizar tu espacio.
            </Empty>
          ) : (
            <div className="settings-list">
              {rows.map((row) => (
                <div key={row.id} className="settings-row">
                  <span
                    className="settings-row-icon"
                    style={
                      row.color
                        ? { background: `${row.color}20`, color: row.color }
                        : undefined
                    }
                  >
                    {row.icon ||
                      (tab === "accounts" ? "€" : tab === "rules" ? "↳" : "↻")}
                  </span>
                  <div>
                    <strong>{row.name || row.concept || row.keyword}</strong>
                    <small>
                      {tab === "accounts"
                        ? `Saldo inicial: ${eur(row.initialBalanceCents || 0)}`
                        : tab === "categories"
                          ? `${row.type === "INCOME" ? "Ingreso" : "Gasto"}${row.parentId ? ` · Subcategoría de ${categories.find((c) => c.id === row.parentId)?.name || ""}` : ""}`
                          : tab === "rules"
                            ? `→ ${categories.find((c) => c.id === row.categoryId)?.name || "Categoría"}`
                            : `${eur(row.amountCents || 0)} · ${({ WEEKLY: "Semanal", MONTHLY: "Mensual", YEARLY: "Anual" } as Record<string, string>)[row.frequency || "MONTHLY"]} · Próxima: ${row.nextDate ? dateLabel(row.nextDate) : "—"}`}
                    </small>
                  </div>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      aria-label="Editar"
                      onClick={() => open(row)}
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      className="icon-button red"
                      aria-label="Eliminar"
                      onClick={() => remove(row)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {show && (
        <Modal
          title={`${edit ? "Editar" : "Añadir"} · ${names[tab].toLowerCase()}`}
          onClose={() => setShow(false)}
        >
          <form className="form-stack" onSubmit={save}>
            {error && <ErrorBox message={error} />}{" "}
            {fields.map((field) => (
              <label key={field.key}>
                {field.label}
                {field.options ? (
                  <select
                    required={field.required}
                    value={form[field.key] || ""}
                    onChange={(e) =>
                      setForm({ ...form, [field.key]: e.target.value })
                    }
                  >
                    <option value="">Selecciona una opción</option>
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required={field.required}
                    type={field.kind || "text"}
                    step={field.kind === "number" ? "0.01" : undefined}
                    value={form[field.key] || ""}
                    onChange={(e) =>
                      setForm({ ...form, [field.key]: e.target.value })
                    }
                  />
                )}
              </label>
            ))}
            <button className="button primary full" disabled={busy}>
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
type ApiKey = {
  id: string;
  name: string;
  prefix?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};
function Keys({ notify }: { notify: (s: string) => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("Mi bot de Telegram");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api<ApiKey[]>("/integrations/keys")
      .then(setKeys)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  useEffect(() => {
    void load();
  }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ key?: string; apiKey?: string }>(
        "/integrations/keys",
        { method: "POST", body: json({ name }) },
      );
      setSecret(result.key || result.apiKey || "");
      await load();
      notify("Clave creada. Guárdala en un lugar seguro.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(key: ApiKey) {
    if (
      !confirm(
        `¿Revocar «${key.name}»? El bot dejará de tener acceso con esta clave.`,
      )
    )
      return;
    try {
      await api(`/integrations/keys/${key.id}`, { method: "DELETE" });
      await load();
      setSecret("");
      notify("Clave revocada");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="import-layout">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Tu agente, conectado</h2>
            <p>Crea una clave independiente para cada integración.</p>
          </div>
          <KeyRound size={24} className="muted" />
        </div>
        {error && <ErrorBox message={error} />}
        <form onSubmit={create} className="key-form">
          <label>
            Nombre de la integración
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </label>
          <button className="button primary" disabled={busy}>
            <Plus size={16} />
            Generar clave
          </button>
        </form>
        {secret && (
          <div className="secret-box">
            <strong>Esta clave solo se muestra una vez</strong>
            <p>
              Guárdala como FINANZAS_API_KEY en tu bot. Nunca la compartas en un
              chat.
            </p>
            <code>{secret}</code>
            <button
              className="button secondary small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(secret);
                  notify("Clave copiada");
                } catch {
                  setError("Selecciona la clave y cópiala manualmente.");
                }
              }}
            >
              <Copy size={15} />
              Copiar clave
            </button>
          </div>
        )}
        {loading ? (
          <Loading />
        ) : !keys.length ? (
          <Empty title="Sin integraciones activas">
            Tu primer bot está a una clave de distancia.
          </Empty>
        ) : (
          <div className="settings-list">
            {keys.map((k) => (
              <div className="settings-row" key={k.id}>
                <span className="settings-row-icon">
                  <KeyRound size={19} />
                </span>
                <div>
                  <strong>{k.name}</strong>
                  <small>
                    {k.prefix}… · Creada el {dateLabel(k.createdAt)}
                    {k.revokedAt ? " · Revocada" : ""}
                  </small>
                </div>
                {!k.revokedAt && (
                  <button
                    className="button danger small"
                    onClick={() => revoke(k)}
                  >
                    Revocar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel integration-guide">
        <ShieldCheck size={27} />
        <h2>Del mensaje al movimiento</h2>
        <p>El ejemplo de bot del proyecto entiende mensajes como:</p>
        <div className="chat-bubble">café 2,50</div>
        <div className="chat-bubble">nómina 1800 ingreso</div>
        <ul>
          <li>
            <Check size={15} />
            Los movimientos llegan con origen Telegram.
          </li>
          <li>
            <Check size={15} />
            Las categorías se asignan por tus reglas.
          </li>
          <li>
            <Check size={15} />
            Tú revisas y confirmas desde Movimientos.
          </li>
        </ul>
        <p>
          Consulta el README para configurar grammY, conectar un agente LLM o
          crear el flujo en n8n.
        </p>
        <code>POST /api/integrations/telegram/movements</code>
        <code>GET /api/integrations/telegram/summary</code>
        <p className="muted">
          Usa el encabezado X-API-Key en las peticiones. No compartas tu
          contraseña con el bot.
        </p>
      </section>
    </div>
  );
}
