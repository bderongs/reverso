const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.QUIZ_TERM_LOGGER_PORT || 18765);
const HOST = "127.0.0.1";
const OUT_DIR = path.join(__dirname, "..", "quiz-runs");
const JSONL_PATH = path.join(OUT_DIR, "presented-terms.jsonl");
const LATEST_PATH = path.join(OUT_DIR, "latest.json");

fs.mkdirSync(OUT_DIR, { recursive: true });

const termsByRun = new Map();

function record(entry) {
  fs.appendFileSync(JSONL_PATH, JSON.stringify(entry) + "\n");
  const runId = entry.runId || "unknown";
  const terms = termsByRun.get(runId) || [];
  terms.push(entry);
  termsByRun.set(runId, terms);
  fs.writeFileSync(
    LATEST_PATH,
    JSON.stringify({ runId, count: terms.length, terms }, null, 2)
  );
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/terms") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const entry = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!entry.term) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("missing term");
          return;
        }
        record(entry);
        res.writeHead(204);
        res.end();
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(String(error));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, HOST, () => {
  console.log(`quiz term logger listening on http://${HOST}:${PORT}`);
});
