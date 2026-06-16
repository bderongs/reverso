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
app.use(express.json({ limit: "4mb" }));

const WORD_LIST_SCHEMA = {
    type: "object",
    properties: {
        sourceLanguage: { type: "string", description: "Detected or inferred source language name" },
        targetLanguage: { type: "string", description: "Detected or inferred target language name" },
        words: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    term: { type: "string", description: "Word or phrase in the source language" },
                    translation: { type: "string", description: "Translation in the target language" },
                    pos: { type: "string", description: "Part of speech abbreviation (n., v., adj., etc.) or empty string" },
                    note: { type: "string", description: "Warning if translation is uncertain, ambiguous, or was corrected; empty string if fine" }
                },
                required: ["term", "translation", "pos", "note"],
                additionalProperties: false
            }
        }
    },
    required: ["sourceLanguage", "targetLanguage", "words"],
    additionalProperties: false
};

const NORMALIZE_SYSTEM_PROMPT = `You normalize messy vocabulary lists for a language-learning app.
Extract every word/phrase pair from the input. Handle numbered lists, bullets, tables, dashes, arrows, slashes, and mixed formats.
Clean up OCR noise, fix obvious typos, and infer the most likely translation when one side is missing.
Set "note" when a pair is ambiguous, the translation looks wrong, or you had to guess.
Use short part-of-speech abbreviations (n., v., adj., adv., etc.) when known, otherwise empty string.
Return valid JSON matching the schema. If languages are not specified, detect them from content.

Capitalization — apply the conventions of each language, not English defaults:
- English, French, Spanish, Italian, Dutch, etc.: use lowercase for ordinary vocabulary (nouns, verbs, adjectives, adverbs). Keep uppercase only for proper nouns (Paris, Monday) and acronyms. Strip list formatting capitals (e.g. "Apple" → "apple", "La pomme" → "pomme", "COURIR" → "courir").
- German: capitalize all nouns and nominalized words (der Hund, das Haus, das Laufen). Verbs, adjectives, adverbs, and articles stay lowercase unless they start a phrase.
- Do not lowercase proper nouns or fixed multi-word names in any language.
- For phrasal verbs or infinitives, keep natural casing (e.g. "to run", "se lever").`;

app.post("/api/normalize-word-list", async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "OPENAI_API_KEY is not set in the environment." });
    }

    const { text, image, imageType, sourceLanguage = "", targetLanguage = "" } = req.body || {};
    if (!text && !image) {
        return res.status(400).json({ error: "Provide either text or an image." });
    }

    const langHint = [
        sourceLanguage && `Source language: ${sourceLanguage}`,
        targetLanguage && `Target language: ${targetLanguage}`
    ].filter(Boolean).join(". ");

    const userContent = [];
    if (text) {
        userContent.push({ type: "text", text: `${langHint ? langHint + "\n\n" : ""}${text}` });
    }
    if (image) {
        const mime = imageType || "image/jpeg";
        userContent.push({
            type: "image_url",
            image_url: { url: `data:${mime};base64,${image}` }
        });
        if (langHint) {
            userContent.unshift({ type: "text", text: langHint });
        }
    }

    try {
        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: NORMALIZE_SYSTEM_PROMPT },
                    { role: "user", content: userContent }
                ],
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "normalized_word_list",
                        strict: true,
                        schema: WORD_LIST_SCHEMA
                    }
                },
                temperature: 0.2
            })
        });

        if (!openaiRes.ok) {
            const errText = await openaiRes.text();
            return res.status(502).json({ error: `OpenAI error: ${errText}` });
        }

        const payload = await openaiRes.json();
        const raw = payload.choices?.[0]?.message?.content;
        if (!raw) return res.status(502).json({ error: "Empty response from OpenAI." });

        const parsed = JSON.parse(raw);
        return res.json(parsed);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

const LANG_NAME_TO_CODE = {
    english: "en", french: "fr", spanish: "es", german: "de", italian: "it",
    dutch: "nl", portuguese: "pt", russian: "ru", polish: "pl", arabic: "ar",
    chinese: "zh", japanese: "ja", korean: "ko", turkish: "tr", hebrew: "he",
    romanian: "ro", ukrainian: "uk", czech: "cs", swedish: "sv", norwegian: "no",
    danish: "da", finnish: "fi", greek: "el", hungarian: "hu", indonesian: "id",
    vietnamese: "vi", thai: "th", hindi: "hi"
};

