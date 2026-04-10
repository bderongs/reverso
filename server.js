const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractVideoId(input) {
    const m = input.match(
        /(?:v=|\/shorts\/|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/
    );
    return m?.[1] ?? (input.length === 11 ? input : null);
}

function toTimestamp(ms) {
    const s = Math.floor(ms / 1000);
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
        .map((n) => String(n).padStart(2, "0"))
        .join(":");
}

function decodeEntities(str) {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
            String.fromCodePoint(parseInt(h, 16))
        )
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function parseTranscriptXml(xml) {
    const entries = [];

    // New format: <p t="..." d="..."><s>...</s></p>
    for (const p of xml.matchAll(
        /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
    )) {
        const words = [...p[3].matchAll(/<s[^>]*>([^<]*)<\/s>/g)]
            .map((s) => s[1])
            .join("");
        const text = decodeEntities(
            (words || p[3].replace(/<[^>]+>/g, "")).replace(/\n/g, " ").trim()
        );
        if (text)
            entries.push({
                offset: parseInt(p[1]),
                duration: parseInt(p[2]),
                text,
            });
    }

    if (entries.length) return entries;

    // Old format: <text start="..." dur="...">...</text>
    for (const m of xml.matchAll(
        /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g
    )) {
        const text = decodeEntities(m[3].replace(/\n/g, " ").trim());
        if (text)
            entries.push({
                offset: Math.round(parseFloat(m[1]) * 1000),
                duration: Math.round(parseFloat(m[2]) * 1000),
                text,
            });
    }

    return entries;
}

// ─── Core fetch logic ────────────────────────────────────────────────────────

async function fetchTranscript(videoId, lang = "en") {
    const playerRes = await fetch(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                context: {
                    client: { clientName: "ANDROID", clientVersion: "20.10.38" },
                },
                videoId,
            }),
        }
    );

    if (!playerRes.ok)
        throw new Error(`YouTube API error: ${playerRes.status}`);

    const player = await playerRes.json();
    const tracks =
        player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!tracks?.length)
        throw new Error("No captions available for this video.");

    const track =
        tracks.find((t) => t.languageCode === lang) ?? tracks[0];

    const xmlRes = await fetch(track.baseUrl);
    if (!xmlRes.ok)
        throw new Error(`Failed to fetch caption track: ${xmlRes.status}`);

    const xml = await xmlRes.text();
    const entries = parseTranscriptXml(xml);

    if (!entries.length)
        throw new Error("Could not parse transcript. Format may be unsupported.");

    return {
        videoId,
        language: track.languageCode,
        trackName: track.name?.runs?.[0]?.text ?? track.languageCode,
        entries,
    };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /transcript?url=...&lang=en&format=json|text|timestamped
app.get("/transcript", async (req, res) => {
    const { url, lang = "en", format = "json" } = req.query;

    if (!url)
        return res.status(400).json({ error: 'Missing required query param: "url"' });

    const videoId = extractVideoId(url);
    if (!videoId)
        return res.status(400).json({ error: "Could not extract a valid YouTube video ID." });

    try {
        const { entries, language, trackName } = await fetchTranscript(videoId, lang);

        if (format === "text") {
            res.setHeader("Content-Type", "text/plain");
            return res.send(entries.map((e) => e.text).join(" "));
        }

        if (format === "timestamped") {
            res.setHeader("Content-Type", "text/plain");
            return res.send(
                entries.map((e) => `[${toTimestamp(e.offset)}] ${e.text}`).join("\n")
            );
        }

        // Default: JSON
        return res.json({ videoId, language, trackName, entries });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Health check
app.get("/", (req, res) => {
    res.json({
        status: "ok",
        usage: {
            endpoint: "GET /transcript",
            params: {
                url: "YouTube video URL or video ID (required)",
                lang: "Language code, e.g. en, fr, es (default: en)",
                format: "json | text | timestamped (default: json)",
            },
            examples: [
                "/transcript?url=https://youtu.be/dQw4w9WgXcQ",
                "/transcript?url=dQw4w9WgXcQ&lang=fr",
                "/transcript?url=dQw4w9WgXcQ&format=timestamped",
                "/transcript?url=dQw4w9WgXcQ&format=text",
            ],
        },
    });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`✅  YouTube Transcript API running on port ${PORT}`);
});