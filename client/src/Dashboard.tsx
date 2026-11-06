import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  PiggyBank,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, eur, query } from "./api";
import type { Filters } from "./api";
import { Empty, ErrorBox, Loading } from "./ui";
type Summary = {
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  savingsRate: number;
  monthly: { month: string; incomeCents: number; expenseCents: number }[];
  categories: { name: string; color: string; amountCents: number }[];
  balance: { date: string; balanceCents: number }[];
  reviewCount: number;
};
const axis = { fontSize: 11, fill: "#88948f" };
export default function Dashboard({ filters }: { filters: Filters }) {
  const [data, setData] = useState<Summary>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(undefined);
    api<Summary>(`/dashboard?${query(filters)}`)
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [filters]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const cards = [
    {
      label: "Ingresos del periodo",
      value: eur(data.incomeCents),
      icon: ArrowDownLeft,
      kind: "income",
      note: "Todo lo que ha entrado",
    },
    {
      label: "Gastos del periodo",
      value: eur(data.expenseCents),
      icon: ArrowUpRight,
      kind: "expense",
      note: "Tu consumo en perspectiva",
    },
    {
      label: "Balance del periodo",
      value: eur(data.balanceCents),
      icon: Wallet,
      kind: "balance",
      note: "Ingresos menos gastos",
    },
    {
      label: "Tasa de ahorro",
      value: `${(data.savingsRate || 0).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`,
      icon: PiggyBank,
      kind: "saving",
      note: "De tus ingresos del periodo",
    },
  ];
  const total = data.categories.reduce((sum, c) => sum + c.amountCents, 0);
  const leading = data.categories[0];
  return (
    <>
      <div className="summary-grid">
        {cards.map((c) => (
          <article key={c.label} className={`summary-card ${c.kind}`}>
            <div className="summary-top">
              <span>{c.label}</span>
              <span className="summary-icon">
                <c.icon size={19} />
              </span>
            </div>
            <strong>{c.value}</strong>
            <div className="summary-bottom">
              <span className="tiny-dot" />
              {c.note}
            </div>
          </article>
        ))}
      </div>
      <div className="chart-grid">
        <section className="panel income-chart">
          <div className="panel-heading">
            <div>
              <h2>El pulso de tu dinero</h2>
              <p>Ingresos y gastos, mes a mes</p>
            </div>
            <span className="subtle-icon">
              <TrendingUp size={21} />
            </span>
          </div>
          {data.monthly.length ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={data.monthly}
                  barGap={5}
                  margin={{ top: 10, right: 5, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--line)"
                    strokeDasharray="3 4"
                  />
                  <XAxis
                    dataKey="month"
                    tick={axis}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => {
                      const d = new Date(`${value}-01`);
                      return Number.isNaN(d.getTime())
                        ? value
                        : d.toLocaleDateString("es-ES", { month: "short" });
                    }}
                  />
                  <YAxis
                    tick={axis}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    tickFormatter={(v) => `${Math.round(v / 100)} €`}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--hover)" }}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--line)",
                      background: "var(--panel)",
                    }}
                    formatter={(value) => eur(Number(value))}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                  />
                  <Bar
                    dataKey="incomeCents"
                    name="Ingresos"
                    fill="#187962"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="expenseCents"
                    name="Gastos"
                    fill="#d9ad71"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={26}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty title="Aún no hay datos">
              Añade tu primer movimiento para ver la evolución.
            </Empty>
          )}
        </section>
        <section className="panel category-chart">
          <div className="panel-heading">
            <div>
              <h2>¿Dónde va tu dinero?</h2>
              <p>Gastos por categoría</p>
            </div>
            <CircleDollarSign size={21} className="muted" />
          </div>
          {total > 0 ? (
            <>
              <div className="donut-wrap">
                <ResponsiveContainer width="100%" height={205}>
                  <PieChart>
                    <Pie
                      data={data.categories}
                      dataKey="amountCents"
                      nameKey="name"
                      innerRadius={66}
                      outerRadius={87}
                      paddingAngle={4}
                      stroke="none"
                    >
                      {data.categories.map((c, i) => (
                        <Cell
                          key={c.name}
                          fill={
                            c.color ||
                            [
                              "#187962",
                              "#78a68c",
                              "#d9ad71",
                              "#a9c4c0",
                              "#c8b9d4",
                            ][i % 5]
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => eur(Number(value))}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center">
                  <span>Total gastos</span>
                  <strong>{eur(total)}</strong>
                </div>
              </div>
              <div className="category-legend">
                {data.categories.slice(0, 5).map((c) => (
                  <div key={c.name}>
                    <span
                      className="color-dot"
                      style={{ background: c.color }}
                    />
                    <span>{c.name}</span>
                    <strong>{eur(c.amountCents)}</strong>
                    <small>{Math.round((c.amountCents / total) * 100)} %</small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty title="Todo por descubrir">
              Tus categorías aparecerán aquí cuando registres gastos.
            </Empty>
          )}
        </section>
      </div>
      <div className="bottom-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Pequeños pasos, grandes cambios</h2>
              <p>Evolución del balance acumulado en el periodo</p>
            </div>
            <span className="pill green">Balance</span>
          </div>
          {data.balance.length ? (
            <ResponsiveContainer width="100%" height={215}>
              <AreaChart
                data={data.balance}
                margin={{ top: 10, right: 5, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="balanceGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#187962" stopOpacity={0.17} />
                    <stop offset="100%" stopColor="#187962" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--line)"
                  strokeDasharray="3 4"
                />
                <XAxis
                  dataKey="date"
                  tick={axis}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={36}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("es-ES", {
                      day: "2-digit",
                      month: "short",
                    })
                  }
                />
                <YAxis
                  tick={axis}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                  tickFormatter={(v) => `${Math.round(v / 100)} €`}
                />
                <Tooltip
                  labelFormatter={(v) =>
                    new Date(v).toLocaleDateString("es-ES")
                  }
                  formatter={(value) => [eur(Number(value)), "Balance"]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="balanceCents"
                  stroke="#187962"
                  strokeWidth={2.5}
                  fill="url(#balanceGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty title="Tu historia financiera empieza contigo" />
          )}
        </section>
        <section className="insight-panel">
          <span className="insight-icon">
            <PiggyBank size={25} />
          </span>
          <div className="eyebrow">UN MOMENTO PARA PENSAR</div>
          <h2>
            {data.balanceCents >= 0
              ? "Vas construyendo tu tranquilidad."
              : "Cada dato es una oportunidad."}
          </h2>
          <p>
            {data.balanceCents >= 0
              ? `Has reservado ${eur(data.balanceCents)} de tus ingresos en este periodo. Dale un propósito a ese ahorro.`
              : "Tus gastos superan tus ingresos en este periodo. Revisa tus categorías y elige un pequeño ajuste para empezar."}
          </p>
          {leading && (
            <div className="insight-detail">
              <span>Tu mayor categoría de gasto</span>
              <strong>
                {leading.name} <span>{eur(leading.amountCents)}</span>
              </strong>
            </div>
          )}{" "}
          {data.reviewCount > 0 && (
            <small>
              {data.reviewCount} movimiento(s) de Telegram pendientes de
              revisión.
            </small>
          )}
        </section>
      </div>
    </>
  );
}
