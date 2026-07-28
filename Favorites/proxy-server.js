/**
 * Local proxy for the Favourites API tester.
 * Avoids CORS when calling context.reverso.net from the browser.
 *
 * Usage: node Favorites/proxy-server.js
 * Then open http://localhost:3847/
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3847;
const DEFAULT_BASE =
  process.env.FAV_API_BASE ||
  "https://context.reverso.net/bst-web-user";

const HTML_PATH = path.join(__dirname, "api-tester.html");
const FILTER_DEMO_PATH = path.join(__dirname, "filtering-demo.html");

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Reverso-Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    ...headers,
  });
  res.end(body);
}

function serveHtml(res, filePath) {
  try {
    const html = fs.readFileSync(filePath);
    return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
  } catch (err) {
    return send(res, 500, `Missing ${path.basename(filePath)}: ${err.message}`, {
      "Content-Type": "text/plain",
    });
  }
}

function proxyRequest(req, res, targetPathWithQuery) {
  const base = new URL(DEFAULT_BASE.replace(/\/$/, "") + "/");
  // targetPathWithQuery is like "/user/favourites?..." — strip leading slash so
  // URL() resolves under the snapshot basePath instead of replacing it.
  const relative = targetPathWithQuery.replace(/^\//, "");
  const targetUrl = new URL(relative, base);

  const headers = {};
  for (const name of ["authorization", "content-type", "x-reverso-origin", "accept"]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  if (!headers.accept) headers.accept = "application/json";
  // Spring expects a Content-Type even when params are query-string only.
  if (!headers["content-type"] && req.method !== "GET" && req.method !== "HEAD") {
    headers["content-type"] = "application/json;charset=UTF-8";
  }
  // Cloudflare / edge rejects default curl/Node user-agents with 403.
  if (!headers["user-agent"]) {
    headers["user-agent"] =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const opts = {
      method: req.method,
      hostname: targetUrl.hostname,
      port: targetUrl.port || 443,
      path: targetUrl.pathname + targetUrl.search,
      headers: {
        ...headers,
        host: targetUrl.host,
        ...(body.length ? { "content-length": body.length } : {}),
      },
      rejectUnauthorized: false,
    };

    const upstream = https.request(opts, (up) => {
      const out = [];
      up.on("data", (c) => out.push(c));
      up.on("end", () => {
        const buf = Buffer.concat(out);
        send(res, up.statusCode || 502, buf, {
          "Content-Type": up.headers["content-type"] || "application/json",
        });
      });
    });

    upstream.on("error", (err) => {
      send(
        res,
        502,
        JSON.stringify({ error: "Proxy upstream failed", message: err.message }),
        { "Content-Type": "application/json" }
      );
    });

    if (body.length) upstream.write(body);
    upstream.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/api-tester.html") {
    return serveHtml(res, HTML_PATH);
  }

  if (url.pathname === "/filtering-demo.html" || url.pathname === "/filtering") {
    return serveHtml(res, FILTER_DEMO_PATH);
  }

  if (url.pathname === "/api/config") {
    return send(
      res,
      200,
      JSON.stringify({ baseUrl: DEFAULT_BASE, proxyPath: "/proxy" }),
      { "Content-Type": "application/json" }
    );
  }

  // /proxy/user/favourites?... → DEFAULT_BASE/user/favourites?...
  if (url.pathname.startsWith("/proxy/")) {
    const targetPath = url.pathname.slice("/proxy".length) + url.search;
    return proxyRequest(req, res, targetPath);
  }

  send(res, 404, "Not found", { "Content-Type": "text/plain" });
});

server.listen(PORT, () => {
  console.log(`Favourites API tester → http://localhost:${PORT}/`);
  console.log(`Filtering demo       → http://localhost:${PORT}/filtering-demo.html`);
  console.log(`Proxying to ${DEFAULT_BASE}`);
});
