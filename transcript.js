// transcript.js
// Usage: node transcript.js <YouTube URL or video ID> [--timestamps] [--lang fr] [--json]

async function fetchTranscript(videoId, lang = "en") {
  // 1. Fetch caption tracks via InnerTube API
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
  const player = await playerRes.json();
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error("No captions available for this video.");

  console.error(JSON.stringify(tracks[0], null, 2));

  // 2. Pick preferred language, fallback to first track
  const track =
    tracks.find((t) => t.languageCode === lang) ?? tracks[0];
  console.error(`📝  Using caption track: ${track.name?.simpleText} (${track.languageCode})`);

  // 3. Fetch the actual transcript XML
  const xmlRes = await fetch(track.baseUrl);
  const xml = await xmlRes.text();

  // 4. Parse <text start="..." dur="...">...</text> entries
  // Try new format first (<p t="..."><s>...</s></p>)
  let entries = [];
  for (const p of xml.matchAll(/<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const words = [...p[3].matchAll(/<s[^>]*>([^<]*)<\/s>/g)].map(s => s[1]).join("");
    const text = (words || p[3].replace(/<[^>]+>/g, "")).trim();
    if (text) entries.push({ offset: parseInt(p[1]), duration: parseInt(p[2]), text });
  }

  // Fallback to old format (<text start="...">)
  if (!entries.length) {
    for (const m of xml.matchAll(/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g)) {
      entries.push({
        offset: parseFloat(m[1]) * 1000,
        duration: parseFloat(m[2]) * 1000,
        text: m[3].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " ").trim(),
      });
    }
  }
  return entries;
}

function toTimestamp(ms) {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0")).join(":");
}

function extractVideoId(input) {
  const m = input.match(/(?:v=|\/shorts\/|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? (input.length === 11 ? input : null);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) {
    console.log(`
Usage: node transcript.js <YouTube URL or video ID> [options]

Options:
  --timestamps    Prefix each line with [HH:MM:SS]
  --lang <code>   Language code (default: en)
  --json          Output raw JSON

Examples:
  node transcript.js https://youtu.be/dQw4w9WgXcQ
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

  try {
    const entries = await fetchTranscript(videoId, lang);
    if (json) {
      console.log(JSON.stringify(entries, null, 2));
    } else if (timestamps) {
      console.log(entries.map((e) => `[${toTimestamp(e.offset)}] ${e.text}`).join("\n"));
    } else {
      console.log(entries.map((e) => e.text).join(" "));
    }
  } catch (err) {
    console.error("❌ ", err.message);
    process.exit(1);
  }
}

main();
