/**
 * Favourites demo + CORS proxy routes for Express (local server.js / Vercel).
 */
const fs = require("fs");
const https = require("https");
const path = require("path");
const { URL } = require("url");

function sanitizeLogId(id) {
  const cleaned = String(id || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  return cleaned || `srs-${Date.now()}`;
}

function pruneSrsLogs() {
  let names;
  try {
    names = fs.readdirSync(SRS_LOG_DIR);
  } catch {
    return;
  }
  const keepName = new Set(["latest.json", "latest.txt"]);
  const files = names
    .filter((name) => !keepName.has(name) && (name.endsWith(".json") || name.endsWith(".txt")))
    .map((name) => {
      const full = path.join(SRS_LOG_DIR, name);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(SRS_LOG_KEEP * 2)) {
    try {
      fs.unlinkSync(file.full);
    } catch {
      /* ignore */
    }
  }
}

const DEFAULT_BASE =
  process.env.FAV_API_BASE ||
  "https://context.reverso.net/bst-web-user";

const DEFAULT_ACCOUNT_BASE =
  process.env.ACCOUNT_API_BASE || "https://account.reverso.net";

/** Auth (account.reverso.net) origin. */
const AUTH_REVERSO_ORIGIN = "reverso.app.ios";
/** bst-web-user origin. */
const API_REVERSO_ORIGIN = "reverso.ext.chrome";
/** @deprecated use API_REVERSO_ORIGIN */
const FIXED_REVERSO_ORIGIN = API_REVERSO_ORIGIN;

const FAV_DIR = __dirname;
const SRS_LOG_DIR = path.join(FAV_DIR, "srs-logs");
const SRS_SCENARIOS_DIR = path.join(FAV_DIR, "srs-scenarios");
const SRS_LOG_KEEP = 30;

function safeScenarioBasename(id) {
  const cleaned = String(id || "")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80);
  return cleaned;
}

function resolveScenarioFile(idOrFile) {
  const indexPath = path.join(SRS_SCENARIOS_DIR, "index.json");
  if (!fs.existsSync(indexPath)) return null;
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(index)) return null;
  const key = String(idOrFile || "");
  const entry = index.find((item) => item && (item.id === key || item.file === key));
  if (!entry || !entry.file) return null;
  const base = path.basename(String(entry.file));
  if (!base.endsWith(".json") || base === "index.json") return null;
  const full = path.join(SRS_SCENARIOS_DIR, base);
  if (!full.startsWith(SRS_SCENARIOS_DIR + path.sep)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Reverso-Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };
}