function langToCode(name) {
    const raw = String(name || "").trim().toLowerCase();
    if (!raw) return "";
    if (/^[a-z]{2}(-[a-z]{2})?$/i.test(raw)) return raw.slice(0, 2).toLowerCase();
    return LANG_NAME_TO_CODE[raw] || "";
}

function buildSegmentQuery(term) {
    const word = String(term || "").trim();
    const isPhrase = word.includes(" ");
    const source = isPhrase ? `I like ${word}` : `the ${word}`;
    const wordPos = source.indexOf(word);
    return { source, word, wordPos };
}

function extractReversoTranslations(payload) {
    const out = [];
    for (const src of payload.sources || []) {
        for (const t of src.translations || []) {
            const tr = String(t.translation || "").trim();
            if (tr && tr !== "...") out.push(tr);
        }
    }
    return out;
}

function normalizeForCompare(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/^(le |la |les |l'|un |une |des |the |a |an )/g, "")
        .replace(/[.,;!?()[\]"']/g, "")
        .trim();
}

function splitUserTranslations(text) {
    return String(text || "")
        .split(/[,;/|]|\s+or\s+|\s+ou\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);
}

function compareTranslations(userTranslation, suggestions) {
    const userParts = splitUserTranslations(userTranslation).map(normalizeForCompare);
    const normalized = suggestions.map(normalizeForCompare);

    for (const part of userParts) {
        const idx = normalized.findIndex((s) => s === part);
        if (idx >= 0) {
            return { status: "match", matched: suggestions[idx] };
        }
    }

    for (const part of userParts) {
        const idx = normalized.findIndex((s) => s.includes(part) || part.includes(s));
        if (idx >= 0) {
            return { status: "partial", matched: suggestions[idx] };
        }
    }

    return { status: "mismatch", matched: suggestions[0] || "" };
}

async function fetchTranslateSegment(direction, term) {
    const { source, word, wordPos } = buildSegmentQuery(term);
    const params = new URLSearchParams({ direction, source, word, wordPos: String(wordPos) });
    const url = `https://cps-api.reverso.net/Api/TranslateSegment?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Reverso API error (${res.status})`);
    return res.json();
}

app.post("/api/check-translations", async (req, res) => {
    const { direction, sourceLanguage, targetLanguage, words } = req.body || {};
    let dir = String(direction || "").trim().toLowerCase();

    if (!dir) {
        const from = langToCode(sourceLanguage);
        const to = langToCode(targetLanguage);
        if (!from || !to) {
            return res.status(400).json({
                error: "Could not determine language pair. Set source/target language (e.g. English, French) or pass direction (e.g. en-fr)."
            });
        }
        dir = `${from}-${to}`;
    }

    const list = Array.isArray(words) ? words : [];
    if (!list.length) return res.status(400).json({ error: "No words to check." });

    const results = [];
    for (const item of list) {
        const term = String(item.term || "").trim();
        const translation = String(item.translation || "").trim();
        if (!term) {
            results.push({ term, status: "error", suggestions: [], top: "", note: "Missing term" });
            continue;
        }

        try {
            const payload = await fetchTranslateSegment(dir, term);
            const suggestions = extractReversoTranslations(payload);

            if (!payload.success || !suggestions.length) {
                results.push({
                    term,
                    status: "none",
                    suggestions: [],
                    top: "",
                    note: "No Reverso result"
                });
                continue;
            }

            const { status, matched } = compareTranslations(translation, suggestions);
            results.push({
                term,
                status,
                suggestions: suggestions.slice(0, 5),
                top: suggestions[0],
                matched: matched || suggestions[0],
                note: status === "match" ? "" : status === "partial"
                    ? `Close match: ${matched}`
                    : `Reverso suggests: ${suggestions[0]}`
            });
        } catch (err) {
            results.push({ term, status: "error", suggestions: [], top: "", note: err.message });
        }
    }

    return res.json({ direction: dir, results });
});

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
    res.sendFile(path.join(__dirname, "word-list-import.html"));
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => console.log(`✅  Running on port ${PORT}`));
}