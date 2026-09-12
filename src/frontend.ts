import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { config } from "./config.js";

// Explicit public allowlist; never expose the repository or configuration files.
const assets = [
  "index.html",
  "app.js",
  "workspace.js",
  "extras.js",
  "autosave.js",
  "readers.js",
  "styles.css",
];
export async function registerFrontend(app: FastifyInstance) {
  const root = new URL(
    config.NODE_ENV === "production" ? "../public-build/" : "../",
    import.meta.url,
  );
  const serve = async (file: string, reply: any) => {
    const type = file.endsWith(".html")
      ? "text/html; charset=utf-8"
      : file.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "text/javascript; charset=utf-8";
    return reply.type(type).send(await readFile(new URL(file, root)));
  };
  app.get("/", (_req, reply) => serve("index.html", reply));
  for (const asset of assets)
    app.get("/" + asset, (_req, reply) => serve(asset, reply));
  for (const asset of ["pdf.mjs", "pdf.worker.mjs"])
    app.get("/vendor/" + asset, async (_req, reply) => {
      const path =
        config.NODE_ENV === "production"
          ? new URL("vendor/" + asset, root)
          : new URL("node_modules/pdfjs-dist/build/" + asset, root);
      return reply.type("text/javascript").send(await readFile(path));
    });
  // The existing SPA uses hash routes. Preserve direct bookmarked routes safely.
  for (const path of [
    "login",
    "register",
    "dashboard",
    "notes",
    "lessons",
    "templates",
    "files",
    "schedule",
    "account",
    "devices",
  ]) {
    app.get("/" + path, (req, reply) => reply.redirect("/#" + req.url));
  }
}
