import { mkdir, copyFile, rm } from "node:fs/promises";
const files = [
  "index.html",
  "styles.css",
  "app.js",
  "theme.js",
  "workspace.js",
  "lessons.js",
  "loading.js",
  "authenticator-ui.js",
  "autosave.js",
  "extras.js",
  "readers.js",
  "resource-preview.js",
];
// Reject broken browser modules before publishing the static bundle.
const { execFileSync } = await import("node:child_process");
for (const file of files.filter((file) => file.endsWith(".js")))
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
await rm("public-build", { recursive: true, force: true });
await mkdir("public-build", { recursive: true });
for (const file of files) await copyFile(file, "public-build/" + file);
console.log("Static bundle created from the explicit public-file allowlist.");

await mkdir("public-build/vendor", { recursive: true });
for (const file of ["pdf.mjs", "pdf.worker.mjs"])
  await copyFile(
    "node_modules/pdfjs-dist/build/" + file,
    "public-build/vendor/" + file,
  );
