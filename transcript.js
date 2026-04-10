// ─── Core logic (importable) ─────────────────────────────────────────────────

function extractVideoId(input) {
  const m = input.match(/(?:v=|\/shorts\/|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? (input.length === 11 ? input : null);
}

function toTimestamp(ms) {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0")).join(":");
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function parseTranscriptXml(xml) {
  const entries = [];

  for (const p of xml.matchAll(/<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const words = [...p[3].matchAll(/<s[^>]*>([^<]*)<\/s>/g)].map((s) => s[1]).join("");
    const text = decodeEntities((words || p[3].replace(/<[^>]+>/g, "")).replace(/\n/g, " ").trim());
    if (text) entries.push({ offset: parseInt(p[1]), duration: parseInt(p[2]), text });
  }

  if (entries.length) return entries;

  for (const m of xml.matchAll(/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g)) {
    const text = decodeEntities(m[3].replace(/\n/g, " ").trim());
    if (text) entries.push({
      offset: Math.round(parseFloat(m[1]) * 1000),
      duration: Math.round(parseFloat(m[2]) * 1000),
      text,
    });
  }

  return entries;
}

async function fetchTranscript(videoId, lang = "en") {
  const playerRes = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
        videoId,
      }),
    }
  );

  if (!playerRes.ok) throw new Error(`YouTube API error: ${playerRes.status}`);

  const player = await playerRes.json();
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error("No captions available for this video.");

  const track = tracks.find((t) => t.languageCode === lang) ?? tracks[0];

  const xmlRes = await fetch(track.baseUrl);
  if (!xmlRes.ok) throw new Error(`Failed to fetch caption track: ${xmlRes.status}`);

  const xml = await xmlRes.text();
  const entries = parseTranscriptXml(xml);
  if (!entries.length) throw new Error("Could not parse transcript. Format may be unsupported.");

  return {
    videoId,
    language: track.languageCode,
    trackName: track.name?.runs?.[0]?.text ?? track.languageCode,
    entries,
  };
}

module.exports = { fetchTranscript, extractVideoId, toTimestamp };

// ─── CLI runner (only when called directly) ──────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);

  if (!args.length || args.includes("--help")) {
    console.log(`
Usage: node transcript.js <YouTube URL or video ID> [options]

Options:
  --timestamps    Prefix each line with [HH:MM:SS]
  --lang <code>   Language code (default: en)
  --json          Output raw JSON

Examples:
  node transcript.js "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  node transcript.js dQw4w9WgXcQ --timestamps
  node transcript.js dQw4w9WgXcQ --lang fr
`);
    process.exit(0);
  }

  const videoId = extractVideoId(args[0]);
  if (!videoId) { console.error("❌  Could not extract a video ID from:", args[0]); process.exit(1); }

  const timestamps = args.includes("--timestamps");
  const json = args.includes("--json");
  const langIdx = args.indexOf("--lang");
  const lang = langIdx !== -1 ? args[langIdx + 1] : "en";

  console.error(`🎬  Video ID: ${videoId} | Language: ${lang}\n`);

  fetchTranscript(videoId, lang).then(({ entries, language, trackName }) => {
    console.error(`📝  Track: ${trackName} (${language})\n`);
    if (json) {
      console.log(JSON.stringify(entries, null, 2));
    } else if (timestamps) {
      console.log(entries.map((e) => `[${toTimestamp(e.offset)}] ${e.text}`).join("\n"));
    } else {
      console.log(entries.map((e) => e.text).join(" "));
    }
  }).catch((err) => {
    console.error("❌ ", err.message);
    process.exit(1);
  });
}