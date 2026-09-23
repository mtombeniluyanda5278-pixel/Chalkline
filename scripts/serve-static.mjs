// Local preview of the deployable artifact, with the same /v1 proxy contract
// as production. Serves public-build/, not the working tree, so what you
// preview is what ships: the minified bundle, not the raw modules.
import { createServer, request } from "node:http";
import { readFile } from "node:fs/promises";
const ROOT = "public-build";
// Explicit allowlist mirroring build-static.mjs's output, so path traversal is
// impossible by construction.
const files = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
  ["/theme.js", "theme.js"],
  ["/vendor/pdf.mjs", "vendor/pdf.mjs"],
  ["/vendor/pdf.worker.mjs", "vendor/pdf.worker.mjs"],
]);
createServer(async (req, res) => {
  // /health is a backend route too; forwarding it keeps the preview faithful.
  if (req.url.startsWith("/v1/") || req.url === "/health") {
    const proxy = request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    proxy.on("error", () => {
      res.writeHead(502);
      res.end("Backend unavailable");
    });
    req.pipe(proxy);
    return;
  }
  const path = req.url.split("?")[0];
  // Client-side routes (/login, /dashboard, …) have no file of their own; the
  // shell answers them and routes in the browser, as the dev server does.
  // Anything that looks like an asset still 404s rather than returning HTML.
  const file =
    files.get(path) ?? (/\.[a-z0-9]+$/i.test(path) ? undefined : "index.html");
  if (!file) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const body = await readFile(ROOT + "/" + file);
    res.writeHead(200, {
      "Content-Type": /\.(js|mjs)$/.test(file)
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end();
  }
}).listen(8080, "127.0.0.1", () =>
  console.log("Chalkline preview of public-build/: http://localhost:8080"),
);
