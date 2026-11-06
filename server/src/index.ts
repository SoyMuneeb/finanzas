import { app, runDue } from "./app.js";
import { ensureConfig, prisma } from "./core.js";
ensureConfig();
const server = app.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log("API lista en puerto " + (process.env.PORT || 3001)),
);
// Durable occurrences are unique in the DB. Catch-up is bounded to 500 per rule/run.
const tick = () =>
  runDue().catch((err) => console.error("Recurrencias:", err.message));
void tick();
const timer = setInterval(tick, 60000);
timer.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    });
  });
