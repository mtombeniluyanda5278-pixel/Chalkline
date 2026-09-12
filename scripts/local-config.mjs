// Runs in the Compose setup container. Never reads or writes the user's .env.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const directory = process.argv[2] ?? "/config";
await mkdir(directory, { recursive: true, mode: 0o700 });
let secrets;
try {
  secrets = JSON.parse(await readFile(directory + "/credentials.json", "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  secrets = Object.fromEntries(
    ["owner", "app", "test", "redis", "session", "outbox", "rate"].map(
      (key) => [key, randomBytes(32).toString("hex")],
    ),
  );
  await writeFile(directory + "/credentials.json", JSON.stringify(secrets), {
    mode: 0o600,
    flag: "wx",
  });
}
await writeFile(directory + "/owner-password", secrets.owner, { mode: 0o600 });
await writeFile(directory + "/redis-password", secrets.redis, { mode: 0o600 });
console.log("Local development credentials ready (values omitted).");
