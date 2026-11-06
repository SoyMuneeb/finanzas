import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Search,
  Trash2,
} from "lucide-react";
import { api, dateLabel, eur, json, query, today } from "./api";
import type { Account, Category, Filters, Movement } from "./api";
import { Empty, ErrorBox, Loading } from "./ui";
export default function Movements({
  filters,
  review,
  onEdit,
  onChange,
  notify,
}: {
  filters: Filters;
  accounts: Account[];
  categories: Category[];
  review: boolean;
  onEdit: (m: Movement) => void;
  onChange: () => void;
  notify: (message: string) => void;
}) {
  const [items, setItems] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState("");
  const [pending, setPending] = useState(review);
  const [sort, setSort] = useState("date");
  const [order, setOrder] = useState("desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setPending(review);
    setPage(1);
  }, [review]);
  useEffect(() => {
    setPage(1);
  }, [filters, type, pending]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<{ items: Movement[]; total: number }>(
      `/movements?${query({ ...filters, page, pageSize: 15, search: debounced, type, reviewPending: pending ? "true" : "", sort, order })}`,
    )
      .then((data) => {
        if (active) {
          setItems(data.items);
          setTotal(data.total);
          setSelected([]);
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
  }, [filters, page, debounced, type, pending, sort, order]);
  async function remove(ids: string[]) {
    if (
      !window.confirm(
        `¿Eliminar ${ids.length === 1 ? "este movimiento" : `estos ${ids.length} movimientos`}? Esta acción no se puede deshacer.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api("/movements/bulk-delete", {
        method: "POST",
        body: json({ ids }),
      });
      notify("Movimientos eliminados");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reviewed(m: Movement) {
    setBusy(true);
    try {
      await api(`/movements/${m.id}`, {
        method: "PUT",
        body: json({
          date: m.date.slice(0, 10),
          concept: m.concept,
          amount: m.amountCents / 100,
          type: m.type,
          accountId: m.accountId,
          categoryId: m.categoryId,
          notes: m.notes || "",
          reviewPending: false,
        }),
      });
      notify("Movimiento revisado");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function sorting(field: string) {
    setSort(field);
    setOrder(order === "desc" ? "asc" : "desc");
    setPage(1);
  }
  return (
    <section className="panel movements-panel">
      <div className="panel-heading">
        <div>
          <h2>
            Tu historial, al día <span className="count">{total}</span>
          </h2>
          <p>Lo que entra, lo que sale y todo lo que importa.</p>
        </div>
        {selected.length > 0 && (
          <button
            className="button danger small"
            disabled={busy}
            onClick={() => remove(selected)}
          >
            <Trash2 size={15} />
            Eliminar ({selected.length})
          </button>
        )}
      </div>
      <div className="table-tools">
        <div className="search-input">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar un concepto…"
            aria-label="Buscar movimientos"
          />
        </div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Tipo de movimiento"
        >
          <option value="">Ingresos y gastos</option>
          <option value="INCOME">Solo ingresos</option>
          <option value="EXPENSE">Solo gastos</option>
        </select>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={pending}
            onChange={(e) => setPending(e.target.checked)}
          />
          Pendientes de revisión
        </label>
      </div>
      {error && <ErrorBox message={error} />}{" "}
      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty title="Sin movimientos en este periodo">
          Prueba con otras fechas o añade un movimiento.
        </Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="check-col">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar página"
                    checked={
                      items.length > 0 && selected.length === items.length
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? items.map((m) => m.id) : [],
                      )
                    }
                  />
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => sorting("date")}
                  >
                    Fecha ↕
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => sorting("concept")}
                  >
                    Concepto ↕
                  </button>
                </th>
                <th>Categoría</th>
                <th>Cuenta / origen</th>
                <th className="text-right">
                  <button
                    className="sort-button"
                    onClick={() => sorting("amountCents")}
                  >
                    Importe ↕
                  </button>
                </th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <input
                      aria-label={`Seleccionar ${m.concept}`}
                      type="checkbox"
                      checked={selected.includes(m.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, m.id]
                            : selected.filter((id) => id !== m.id),
                        )
                      }
                    />
                  </td>
                  <td className="date-cell">{dateLabel(m.date)}</td>
                  <td>
                    <div className="concept-cell">
                      <span
                        className={`movement-icon ${m.type === "INCOME" ? "income" : "expense"}`}
                      >
                        {m.type === "INCOME" ? (
                          <ArrowDownLeft size={17} />
                        ) : (
                          <ArrowUpRight size={17} />
                        )}
                      </span>
                      <div>
                        <strong>{m.concept}</strong>
                        {m.notes && <small title={m.notes}>{m.notes}</small>}
                        {m.reviewPending && (
                          <span className="review-badge">Por revisar</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="category-tag">
                      <span
                        className="color-dot"
                        style={{ background: m.category?.color || "#b7beb9" }}
                      />
                      {m.category?.name || "Sin categorizar"}
                    </span>
                  </td>
                  <td>
                    <div className="account-cell">
                      {m.account?.name || "Cuenta"}
                      <small>
                        {(
                          {
                            MANUAL: "Manual",
                            TELEGRAM: "Telegram",
                            IMPORT: "Importación",
                          } as Record<string, string>
                        )[m.source] || m.source}
                      </small>
                    </div>
                  </td>
                  <td
                    className={`amount-cell ${m.type === "INCOME" ? "positive" : ""}`}
                  >
                    {m.type === "INCOME" ? "+" : "−"}
                    {eur(m.amountCents)}
                  </td>
                  <td>
                    <div className="row-actions">
                      {m.reviewPending && (
                        <button
                          disabled={busy}
                          className="icon-button"
                          title="Marcar revisado"
                          onClick={() => reviewed(m)}
                        >
                          <Check size={16} />
                        </button>
                      )}
                      <button
                        className="icon-button"
                        title="Editar movimiento"
                        onClick={() => onEdit(m)}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="icon-button red"
                        disabled={busy}
                        title="Eliminar movimiento"
                        onClick={() => remove([m.id])}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination">
        <span>
          {total
            ? `${(page - 1) * 15 + 1}–${Math.min(page * 15, total)} de ${total} movimientos`
            : "0 movimientos"}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Página anterior"
            disabled={page === 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            Página {page} de {Math.max(1, Math.ceil(total / 15))}
          </span>
          <button
            className="icon-button"
            aria-label="Página siguiente"
            disabled={page * 15 >= total || loading}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}
export function MovementForm({
  movement,
  accounts,
  categories,
  onSaved,
}: {
  movement?: Movement;
  accounts: Account[];
  categories: Category[];
  onSaved: () => void;
}) {
  const [date, setDate] = useState(movement?.date.slice(0, 10) || today());
  const [concept, setConcept] = useState(movement?.concept || "");
  const [amount, setAmount] = useState(
    movement ? String(movement.amountCents / 100) : "",
  );
  const [type, setType] = useState(movement?.type || "EXPENSE");
  const [accountId, setAccountId] = useState(
    movement?.accountId || accounts[0]?.id || "",
  );
  const [categoryId, setCategoryId] = useState(movement?.categoryId || "");
  const [notes, setNotes] = useState(movement?.notes || "");
  const [frequency, setFrequency] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = {
      date,
      concept,
      amount: Number(amount.replace(",", ".")),
      type,
      accountId,
      categoryId: categoryId || undefined,
      notes,
    };
    try {
      if (frequency && !movement) {
        // Start on the chosen date so the server preserves month-end anchors.
        await api("/recurrences", {
          method: "POST",
          body: json({ ...data, frequency, nextDate: date }),
        });
        await api("/recurrences/run", { method: "POST" });
      } else {
        await api(`/movements${movement ? `/${movement.id}` : ""}`, {
          method: movement ? "PUT" : "POST",
          body: json(data),
        });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      {error && <ErrorBox message={error} />}
      <div className="segmented form-type">
        <button
          type="button"
          className={type === "EXPENSE" ? "selected" : ""}
          onClick={() => setType("EXPENSE")}
        >
          <ArrowUpRight size={16} />
          Gasto
        </button>
        <button
          type="button"
          className={type === "INCOME" ? "selected" : ""}
          onClick={() => setType("INCOME")}
        >
          <ArrowDownLeft size={16} />
          Ingreso
        </button>
      </div>
      <div className="form-grid">
        <label>
          Importe (€)
          <input
            required
            autoFocus
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            pattern="[0-9]+([.,][0-9]{1,2})?"
          />
        </label>
        <label>
          Fecha
          <input
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      <label>
        Concepto
        <input
          required
          maxLength={250}
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="¿En qué has gastado o qué has recibido?"
        />
      </label>
      <div className="form-grid">
        <label>
          Cuenta
          <select
            required
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Selecciona una cuenta</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoría
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Automática / sin categorizar</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Notas (opcional)
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Algo que quieras recordar…"
        />
      </label>
      {!movement && (
        <label>
          Repetir este movimiento
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
          >
            <option value="">No repetir</option>
            <option value="WEEKLY">Cada semana</option>
            <option value="MONTHLY">Cada mes</option>
            <option value="YEARLY">Cada año</option>
          </select>
        </label>
      )}{" "}
      {!accounts.length && (
        <p className="muted">
          Crea una cuenta en Configuración antes de añadir movimientos.
        </p>
      )}
      <button
        className="button primary full"
        disabled={busy || !accounts.length}
      >
        {busy
          ? "Guardando…"
          : movement
            ? "Guardar cambios"
            : "Añadir movimiento"}
      </button>
    </form>
  );
}
