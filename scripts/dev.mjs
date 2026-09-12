import { spawn } from "node:child_process";
import { bootstrapLocal } from "./local-bootstrap.mjs";
import { localEnvironment } from "./local-environment.mjs";
try {
  await bootstrapLocal();
  const env = await localEnvironment();
  delete env.LOCAL_OWNER_URL;
  const child = spawn(
    "node",
    ["node_modules/tsx/dist/cli.mjs", "watch", "src/index.ts"],
    { stdio: "inherit", env: { ...process.env, ...env } },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch {
  console.error(
    "Local startup failed. Check Docker and migration output; credentials were not printed.",
  );
  process.exitCode = 1;
}
