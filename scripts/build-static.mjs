import { mkdir, copyFile, rm, stat } from "node:fs/promises";
import { build } from "esbuild";

// The browser entry point. esbuild follows its import graph, so the modules it
// pulls in (workspace, lessons, extras, …) are no longer separate requests and
// are not copied individually.
const ENTRY = "app.js";

// Loaded ahead of the bundle by index.html as a classic script, so it stays a
// separate file: it sets the theme before first paint to avoid a flash.
const STANDALONE_SCRIPTS = ["theme.js"];

// Copied verbatim. index.html is the shell; the rest are not JavaScript.
const VERBATIM = ["index.html"];

const MODULES = [
  "app.js",
  "workspace.js",
  "lessons.js",
  "loading.js",
  "authenticator-ui.js",
  "autosave.js",
  "extras.js",
  "readers.js",
  "resource-preview.js",
  "theme.js",
];

// Reject broken browser modules before publishing the static bundle.
const { execFileSync } = await import("node:child_process");
for (const file of MODULES)
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });

await rm("public-build", { recursive: true, force: true });
await mkdir("public-build", { recursive: true });

for (const file of VERBATIM) await copyFile(file, "public-build/" + file);

const bytes = async (path) => (await stat(path)).size;
const before =
  (await Promise.all(MODULES.map(bytes))).reduce((a, b) => a + b, 0) +
  (await bytes("styles.css"));

await build({
  entryPoints: [ENTRY],
  outfile: "public-build/app.js",
  bundle: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  sourcemap: true,
  legalComments: "none",
  // pdf.js is copied to public-build/vendor and imported at runtime, so it
  // must stay an external URL rather than being inlined into the bundle.
  external: ["./vendor/*", "/vendor/*"],
});

for (const file of STANDALONE_SCRIPTS)
  await build({
    entryPoints: [file],
    outfile: "public-build/" + file,
    bundle: true,
    format: "iife",
    target: ["es2022"],
    minify: true,
    sourcemap: true,
    legalComments: "none",
  });

await build({
  entryPoints: ["styles.css"],
  outfile: "public-build/styles.css",
  bundle: true,
  minify: true,
  sourcemap: true,
  loader: { ".woff": "file", ".woff2": "file" },
});

const after =
  (await bytes("public-build/app.js")) +
  (await bytes("public-build/theme.js")) +
  (await bytes("public-build/styles.css"));

console.log(
  `Static bundle created. ${(before / 1024).toFixed(0)} KB across ${
    MODULES.length + 1
  } files -> ${(after / 1024).toFixed(0)} KB across 3 (${(
    (1 - after / before) *
    100
  ).toFixed(0)}% smaller).`,
);

await mkdir("public-build/vendor", { recursive: true });
for (const file of ["pdf.mjs", "pdf.worker.mjs"])
  await copyFile(
    "node_modules/pdfjs-dist/build/" + file,
    "public-build/vendor/" + file,
  );
