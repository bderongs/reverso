require("dotenv").config();

const express = require("express");
const path = require("path");
const { Readable } = require("stream");
const { fetchTranscript, extractVideoId, toTimestamp } = require("./transcript");
const READ_ALOUD_VOICE_CONFIG = require("./voice-config");

const app = express();
const PORT = process.env.PORT || 3000;
const MISTRAL_TTS_MAX_RETRIES = 2;

app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: "1mb" }));

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

async function handleReadAloud(req, res) {
    const fromBody = req.method === "POST" && req.body && typeof req.body === "object" ? req.body : {};
    const fromQuery = req.query || {};
    const text = String(fromBody.text || fromQuery.text || "").trim();
    const format = String(fromBody.format || fromQuery.format || "mp3").trim();
    const defaultVoice =
        (READ_ALOUD_VOICE_CONFIG && READ_ALOUD_VOICE_CONFIG.defaultVoice) || "en_paul_neutral";
    const voice = String(fromBody.voice || fromQuery.voice || defaultVoice).trim();

    if (!text) return res.status(400).json({ error: 'Missing required query param: "text"' });

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "MISTRAL_API_KEY is not set in the environment." });
    }

    const model = process.env.MISTRAL_TTS_MODEL || "voxtral-mini-tts-2603";

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function isRetryableFailure(status, errText) {
        const raw = String(errText || "").toLowerCase();
        if (status >= 500) return true;
        return raw.includes("unreachable_backend") || raw.includes("internal server error");
    }

    async function requestMistralSpeech() {
        let lastStatus = 500;
        let lastErrorText = "Mistral TTS request failed.";

        for (let attempt = 0; attempt <= MISTRAL_TTS_MAX_RETRIES; attempt += 1) {
            const mistralRes = await fetch("https://api.mistral.ai/v1/audio/speech", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    voice,
                    input: text,
                    response_format: format
                })
            });

            if (mistralRes.ok) {
                return mistralRes;
            }

            lastStatus = mistralRes.status;
            lastErrorText = await mistralRes.text();
            const canRetry =
                attempt < MISTRAL_TTS_MAX_RETRIES && isRetryableFailure(lastStatus, lastErrorText);
            if (!canRetry) break;
            await sleep(350 * (attempt + 1));
        }
        const e = new Error(lastErrorText || "Mistral TTS request failed.");
        e.httpStatus = lastStatus;
        throw e;
    }

    function contentTypeForFormat(audioFormat) {
        if (audioFormat === "wav") return "audio/wav";
        if (audioFormat === "pcm") return "audio/L16";
        return "audio/mpeg";
    }

    function decodeBase64Audio(base64Payload) {
        const normalized = String(base64Payload || "").trim();
        if (!normalized) return null;
        const dataPart = normalized.includes(",") ? normalized.split(",").pop() : normalized;
        try {
            return Buffer.from(dataPart, "base64");
        } catch (_e) {
            return null;
        }
    }

    try {
        const mistralRes = await requestMistralSpeech();
        const upstreamContentType = String(mistralRes.headers.get("content-type") || "").toLowerCase();
        const fallbackAudioContentType = contentTypeForFormat(format);
        res.setHeader("Cache-Control", "no-store");

        if (!mistralRes.body) {
            return res.status(502).json({ error: "Mistral TTS returned an empty stream." });
        }

        if (upstreamContentType.includes("application/json")) {
            const payload = await mistralRes.json();
            const base64Audio =
                payload && typeof payload.audio_data === "string"
                    ? payload.audio_data
                    : payload && typeof payload.audio === "string"
                        ? payload.audio
                        : "";
            const decoded = decodeBase64Audio(base64Audio);
            if (!decoded || !decoded.length) {
                return res.status(502).json({ error: "Mistral TTS JSON response did not include decodable audio data." });
            }
            res.setHeader("Content-Type", fallbackAudioContentType);
            return res.send(decoded);
        }

        res.setHeader("Content-Type", upstreamContentType || fallbackAudioContentType);
        Readable.fromWeb(mistralRes.body).pipe(res);
    } catch (err) {
        const status = Number(err.httpStatus) || 500;
        return res.status(status).json({ error: err.message });
    }
}

app.get("/read-aloud/stream", handleReadAloud);
app.post("/read-aloud/stream", handleReadAloud);

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "youtube_v2.html"));
});

app.listen(PORT, () => console.log(`✅  Running on port ${PORT}`));