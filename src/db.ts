import pg from "pg";

import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,

  max: 10,

  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,

  statement_timeout: 15_000,
  query_timeout: 15_000,

  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});