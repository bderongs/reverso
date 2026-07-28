/**
 * Favourites demo + CORS proxy routes for Express (local server.js / Vercel).
 */
const https = require("https");
const path = require("path");
const { URL } = require("url");

const DEFAULT_BASE =
  process.env.FAV_API_BASE ||
  "https://context.reverso.net/bst-web-user";

const FAV_DIR = __dirname;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Reverso-Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };
}

function proxyRequest(req, res, targetPathWithQuery, bodyBuf) {
  const base = new URL(DEFAULT_BASE.replace(/\/$/, "") + "/");
  const relative = targetPathWithQuery.replace(/^\//, "");
  const targetUrl = new URL(relative, base);

  const headers = {};
  for (const name of ["authorization", "content-type", "x-reverso-origin", "accept"]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  if (!headers.accept) headers.accept = "application/json";
  if (!headers["content-type"] && req.method !== "GET" && req.method !== "HEAD") {
    headers["content-type"] = "application/json;charset=UTF-8";
  }
  if (!headers["user-agent"]) {
    headers["user-agent"] =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  }

  const body = bodyBuf || Buffer.alloc(0);
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
      res.writeHead(up.statusCode || 502, {
        ...corsHeaders(),
        "Content-Type": up.headers["content-type"] || "application/json",
      });
      res.end(buf);
    });
  });

  upstream.on("error", (err) => {
    res.writeHead(502, { ...corsHeaders(), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Proxy upstream failed", message: err.message }));
  });

  if (body.length) upstream.write(body);
  upstream.end();
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.readableEnded || req.complete) {
      if (Buffer.isBuffer(req.body)) return resolve(req.body);
      if (typeof req.body === "string") return resolve(Buffer.from(req.body));
      if (req.body && typeof req.body === "object") {
        return resolve(Buffer.from(JSON.stringify(req.body)));
      }
      return resolve(Buffer.alloc(0));
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function mountFavoritesRoutes(app) {
  app.get(["/filtering", "/filtering-demo.html"], (_req, res) => {
    res.sendFile(path.join(FAV_DIR, "filtering-demo.html"));
  });

  app.get(["/api-tester", "/api-tester.html"], (_req, res) => {
    res.sendFile(path.join(FAV_DIR, "api-tester.html"));
  });

  app.get("/api/fav-config", (_req, res) => {
    res.json({ baseUrl: DEFAULT_BASE, proxyPath: "/proxy" });
  });

  // Express 4: mount at /proxy so /proxy/user/... → req.url = /user/...
  app.use("/proxy", async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }
    const targetPath = req.url || "/";
    try {
      const body = await readRawBody(req);
      proxyRequest(req, res, targetPath, body);
    } catch (err) {
      res.status(500).json({ error: "Proxy failed", message: err.message });
    }
  });
}

module.exports = { mountFavoritesRoutes, DEFAULT_BASE };
