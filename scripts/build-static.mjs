import { mkdir, copyFile, rm } from "node:fs/promises";
const files = [
  "index.html",
  "styles.css",
  "app.js",
  "workspace.js",
  "autosave.js",
  "extras.js",
  "readers.js",
];
await rm("public-build",{recursive:true,force:true});
await mkdir("public-build", { recursive: true });
for (const file of files) await copyFile(file, "public-build/" + file);
console.log("Static bundle created from the explicit public-file allowlist.");

await mkdir("public-build/vendor",{recursive:true});
for(const file of ["pdf.mjs","pdf.worker.mjs"]) await copyFile("node_modules/pdfjs-dist/build/"+file,"public-build/vendor/"+file);
