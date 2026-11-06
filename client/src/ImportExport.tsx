import { useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { api, dateLabel, download, eur, json, query } from "./api";
import type { Account, Filters } from "./api";
import { Empty, ErrorBox } from "./ui";
type PreviewRow = {
  date: string;
  concept: string;
  amount: number;
  amountCents?: number;
  type: string;
  duplicate: boolean;
  categoryId?: string;
  accountId?: string;
};
type Preview = {
  headers: string[];
  rows: PreviewRow[];
  errors: (string | { row: number; message: string })[];
  mapping: Record<string, string>;
};
export default function ImportExport({
  filters,
  accounts,
  notify,
  onChange,
}: {
  filters: Filters;
  accounts: Account[];
  notify: (s: string) => void;
  onChange: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [profile, setProfile] = useState("generic");
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [preview, setPreview] = useState<Preview>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappingDirty, setMappingDirty] = useState(false);
  const [skip, setSkip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const restoreInput = useRef<HTMLInputElement>(null);
  async function inspect(useMapping = false) {
    if (!file || !accountId) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("profile", profile);
      body.append("accountId", accountId);
      if (useMapping) body.append("mapping", json(mapping));
      const p = await api<Preview>("/import/preview", { method: "POST", body });
      setPreview(p);
      setMapping(p.mapping || {});
      setMappingDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirmImport() {
    if (!preview || mappingDirty) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ imported: number; skipped: number }>(
        "/import/confirm",
        {
          method: "POST",
          body: json({ rows: preview.rows, accountId, skipDuplicates: skip }),
        },
      );
      setSuccess(
        `${result.imported} movimientos importados${result.skipped ? ` · ${result.skipped} duplicados omitidos` : ""}.`,
      );
      setPreview(undefined);
      setFile(undefined);
      notify("Importación completada");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(format: string) {
    setBusy(true);
    try {
      await download(
        `/export?${query({ ...filters, format })}`,
        `finanza-movimientos.${format}`,
      );
      notify("Exportación descargada");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore(file?: File) {
    if (!file) return;
    if (
      !confirm(
        "La restauración reemplazará tus datos financieros actuales. ¿Quieres continuar?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const data = JSON.parse(await file.text());
      await api("/backup", { method: "POST", body: json(data) });
      notify("Copia de seguridad restaurada");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (restoreInput.current) restoreInput.current.value = "";
    }
  }
  return (
    <>
      {error && <ErrorBox message={error} />}{" "}
      {success && (
        <div className="success">
          <CheckCircle2 size={19} />
          {success}
        </div>
      )}
      <div className="import-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Trae tus movimientos</h2>
              <p>CSV y Excel, de tu banco a tu espacio.</p>
            </div>
            <FileSpreadsheet size={24} className="muted" />
          </div>
          <div className="import-steps">
            <span className="active">
              1 <small>Subir archivo</small>
            </span>
            <ArrowRight size={15} />
            <span className={preview ? "active" : ""}>
              2 <small>Revisar y mapear</small>
            </span>
            <ArrowRight size={15} />
            <span>
              3 <small>Confirmar</small>
            </span>
          </div>
          <div className="form-stack">
            <div className="form-grid">
              <label>
                Entidad / perfil
                <select
                  value={profile}
                  onChange={(e) => {
                    setProfile(e.target.value);
                    setPreview(undefined);
                  }}
                >
                  {[
                    ["generic", "Genérico · mapeo manual"],
                    ["bbva", "BBVA"],
                    ["santander", "Santander"],
                    ["caixabank", "CaixaBank"],
                    ["sabadell", "Sabadell"],
                    ["ing", "ING"],
                    ["revolut", "Revolut"],
                    ["n26", "N26"],
                  ].map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cuenta de destino
                <select
                  required
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setPreview(undefined);
                  }}
                >
                  <option value="">Elige una cuenta</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="drop-zone">
              <span className="upload-icon">
                <Upload size={25} />
              </span>
              <strong>
                {file ? file.name : "Selecciona tu extracto bancario"}
              </strong>
              <span>CSV o XLSX · hasta 8 MB</span>
              <input
                type="file"
                accept=".csv,.xlsx,.txt"
                onChange={(e) => {
                  setFile(e.target.files?.[0]);
                  setPreview(undefined);
                  setError("");
                }}
              />
            </label>
            <p className="muted">
              Detectamos automáticamente UTF-8, UTF-16 y Windows-1252 para los
              extractos en español.
            </p>
            <button
              className="button primary"
              disabled={!file || !accountId || busy}
              onClick={() => inspect()}
            >
              <FileUp size={17} />
              {busy ? "Procesando…" : "Detectar y previsualizar"}
            </button>
          </div>
        </section>
        <div className="export-stack">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Llévate tus datos</h2>
                <p>Se aplican los filtros del periodo.</p>
              </div>
              <Download size={22} className="muted" />
            </div>
            <button
              className="export-option"
              disabled={busy}
              onClick={() => exportFile("csv")}
            >
              <span className="file-icon">CSV</span>
              <div>
                <strong>Valores separados por comas</strong>
                <span>Compatible con tu hoja de cálculo</span>
              </div>
              <ArrowRight size={17} />
            </button>
            <button
              className="export-option"
              disabled={busy}
              onClick={() => exportFile("xlsx")}
            >
              <span className="file-icon">XLSX</span>
              <div>
                <strong>Libro de Excel</strong>
                <span>Todos tus movimientos, en orden</span>
              </div>
              <ArrowRight size={17} />
            </button>
          </section>
          <section className="panel backup-panel">
            <ShieldCheck size={25} />
            <h2>Una copia para tu tranquilidad</h2>
            <p>
              Guarda o restaura todos tus datos financieros en un archivo JSON.
              Las contraseñas y claves API no se exportan.
            </p>
            <div className="inline-actions">
              <button
                className="button secondary small"
                disabled={busy}
                onClick={async () => {
                  try {
                    await download("/backup", "finanza-backup.json");
                    notify("Copia de seguridad descargada");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Download size={15} />
                Guardar copia
              </button>
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => restoreInput.current?.click()}
              >
                <RefreshCw size={15} />
                Restaurar
              </button>
            </div>
            <input
              ref={restoreInput}
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(e) => restore(e.target.files?.[0])}
            />
          </section>
        </div>
      </div>
      {preview && (
        <section className="panel preview-panel">
          <div className="panel-heading">
            <div>
              <h2>Revisa antes de importar</h2>
              <p>
                {preview.rows.length} filas válidas ·{" "}
                {preview.rows.filter((r) => r.duplicate).length} posibles
                duplicados · {preview.errors?.length || 0} incidencias
              </p>
            </div>
          </div>
          <div className="mapping-grid">
            {[
              ["date", "Fecha"],
              ["concept", "Concepto"],
              ["amount", "Importe"],
              ["sign", "Signo / tipo"],
              ["income", "Columna de ingresos"],
              ["expense", "Columna de gastos"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <select
                  value={mapping[key] || ""}
                  onChange={(e) => {
                    setMapping({ ...mapping, [key]: e.target.value });
                    setMappingDirty(true);
                  }}
                >
                  <option value="">
                    {key === "sign" ? "En el importe" : "Sin asignar"}
                  </option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() => inspect(true)}
          >
            <RefreshCw size={15} />
            Aplicar mapeo y recalcular
          </button>
          {preview.errors?.length > 0 && (
            <div className="import-errors">
              <strong>Filas que necesitan atención</strong>
              {preview.errors.slice(0, 10).map((e, i) => (
                <p key={i}>
                  {typeof e === "string" ? e : `Fila ${e.row}: ${e.message}`}
                </p>
              ))}
            </div>
          )}
          {preview.rows.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th>Tipo</th>
                    <th className="text-right">Importe</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 40).map((r, i) => (
                    <tr key={i}>
                      <td>{dateLabel(r.date)}</td>
                      <td>{r.concept}</td>
                      <td>{r.type === "INCOME" ? "Ingreso" : "Gasto"}</td>
                      <td className="text-right">
                        {eur(r.amountCents ?? Math.round(r.amount * 100))}
                      </td>
                      <td>
                        <span
                          className={`pill ${r.duplicate ? "amber" : "green"}`}
                        >
                          {r.duplicate ? "Posible duplicado" : "Nuevo"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 40 && (
                <p className="muted">
                  Vista previa de las primeras 40 filas. Se importarán todas las
                  filas válidas.
                </p>
              )}
            </div>
          ) : (
            <Empty title="No se han detectado filas válidas">
              Revisa el mapeo y la codificación.
            </Empty>
          )}
          {mappingDirty && (
            <p className="muted" style={{ marginTop: 15 }}>
              Aplica el nuevo mapeo antes de confirmar la importación.
            </p>
          )}
          <div className="preview-footer">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={skip}
                onChange={(e) => setSkip(e.target.checked)}
              />
              Omitir movimientos duplicados
            </label>
            <button
              className="button primary"
              disabled={busy || !preview.rows.length || mappingDirty}
              onClick={confirmImport}
            >
              <CheckCircle2 size={17} />
              {busy ? "Importando…" : "Confirmar importación"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
