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

try {
  await pool.query("SELECT 1");
  await connectRedis();

  if (!emailAdapter())
    app.log.warn(
      "Email delivery is not configured. Notifications are queued; configure an adapter before onboarding users who need email recovery.",
    );
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
  await app.listen({
    port: config.PORT,
    host: config.NODE_ENV === "development" ? "127.0.0.1" : "0.0.0.0",
  });
} catch (err) {
  console.error(
    "Failed to start Chix. Check configuration and dependency availability.",
  );

  try {
    await closeRedis();
  } catch {
    // Redis may not have connected successfully.
  }

  await pool.end();
  process.exit(1);
}
