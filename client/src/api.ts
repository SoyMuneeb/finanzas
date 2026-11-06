export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = sessionStorage.getItem("finanza-token");
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...options, headers });
  if (!response.ok) {
    let message = `No se pudo completar la operación (${response.status}).`;
    try {
      const body = await response.json();
      message =
        typeof body.error === "string"
          ? body.error
          : body.message || body.error?.message || message;
    } catch {
      /* Response can be empty. */
    }
    if (response.status === 401 && token) {
      sessionStorage.removeItem("finanza-token");
      window.dispatchEvent(new Event("auth-expired"));
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export async function download(path: string, filename: string) {
  const response = await fetch(`/api${path}`, {
    headers: {
      Authorization: `Bearer ${sessionStorage.getItem("finanza-token") || ""}`,
    },
  });
  if (!response.ok) throw new Error("No se pudo descargar el archivo.");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
export const json = (value: unknown) => JSON.stringify(value);
export const eur = (cents: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    (cents || 0) / 100,
  );
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("es-ES").format(new Date(date));
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export type Account = { id: string; name: string; initialBalanceCents: number };
export type Category = {
  id: string;
  name: string;
  color: string;
  icon: string;
  parentId?: string | null;
  type?: string;
};
export type Movement = {
  id: string;
  date: string;
  concept: string;
  amountCents: number;
  type: "INCOME" | "EXPENSE";
  categoryId?: string | null;
  accountId: string;
  notes?: string | null;
  source: string;
  reviewPending: boolean;
  category?: Category | null;
  account?: Account;
};
export type Filters = {
  from: string;
  to: string;
  accountId: string;
  categoryId: string;
};
export const query = (values: object) => {
  const p = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== "" && value != null) p.set(key, String(value));
  });
  return p.toString();
};
