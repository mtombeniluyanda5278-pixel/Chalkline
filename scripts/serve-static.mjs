// Local preview with the same /v1 proxy contract as production.
import { createServer, request } from "node:http";
import { readFile } from "node:fs/promises";
const files = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
  ["/workspace.js", "workspace.js"],
  ["/autosave.js", "autosave.js"],
]);
createServer(async (req, res) => {
  if (req.url.startsWith("/v1/")) {
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
  const file = files.get(req.url.split("?")[0]);
  if (!file) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": file.endsWith(".js")
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
  console.log("Chalkline preview: http://localhost:8080"),
);
