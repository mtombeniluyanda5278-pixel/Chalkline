import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { closeRedis, connectRedis } from "./rateLimit.js";

const app = await buildApp();

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
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

  await app.listen({
    port: config.PORT,
    host: "0.0.0.0",
  });
} catch (err) {
  console.error("Failed to start Chalkline:", err);

  try {
    await closeRedis();
  } catch {
    // Redis may not have connected successfully.
  }

  await pool.end();
  process.exit(1);
}
