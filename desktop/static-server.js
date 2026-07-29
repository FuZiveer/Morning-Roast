const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};

function createStaticServer(rootDir) {
  const normalizedRoot = path.resolve(rootDir);

  return http.createServer((req, res) => {
    let urlPath = "/";
    try {
      urlPath = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    if (urlPath === "/") urlPath = "/index.html";

    const filePath = path.normalize(path.join(normalizedRoot, urlPath));
    if (!filePath.startsWith(normalizedRoot)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        if (error.code !== "ENOENT") {
          res.writeHead(500);
          res.end("Server error");
          return;
        }

        fs.readFile(path.join(normalizedRoot, "index.html"), (fallbackError, indexHtml) => {
          if (fallbackError) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
          res.end(indexHtml);
        });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
}

function startStaticServer(rootDir, host = "127.0.0.1") {
  const server = createStaticServer(rootDir);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, origin: `http://${host}:${port}` });
    });
  });
}

module.exports = {
  createStaticServer,
  startStaticServer,
};
