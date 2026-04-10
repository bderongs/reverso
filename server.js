const express = require("express");
const { fetchTranscript, extractVideoId, toTimestamp } = require("./transcript");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/transcript", async (req, res) => {
    const { url, lang = "en", format = "json" } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing required query param: "url"' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: "Could not extract a valid YouTube video ID." });

    try {
        const { entries, language, trackName } = await fetchTranscript(videoId, lang);

        if (format === "text") {
            res.setHeader("Content-Type", "text/plain");
            return res.send(entries.map((e) => e.text).join(" "));
        }
        if (format === "timestamped") {
            res.setHeader("Content-Type", "text/plain");
            return res.send(entries.map((e) => `[${toTimestamp(e.offset)}] ${e.text}`).join("\n"));
        }
        return res.json({ videoId, language, trackName, entries });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        examples: [
            "/transcript?url=https://youtu.be/dQw4w9WgXcQ",
            "/transcript?url=dQw4w9WgXcQ&lang=fr",
            "/transcript?url=dQw4w9WgXcQ&format=timestamped",
            "/transcript?url=dQw4w9WgXcQ&format=text",
        ],
    });
});

app.listen(PORT, () => console.log(`✅  Running on port ${PORT}`));