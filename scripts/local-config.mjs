// Runs in the Compose setup container. Never reads or writes the user's .env.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const directory = process.argv[2] ?? "/config";
await mkdir(directory, { recursive: true, mode: 0o700 });
let secrets;
try {
  secrets = JSON.parse(await readFile(directory + "/credentials.json", "utf8"));
} catch (error) {
  if (error.code !== "ENOENT")
    throw new Error(
      "Local credential file could not be read. Restore its matching backup; no credentials were replaced.",
    );
  secrets = Object.fromEntries(
    [
      "owner",
      "app",
      "test",
      "redis",
      "session",
      "outbox",
      "rate",
      "storage",
    ].map((key) => [key, randomBytes(32).toString("hex")]),
  );
  await writeFile(directory + "/credentials.json", JSON.stringify(secrets), {
    mode: 0o600,
    flag: "wx",
  });
}
// Credentials predating a service are generated on first run rather than
// rejected, so adding one never invalidates an existing local setup. Existing
// values are only ever read, never regenerated.
let added = false;
for (const key of ["storage"]) {
  if (secrets[key] === undefined) {
    secrets[key] = randomBytes(32).toString("hex");
    added = true;
  }
}
if (added)
  await writeFile(directory + "/credentials.json", JSON.stringify(secrets), {
    mode: 0o600,
  });
for (const key of [
  "owner",
  "app",
  "test",
  "redis",
  "session",
  "outbox",
  "rate",
  "storage",
]) {
  if (typeof secrets[key] !== "string" || !/^[a-f0-9]{64}$/.test(secrets[key]))
    throw new Error(
      "Local credential file is incomplete or invalid. Restore its matching backup; existing credentials were not replaced.",
    );
}
await writeFile(directory + "/owner-password", secrets.owner, { mode: 0o600 });
await writeFile(directory + "/redis-password", secrets.redis, { mode: 0o600 });
await writeFile(directory + "/storage-password", secrets.storage, {
  mode: 0o600,
});
console.log("Local development credentials ready (values omitted).");
