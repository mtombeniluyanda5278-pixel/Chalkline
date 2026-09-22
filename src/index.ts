import { runMaintenance } from "./worker.js";
import { emailAdapter } from "./mail.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { closeRedis, connectRedis } from "./rateLimit.js";

const app = await buildApp();

let shuttingDown = false;
let maintenance: NodeJS.Timeout | undefined;
let maintenanceBusy = false;

const shutdown = async () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
    clearInterval(maintenance);
    await app.close();
    await closeRedis();
    await pool.end();
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

let startupStage = "PostgreSQL connection";
try {
  await pool.query("SELECT 1");
  startupStage = "Redis connection";
  await connectRedis();

  if (!emailAdapter())
    app.log.warn(
      "Email delivery is not configured. Notifications are queued; configure an adapter before onboarding users who need email recovery.",
    );
  startupStage = "HTTP listener";
  await app.listen({
    port: config.PORT,
    host: config.NODE_ENV === "development" ? "127.0.0.1" : "0.0.0.0",
  });
  maintenance = setInterval(async () => {
    if (maintenanceBusy) return;
    maintenanceBusy = true;
    try {
      await runMaintenance();
    } catch {
      app.log.error(
        "Maintenance failed; check database/storage/notification configuration",
      );
    } finally {
      maintenanceBusy = false;
    }
  }, 3000);
  maintenance.unref();
} catch (err) {
  const code = (err as { code?: unknown } | null)?.code;
  console.error(
    code === "EADDRINUSE"
      ? `Cannot start Chix: port ${config.PORT} is already in use. If Chix is running in another terminal, use that instance or stop it there before restarting.`
      : `Failed to start Chix during ${startupStage}. Check configuration and dependency availability.`,
  );

  try {
    await closeRedis();
  } catch {
    // Redis may not have connected successfully.
  }

  await pool.end();
  process.exit(1);
}
