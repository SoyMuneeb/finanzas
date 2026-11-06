import type { ReactNode } from "react";
import { AlertCircle, Check, LoaderCircle, X } from "lucide-react";
import type { Account, Category, Filters } from "./api";
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" size={28} />
      <span>Preparando tus datos…</span>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">↗</div>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      {message}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Toast({ text }: { text: string }) {
  return (
    <div className="toast" role="status">
      <Check size={18} />
      {text}
    </div>
  );
}
export function FilterBar({
  filters,
  setFilters,
  accounts,
  categories,
}: {
  filters: Filters;
  setFilters: (value: Filters) => void;
  accounts: Account[];
  categories: Category[];
}) {
  return (
    <div className="filter-bar">
      <label>
        Desde
        <input
          aria-label="Fecha inicial"
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
        />
      </label>
      <label>
        Hasta
        <input
          aria-label="Fecha final"
          type="date"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
        />
      </label>
      <label>
        Cuenta
        <select
          value={filters.accountId}
          onChange={(e) =>
            setFilters({ ...filters, accountId: e.target.value })
          }
        >
          <option value="">Todas las cuentas</option>
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
          value={filters.categoryId}
          onChange={(e) =>
            setFilters({ ...filters, categoryId: e.target.value })
          }
        >
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