function proxyRequest(req, res, targetPathWithQuery, bodyBuf, baseUrl) {
  const base = new URL(String(baseUrl || DEFAULT_BASE).replace(/\/$/, "") + "/");
  const relative = targetPathWithQuery.replace(/^\//, "");
  const targetUrl = new URL(relative, base);

  const headers = {};
  for (const name of ["authorization", "content-type", "accept"]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  headers["x-reverso-origin"] =
    String(baseUrl || DEFAULT_BASE).includes("account.reverso.net")
      ? AUTH_REVERSO_ORIGIN
      : API_REVERSO_ORIGIN;
  if (!headers.accept) headers.accept = "application/json";
  if (!headers["content-type"] && req.method !== "GET" && req.method !== "HEAD") {
    headers["content-type"] = "application/json;charset=UTF-8";
  }
  // Always use a browser-like UA — do not forward the caller's agent.
  // Cloudflare often 403s bare Node/curl agents.
  headers["user-agent"] =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
      const status = up.statusCode || 502;
      const upstreamCt = String(up.headers["content-type"] || "");
      const wantsJson =
        String(req.headers.accept || "").includes("application/json")
        || String(headers.accept || "").includes("application/json");
      const looksHtml =
        /text\/html/i.test(upstreamCt)
        || /^\s*<(!DOCTYPE|html)/i.test(buf.toString("utf8", 0, 64));

      // HTML error pages (Cloudflare / Reverso WAF) are opaque in DevTools;
      // wrap them as JSON so the UI can show the full upstream payload.
      if (status >= 400 && looksHtml && wantsJson) {
        const raw = buf.toString("utf8");
        const bodyText = raw
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const payload = JSON.stringify({
          error: "Upstream returned an HTML error page",
          status,
          upstream: String(targetUrl),
          method: req.method,
          contentType: upstreamCt || "text/html",
          bodyText: bodyText.slice(0, 8000),
          body: raw.length > 100000 ? `${raw.slice(0, 100000)}\n…[truncated ${raw.length} chars]` : raw,
        }, null, 2);
        res.writeHead(status, {
          ...corsHeaders(),
          "Content-Type": "application/json;charset=UTF-8",
          "X-Proxy-Upstream-Status": String(status),
          "X-Proxy-Upstream-Url": String(targetUrl),
          "X-Proxy-Upstream-Content-Type": upstreamCt || "text/html",
        });
        return res.end(payload);
      }

      res.writeHead(status, {
        ...corsHeaders(),
        "Content-Type": upstreamCt || "application/json",
        "X-Proxy-Upstream-Status": String(status),
        "X-Proxy-Upstream-Url": String(targetUrl),
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

  app.get(["/srs-game-tester", "/srs-game-tester.html"], (_req, res) => {
    res.sendFile(path.join(FAV_DIR, "srs-game-tester.html"));
  });

  app.get(["/learning-progress", "/learning-progress.html"], (_req, res) => {
    res.sendFile(path.join(FAV_DIR, "learning-progress.html"));
  });

  app.get(["/practice-talking", "/practice-talking.html"], (_req, res) => {
    res.sendFile(path.join(FAV_DIR, "practice-talking.html"));
  });

  app.get(["/teacher-texts", "/teacher-texts.html"], (_req, res) => {
    res.sendFile(path.join(FAV_DIR, "teacher-texts.html"));
  });

  app.get(["/api-tester", "/api-tester.html"], (_req, res) => {
    res.sendFile(path.join(FAV_DIR, "api-tester.html"));
  });

  app.get("/filtering-console-check.js", (_req, res) => {
    res.sendFile(path.join(FAV_DIR, "filtering-console-check.js"));
  });

  app.get("/fav-auth.js", (_req, res) => {
    res.sendFile(path.join(FAV_DIR, "fav-auth.js"));
  });

  app.get("/api/fav-config", (_req, res) => {
    res.json({
      baseUrl: DEFAULT_BASE,
      proxyPath: "/proxy",
      accountBaseUrl: DEFAULT_ACCOUNT_BASE,
      accountProxyPath: "/account-proxy",
    });
  });

  app.post("/srs-log", async (req, res) => {
    try {
      const raw = await readRawBody(req);
      if (!raw.length) {
        return res.status(400).json({ error: "Empty log payload" });
      }
      if (raw.length > 6 * 1024 * 1024) {
        return res.status(413).json({ error: "Log payload too large" });
      }
      let data;
      try {
        data = JSON.parse(raw.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid JSON" });
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return res.status(400).json({ error: "Log payload must be an object" });
      }
      fs.mkdirSync(SRS_LOG_DIR, { recursive: true });
      const id = sanitizeLogId(data.sessionId);
      data.savedAt = new Date().toISOString();
      const json = JSON.stringify(data, null, 2);
      const sessionFile = `${id}.json`;
      fs.writeFileSync(path.join(SRS_LOG_DIR, sessionFile), json);
      fs.writeFileSync(path.join(SRS_LOG_DIR, "latest.json"), json);
      const transcript = typeof data.transcript === "string" ? data.transcript : "";
      if (transcript) {
        fs.writeFileSync(path.join(SRS_LOG_DIR, "latest.txt"), transcript);
        fs.writeFileSync(path.join(SRS_LOG_DIR, `${id}.txt`), transcript);
      }
      pruneSrsLogs();
      res.json({
        ok: true,
        sessionId: id,
        file: `Favorites/srs-logs/${sessionFile}`,
        latest: "Favorites/srs-logs/latest.json",
        latestTxt: transcript ? "Favorites/srs-logs/latest.txt" : "",
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/srs-log/latest", (_req, res) => {
    const file = path.join(SRS_LOG_DIR, "latest.json");
    if (!fs.existsSync(file)) return res.status(404).json({ error: "No log yet" });
    res.sendFile(file);
  });

  app.get("/srs-scenarios", (_req, res) => {
    const indexPath = path.join(SRS_SCENARIOS_DIR, "index.json");
    if (!fs.existsSync(indexPath)) return res.status(404).json({ error: "No scenarios index" });
    res.sendFile(indexPath);
  });

  app.get("/srs-scenarios/word-banks/:id", (req, res) => {
    const id = safeScenarioBasename(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid word-bank id" });
    const full = path.join(SRS_SCENARIOS_DIR, "word-banks", `${id}.json`);
    if (!full.startsWith(path.join(SRS_SCENARIOS_DIR, "word-banks") + path.sep)) {
      return res.status(400).json({ error: "Invalid word-bank path" });
    }
    if (!fs.existsSync(full)) return res.status(404).json({ error: "Word bank not found" });
    res.sendFile(full);
  });

  app.get("/srs-scenarios/:id", (req, res) => {
    const id = safeScenarioBasename(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid scenario id" });
    const file = resolveScenarioFile(id);
    if (!file) return res.status(404).json({ error: "Scenario not found" });
    res.sendFile(file);
  });

  // --- Proxy routes set aside (clients call Reverso APIs directly) ---
  // Kept for optional local debugging; not used by the Favourites/SRS pages.
  app.use("/proxy", async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }
    const targetPath = req.url || "/";
    try {
      const body = await readRawBody(req);
      proxyRequest(req, res, targetPath, body, DEFAULT_BASE);
    } catch (err) {
      res.status(500).json({ error: "Proxy failed", message: err.message });
    }
  });

  // Account GAS API — set aside; clients call account.reverso.net directly.
  app.use("/account-proxy", async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }
    const targetPath = req.url || "/";
    try {
      const body = await readRawBody(req);
      proxyRequest(req, res, targetPath, body, DEFAULT_ACCOUNT_BASE);
    } catch (err) {
      res.status(500).json({ error: "Account proxy failed", message: err.message });
    }
  });
}

module.exports = {
  mountFavoritesRoutes,
  DEFAULT_BASE,
  DEFAULT_ACCOUNT_BASE,
  AUTH_REVERSO_ORIGIN,
  API_REVERSO_ORIGIN,
  FIXED_REVERSO_ORIGIN,
};
