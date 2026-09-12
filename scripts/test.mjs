import { spawnSync } from "node:child_process";
import { localEnvironment } from "./local-environment.mjs";
import { bootstrapLocal } from "./local-bootstrap.mjs";
try {
  let env;
  if (process.env.CHIX_ISOLATED_TEST === "true")
    env = {
      ...process.env,
      NODE_ENV: "test",
      DOTENV_CONFIG_PATH: ".local/no-dotenv",
    };
  else {
    await bootstrapLocal();
    env = { ...process.env, ...(await localEnvironment(true)) };
  }
  delete env.LOCAL_OWNER_URL;
  const result = spawnSync(
    "node",
    [
      "node_modules/tsx/dist/cli.mjs",
      "--test",
      "--test-concurrency=1",
      "src/**/*.test.ts",
    ],
    { env, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} catch {
  console.error(
    "Tests could not start. Run docker compose up -d first; the real .env is never used.",
  );
  process.exitCode = 1;
}
