import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Copy,
  Edit3,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import { api, eur, json, query } from "./api";
import type { Category, Filters } from "./api";
import { Empty, ErrorBox, Loading, Modal } from "./ui";
type Budget = {
  id: string;
  period: "MONTHLY" | "YEARLY";
  year: number;
  month?: number;
  categoryId?: string;
  category?: Category;
  amountCents: number;
  spentCents: number;
  percent: number;
  status: string;
  remainingCents: number;
};
export default function Budgets({
  filters,
  categories,
  notify,
}: {
  filters: Filters;
  categories: Category[];
  notify: (s: string) => void;
}) {
  const [items, setItems] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("MONTHLY");
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<Budget>();
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const d = new Date(
    `${filters.from || new Date().toISOString().slice(0, 10)}T12:00:00`,
  );
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Budget[]>(`/budgets?${query({ year, month, period })}`)
      .then((data) => {
        if (active) {
          setItems(data.filter((b) => b.period === period));
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
  }, [year, month, period, version]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/budgets${edit ? `/${edit.id}` : ""}`, {
        method: edit ? "PUT" : "POST",
        body: json({
          period,
          year,
          ...(period === "MONTHLY" ? { month } : {}),
          amount: Number(amount.replace(",", ".")),
          categoryId: categoryId || null,
        }),
      });
      setShow(false);
      setVersion((v) => v + 1);
      notify("Presupuesto guardado");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    setBusy(true);
    try {
      const prior = new Date(year, month - 2, 1);
      await api("/budgets/copy", {
        method: "POST",
        body: json({
          fromMonth: `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, "0")}`,
          toMonth: `${year}-${String(month).padStart(2, "0")}`,
        }),
      });
      setVersion((v) => v + 1);
      notify("Presupuestos del mes anterior copiados");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("¿Eliminar este presupuesto?")) return;
    try {
      await api(`/budgets/${id}`, { method: "DELETE" });
      setVersion((v) => v + 1);
      notify("Presupuesto eliminado");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function open(b?: Budget) {
    setEdit(b);
    setCategoryId(b?.categoryId || "");
    setAmount(b ? String(b.amountCents / 100) : "");
    setShow(true);
  }
  const alerts = items.filter((b) => b.percent >= 80);
  return (
    <>
      <div className="section-tools">
        <div className="segmented">
          <button
            className={period === "MONTHLY" ? "selected" : ""}
            onClick={() => setPeriod("MONTHLY")}
          >
            Mensual
          </button>
          <button
            className={period === "YEARLY" ? "selected" : ""}
            onClick={() => setPeriod("YEARLY")}
          >
            Anual
          </button>
        </div>
        <div className="inline-actions">
          {period === "MONTHLY" && (
            <button className="button secondary" disabled={busy} onClick={copy}>
              <Copy size={16} />
              Copiar mes anterior
            </button>
          )}
          <button className="button primary" onClick={() => open()}>
            <Plus size={16} />
            Crear presupuesto
          </button>
        </div>
      </div>
      {error && <ErrorBox message={error} />}{" "}
      {alerts.length > 0 && (
        <div className="budget-alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Un buen momento para revisar tus límites</strong>
            <p>
              {alerts.filter((b) => b.percent >= 100).length} presupuesto(s)
              superado(s) y {alerts.filter((b) => b.percent < 100).length} por
              encima del 80 %.
            </p>
          </div>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <section className="panel">
          <Empty title="Dale una intención a tu dinero">
            Crea un presupuesto global o por categoría para este{" "}
            {period === "MONTHLY" ? "mes" : "año"}.
          </Empty>
        </section>
      ) : (
        <div className="budget-grid">
          {items.map((b) => {
            const state =
              b.percent >= 100 ? "red" : b.percent >= 80 ? "amber" : "green";
            return (
              <article className="panel budget-card" key={b.id}>
                <div className="budget-card-top">
                  <span
                    className="budget-symbol"
                    style={{
                      background: b.category?.color
                        ? `${b.category.color}20`
                        : undefined,
                      color: b.category?.color,
                    }}
                  >
                    <Target size={22} />
                  </span>
                  <span className={`pill ${state}`}>
                    {b.percent >= 100
                      ? "Límite superado"
                      : b.percent >= 80
                        ? "Cerca del límite"
                        : "Dentro del objetivo"}
                  </span>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      onClick={() => open(b)}
                      aria-label="Editar presupuesto"
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      className="icon-button red"
                      onClick={() => remove(b.id)}
                      aria-label="Eliminar presupuesto"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <h2>
                  {b.category?.name ||
                    categories.find((c) => c.id === b.categoryId)?.name ||
                    "Presupuesto global"}
                </h2>
                <p className="muted">
                  {period === "YEARLY"
                    ? year
                    : d.toLocaleDateString("es-ES", {
                        month: "long",
                        year: "numeric",
                      })}
                </p>
                <div className="budget-values">
                  <strong>{eur(b.spentCents)}</strong>
                  <span>de {eur(b.amountCents)}</span>
                </div>
                <div className={`progress ${state}`}>
                  <span
                    style={{
                      width: `${Math.min(100, Math.max(0, b.percent))}%`,
                    }}
                  />
                </div>
                <div className="budget-meta">
                  <span>{Math.round(b.percent)} % utilizado</span>
                  <strong>
                    {b.remainingCents >= 0
                      ? `${eur(b.remainingCents)} disponibles`
                      : `${eur(-b.remainingCents)} de exceso`}
                  </strong>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="hint">
        <ArrowRight size={17} />
        <span>
          Los presupuestos comparan tus gastos reales con el límite que eliges.
          Los límites globales y por categoría se calculan de forma
          independiente.
        </span>
      </div>
      {show && (
        <Modal
          title={edit ? "Editar presupuesto" : "Nuevo presupuesto"}
          onClose={() => setShow(false)}
        >
          <form className="form-stack" onSubmit={save}>
            {error && <ErrorBox message={error} />}
            <label>
              Categoría
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Global · todos los gastos</option>
                {categories
                  .filter((c) => c.type !== "INCOME")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Límite de gasto (€)
              <input
                required
                autoFocus
                type="text"
                inputMode="decimal"
                pattern="[0-9]+([.,][0-9]{1,2})?"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500,00"
              />
            </label>
            <p className="muted">
              Se aplicará a{" "}
              {period === "YEARLY"
                ? year
                : d.toLocaleDateString("es-ES", {
                    month: "long",
                    year: "numeric",
                  })}
              . Cambia el rango de fechas para elegir otro periodo.
            </p>
            <button className="button primary" disabled={busy}>
              {busy ? "Guardando…" : "Guardar presupuesto"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
