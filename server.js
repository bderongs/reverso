require("dotenv").config();

const express = require("express");
const path = require("path");
const { Readable } = require("stream");
const { fetchTranscript, extractVideoId, toTimestamp } = require("./transcript");
const READ_ALOUD_VOICE_CONFIG = require("./voice-config");
const { mountFavoritesRoutes } = require("./Favorites/express-routes");

const app = express();
const PORT = process.env.PORT || 3000;
const MISTRAL_TTS_MAX_RETRIES = 2;

// Favourites demo + proxy (before json parser so /proxy can stream bodies).
mountFavoritesRoutes(app);

app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: "8mb" }));

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

function mistralApiKeyOrError(res) {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: "MISTRAL_API_KEY is not set in the environment." });
        return null;
    }
    return apiKey;
}

function extForMime(mimeType) {
    const mime = String(mimeType || "").toLowerCase();
    if (mime.includes("wav")) return "wav";
    if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
    return "webm";
}

app.post("/practice-talk/transcribe", async (req, res) => {
    const apiKey = mistralApiKeyOrError(res);
    if (!apiKey) return;

    const { audioBase64, mimeType, language, biasTerms } = req.body || {};
    const rawB64 = String(audioBase64 || "").trim();
    if (!rawB64) {
        return res.status(400).json({ error: "Missing audioBase64." });
    }

    const dataPart = rawB64.includes(",") ? rawB64.split(",").pop() : rawB64;
    let audioBuf;
    try {
        audioBuf = Buffer.from(dataPart, "base64");
    } catch (_e) {
        return res.status(400).json({ error: "Invalid audioBase64." });
    }
    if (!audioBuf.length) {
        return res.status(400).json({ error: "Empty audio payload." });
    }

    const mime = String(mimeType || "audio/webm").trim() || "audio/webm";
    const filename = `recording.${extForMime(mime)}`;
    const form = new FormData();
    form.append("model", process.env.MISTRAL_STT_MODEL || "voxtral-mini-latest");
    form.append("file", new Blob([audioBuf], { type: mime }), filename);
    const lang = String(language || "").trim().toLowerCase().slice(0, 2);
    if (lang) form.append("language", lang);

    // Voxtral context_bias: no commas/whitespace; use underscores for phrases.
    // Multipart must repeat the field per term (not a JSON array string).
    const bias = Array.isArray(biasTerms)
        ? [
              ...new Set(
                  biasTerms
                      .map((t) =>
                          String(t || "")
                              .trim()
                              .replace(/,/g, "")
                              .replace(/\s+/g, "_")
                      )
                      .filter(Boolean)
              ),
          ].slice(0, 100)
        : [];
    for (const term of bias) {
        form.append("context_bias", term);
    }

    try {
        const upstream = await fetch("https://api.mistral.ai/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
        });
        const text = await upstream.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            data = { raw: text };
        }
        if (!upstream.ok) {
            const msg =
                (data && (data.message || data.error || data.detail)) ||
                text.slice(0, 400) ||
                "Transcription failed.";
            return res.status(upstream.status).json({ error: String(msg) });
        }
        const transcript =
            (typeof data.text === "string" && data.text) ||
            (typeof data.transcript === "string" && data.transcript) ||
            "";
        return res.json({ text: String(transcript).trim(), raw: data });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

const PRACTICE_CHAT_SCHEMA = {
    type: "object",
    properties: {
        reply: { type: "string" },
        usedTerms: {
            type: "array",
            items: { type: "string" },
        },
        suggestedWords: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: { type: "string" },
        },
        hintAnswers: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: {
                type: "object",
                properties: {
                    label: { type: "string" },
                    text: { type: "string" },
                },
                required: ["label", "text"],
                additionalProperties: false,
            },
        },
    },
    required: ["reply", "usedTerms", "suggestedWords", "hintAnswers"],
    additionalProperties: false,
};

const PRACTICE_SCENARIOS_SCHEMA = {
    type: "object",
    properties: {
        scenarios: {
            type: "array",
            minItems: 5,
            maxItems: 5,
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    goal: { type: "string" },
                    you: {
                        type: "object",
                        properties: {
                            role: { type: "string" },
                            brief: { type: "string" },
                        },
                        required: ["role", "brief"],
                        additionalProperties: false,
                    },
                    persona: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            role: { type: "string" },
                            personality: { type: "string" },
                            tone: { type: "string" },
                        },
                        required: ["name", "role", "personality", "tone"],
                        additionalProperties: false,
                    },
                    beats: {
                        type: "array",
                        minItems: 5,
                        maxItems: 6,
                        items: {
                            type: "object",
                            properties: {
                                subject: { type: "string" },
                                askAbout: { type: "string" },
                                targetWords: {
                                    type: "array",
                                    minItems: 2,
                                    maxItems: 4,
                                    items: { type: "string" },
                                },
                            },
                            required: ["subject", "askAbout", "targetWords"],
                            additionalProperties: false,
                        },
                    },
                },
                required: ["id", "title", "goal", "you", "persona", "beats"],
                additionalProperties: false,
            },
        },
    },
    required: ["scenarios"],
    additionalProperties: false,
};

function vocabLinesForPrompt(vocabulary, limit = 60) {
    return (vocabulary || [])
        .slice(0, limit)
        .map((v) => {
            const src = String(v.srcText || v.term || "").trim();
            const trg = String(v.trgText || v.translation || "").trim();
            const ctx = String(v.srcContext || v.context || "").trim();
            if (!trg && !src) return null;
            // Practice is in source language: lead with src, translation in parentheses.
            const pair = src && trg ? `${src} (= ${trg})` : src || trg;
            return ctx ? `- ${pair} · e.g. ${ctx.replace(/<[^>]+>/g, "")}` : `- ${pair}`;
        })
        .filter(Boolean)
        .join("\n");
}

function buildScenariosPrompt({ practiceLang, hintLang, vocabulary, listName }) {
    const vocabLines = vocabLinesForPrompt(vocabulary, 60);
    const listLabel = String(listName || "").trim() || "the learner's vocabulary list";
    return `You design BROAD, EASY spoken roleplay scenarios for language practice.
Practice language (spoken language — list SOURCE): ${practiceLang || "unknown"}.
Hint / translation language (list target): ${hintLang || "unknown"}.
Vocabulary list name: ${listLabel}.

Create exactly 5 distinct scenarios. Keep them LARGE and LOOSE — not narrow puzzles.

Scenario style (very important):
- Prefer wide everyday settings (at a café, in a shop, asking for help in town, chatting with a neighbor, at a hotel desk) rather than hyper-specific plots.
- Titles and goals should be short and open. Bad: "Negotiate a refund for a cracked ceramic mug from last Tuesday's flash sale". Good: "Buy something at a café" / "Ask for directions in town".
- The learner must be able to answer with simple sentences; do not require expertise, precise facts, or long explanations.
- Leave room to improvise — do not over-specify what they must say or decide.
- Avoid stacked constraints, rare edge-cases, or multi-step missions.

Critical role design (do not get this backwards):
- "you" = the LEARNER's role. Keep it simple and low-pressure so any random language learner can step in immediately.
  Good: tourist, customer, neighbor, student, patient, shopper, guest, passenger, visitor asking a question.
  Bad: project director, CEO, specialist leading a crisis, lawyer arguing a case, manager firing someone.
- "persona" = the AI character the learner talks TO (friendly clerk, neighbor, barista, receptionist). Keep them approachable, not intimidating.
- The learner should be the person ASKING / needing something simple — not the authority figure in charge.
- Goals: one easy outcome (get info, choose something, describe a preference). Not negotiations under pressure.

Also create conversation "beats" for each scenario — broad topic hooks for later turns:
- Exactly 5–6 beats per scenario.
- Keep beats broad too (favorite places, what they need, what something looks like) — not tiny trivia.
- "askAbout" = a simple open topic the AI can ask about so a normal short answer can use list words.
- "targetWords" = 2–4 exact SOURCE spellings copied from the vocabulary list (never invent words; never use translation-side words).
- Spread different list words across beats; avoid repeating the same 2 words on every beat.
- Bad beats: full name, phone, email, passport, payment PIN, or anything not on the list.

Write title, goal, you, persona, beats.subject, and beats.askAbout in English (UI / planning language).
targetWords stay in the practice SOURCE language with exact list spellings.

For each scenario:
- id: short stable slug (e.g. "cafe-chat")
- title: short, broad situation name
- goal: one simple learner goal in plain words
- you: { role, brief } — brief should reassure them to keep answers short and natural
- persona: { name, role, personality, tone }
- beats: [ { subject, askAbout, targetWords: ["…", "…"] }, … ]

Vocabulary (source practice form = translation):
${vocabLines || "(limited list — invent realistic easy situations around everyday travel/food/home themes)"}`;
}

function normalizeLookupKey(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
}

function buildVocabLookup(vocabulary) {
    const allowed = new Map();
    for (const v of vocabulary || []) {
        const src = String(v.srcText || v.term || "").trim();
        if (!src) continue;
        allowed.set(normalizeLookupKey(src), src);
    }
    return allowed;
}

function matchVocabTerm(raw, allowed) {
    const key = normalizeLookupKey(raw);
    if (!key) return null;
    if (allowed.has(key)) return allowed.get(key);
    // Fuzzy: accept close contains matches for multi-word terms.
    let best = null;
    for (const [k, canonical] of allowed.entries()) {
        if (k === key) return canonical;
        if (k.includes(key) || key.includes(k)) {
            if (!best || canonical.length > best.length) best = canonical;
        }
    }
    return best;
}

function normalizeBeats(rawBeats, vocabulary) {
    const allowed = buildVocabLookup(vocabulary);
    const beats = Array.isArray(rawBeats) ? rawBeats : [];
    return beats
        .map((b) => {
            const subject = String(b?.subject || "").trim();
            const askAbout = String(b?.askAbout || "").trim();
            const words = [];
            const seen = new Set();
            for (const raw of Array.isArray(b?.targetWords) ? b.targetWords : []) {
                const canonical = allowed.size
                    ? matchVocabTerm(raw, allowed)
                    : String(raw || "").trim();
                if (!canonical) continue;
                const key = normalizeLookupKey(canonical);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                words.push(canonical);
                if (words.length >= 4) break;
            }
            if (!subject || !askAbout || words.length < 1) return null;
            // Keep beat even with 1 matched word; we'll top up later.
            return { subject, askAbout, targetWords: words };
        })
        .filter(Boolean)
        .slice(0, 6);
}

function synthesizeBeats(vocabulary, existingBeats, needCount) {
    const existing = Array.isArray(existingBeats) ? existingBeats.slice() : [];
    const used = new Set(
        existing.flatMap((b) => (b.targetWords || []).map((w) => normalizeLookupKey(w)))
    );
    const pool = (vocabulary || [])
        .map((v) => String(v.srcText || v.term || "").trim())
        .filter(Boolean)
        .filter((src) => {
            const key = normalizeLookupKey(src);
            if (!key || used.has(key)) return false;
            used.add(key);
            return true;
        });

    let i = 0;
    let n = existing.length;
    while (existing.length < needCount && i < pool.length) {
        const w1 = pool[i++];
        const w2 = i < pool.length ? pool[i++] : w1;
        const words = [...new Set([w1, w2].filter(Boolean))];
        if (!words.length) break;
        n += 1;
        existing.push({
            subject: `Practice with: ${words.join(", ")}`,
            askAbout: `Ask a simple open question so the learner can naturally mention ${words.join(" / ")}.`,
            targetWords: words.slice(0, 4),
        });
    }

    // Top up beats that only have 1 word.
    let poolIdx = 0;
    for (const beat of existing) {
        while (beat.targetWords.length < 2 && poolIdx < pool.length) {
            const extra = pool[poolIdx++];
            const key = normalizeLookupKey(extra);
            if (beat.targetWords.some((w) => normalizeLookupKey(w) === key)) continue;
            beat.targetWords.push(extra);
        }
        if (beat.targetWords.length < 2 && beat.targetWords[0]) {
            // Duplicate is better than dropping the scenario.
            beat.targetWords.push(beat.targetWords[0]);
        }
    }

    return existing.slice(0, 6);
}

function normalizeScenarios(raw, vocabulary) {
    const list = Array.isArray(raw) ? raw : [];
    return list
        .slice(0, 5)
        .map((s, i) => {
            const persona = s && s.persona && typeof s.persona === "object" ? s.persona : {};
            const you = s && s.you && typeof s.you === "object" ? s.you : {};
            const title = String(s?.title || "").trim();
            const goal = String(s?.goal || "").trim();
            const name = String(persona.name || "").trim();
            const role = String(persona.role || "").trim();
            const personality = String(persona.personality || "").trim();
            const tone = String(persona.tone || "").trim();
            const youRole = String(you.role || "").trim();
            const youBrief = String(you.brief || "").trim();
            let beats = normalizeBeats(s?.beats, vocabulary);
            beats = synthesizeBeats(vocabulary, beats, 5);
            if (!title || !goal || !name || !role || !youRole) return null;
            if (beats.length < 3) return null;
            const id =
                String(s?.id || "")
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]+/g, "-")
                    .replace(/^-+|-+$/g, "") || `scenario-${i + 1}`;
            return {
                id,
                title,
                goal,
                you: {
                    role: youRole,
                    brief: youBrief || `You are ${youRole}. Keep it simple and natural.`,
                },
                persona: {
                    name,
                    role,
                    personality: personality || "friendly",
                    tone: tone || "warm and clear",
                },
                beats: beats.slice(0, 6),
            };
        })
        .filter(Boolean);
}

app.post("/practice-talk/scenarios", async (req, res) => {
    const apiKey = mistralApiKeyOrError(res);
    if (!apiKey) return;

    const { vocabulary, practiceLang, hintLang, sourceLang, listName } = req.body || {};
    if (!Array.isArray(vocabulary) || !vocabulary.length) {
        return res.status(400).json({ error: "vocabulary must be a non-empty array." });
    }

    const system = buildScenariosPrompt({
        practiceLang,
        hintLang: hintLang || sourceLang,
        vocabulary,
        listName,
    });

    try {
        async function requestScenarios(attempt) {
            const upstream = await fetch("https://api.mistral.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: process.env.MISTRAL_CHAT_MODEL || "mistral-small-latest",
                    messages: [
                        { role: "system", content: system },
                        {
                            role: "user",
                            content:
                                attempt === 0
                                    ? "Generate exactly 5 scenarios as JSON matching the schema. Make them varied and list-specific. Copy targetWords exactly from the SOURCE side of the vocabulary list."
                                    : "Previous output was incomplete. Return exactly 5 complete scenarios again. Each needs 5 beats and targetWords copied exactly from the SOURCE vocabulary spellings.",
                        },
                    ],
                    temperature: attempt === 0 ? 0.6 : 0.4,
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            name: "practice_talk_scenarios",
                            strict: true,
                            schema: PRACTICE_SCENARIOS_SCHEMA,
                        },
                    },
                }),
            });
            const text = await upstream.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                data = null;
            }
            if (!upstream.ok) {
                const msg =
                    (data && (data.message || data.error?.message || data.error)) ||
                    text.slice(0, 400) ||
                    "Scenario generation failed.";
                const err = new Error(String(msg));
                err.status = upstream.status;
                throw err;
            }
            const rawContent = data?.choices?.[0]?.message?.content;
            if (!rawContent) {
                throw new Error("Empty scenario response from Mistral.");
            }
            let parsed;
            try {
                parsed = typeof rawContent === "string" ? JSON.parse(rawContent) : rawContent;
            } catch {
                throw new Error("Scenario response was not valid JSON.");
            }
            return normalizeScenarios(parsed?.scenarios, vocabulary);
        }

        let scenarios = await requestScenarios(0);
        if (scenarios.length < 5) {
            const retry = await requestScenarios(1);
            // Prefer the larger set; merge unique ids if helpful.
            if (retry.length >= scenarios.length) scenarios = retry;
            if (scenarios.length < 5 && retry.length) {
                const seen = new Set(scenarios.map((s) => s.id));
                for (const s of retry) {
                    if (seen.has(s.id)) continue;
                    scenarios.push(s);
                    seen.add(s.id);
                    if (scenarios.length >= 5) break;
                }
            }
        }
        if (scenarios.length < 5) {
            return res.status(502).json({
                error: `Expected 5 scenarios, got ${scenarios.length}. Try Generate new set again.`,
                scenarios,
            });
        }
        return res.json({ scenarios: scenarios.slice(0, 5) });
    } catch (err) {
        const status = Number(err.status) || 500;
        return res.status(status).json({ error: err.message });
    }
});

const TEACHER_TARGETS = new Set(["Child", "Teens", "Adults"]);
const TEACHER_LEVELS = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
const TEACHER_TEXT_TYPES = new Set(["Story", "News", "Dialogue"]);

const TEACHER_TEXT_TITLES_SCHEMA = {
    type: "object",
    properties: {
        titles: {
            type: "array",
            minItems: 5,
            maxItems: 5,
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                },
                required: ["id", "title"],
                additionalProperties: false,
            },
        },
    },
    required: ["titles"],
    additionalProperties: false,
};

function normalizeTeacherTarget(value) {
    const v = String(value || "").trim();
    return TEACHER_TARGETS.has(v) ? v : "Teens";
}

function normalizeTeacherLevel(value) {
    const v = String(value || "").trim().toUpperCase();
    return TEACHER_LEVELS.has(v) ? v : "A2";
}

function normalizeTeacherTextType(value) {
    const raw = String(value || "").trim();
    if (TEACHER_TEXT_TYPES.has(raw)) return raw;
    const capped = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    return TEACHER_TEXT_TYPES.has(capped) ? capped : "Story";
}

function buildTextTitlesPrompt({
    practiceLang,
    hintLang,
    vocabulary,
    listName,
    target,
    level,
    textType,
    teacherPrompt,
}) {
    const vocabLines = vocabLinesForPrompt(vocabulary, 60);
    const listLabel = String(listName || "").trim() || "the teacher's vocabulary list";
    const extra = String(teacherPrompt || "").trim();
    const extraBlock = extra
        ? `\nAdditional teacher instructions (follow when compatible with the above):\n${extra}\n`
        : "";
    return `You invent short, concrete TITLES for student reading texts used in a language class.
Practice / text language (list SOURCE): ${practiceLang || "unknown"}.
Hint / translation language (list target): ${hintLang || "unknown"}.
Vocabulary list name (theme): ${listLabel}.
Target audience: ${target}.
CEFR level: ${level}.
Text type / genre: ${textType}.
${extraBlock}
Create exactly 5 distinct title ideas. Return titles only — do not write the body of any text.

Requirements:
- Each title must fit a ${textType} suitable for ${target} learners at CEFR ${level}.
- Ground titles in the list theme and vocabulary (settings, situations, or topics those words suggest). Do not invent a generic worksheet unrelated to the list.
- Titles should be short, catchy, and classroom-ready (about 3–12 words).
- Prefer writing titles in the practice/source language (${practiceLang || "the practice language"}) when that language uses a Latin or common script; otherwise use clear English titles.
- Make the 5 titles clearly different from each other (different angles, settings, or characters).
- Do not number the titles; do not include the words "Story", "News", or "Dialogue" as a prefix unless natural.
- id must be a short slug (lowercase letters, digits, hyphens).

Vocabulary (SOURCE (= translation) · optional context):
${vocabLines || "- (empty list)"}
`;
}

function normalizeTextTitles(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const out = [];
    for (let i = 0; i < list.length && out.length < 5; i++) {
        const item = list[i] || {};
        const title = String(item.title || "").trim();
        if (!title) continue;
        let id =
            String(item.id || "")
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, "-")
                .replace(/^-+|-+$/g, "") || `title-${out.length + 1}`;
        if (seen.has(id)) id = `${id}-${out.length + 1}`;
        seen.add(id);
        out.push({ id, title });
    }
    return out;
}

app.post("/teacher/text-titles", async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "OPENAI_API_KEY is not set in the environment." });
    }

    const {
        vocabulary,
        practiceLang,
        hintLang,
        sourceLang,
        listName,
        target: rawTarget,
        level: rawLevel,
        textType: rawTextType,
        teacherPrompt,
    } = req.body || {};
    if (!Array.isArray(vocabulary) || !vocabulary.length) {
        return res.status(400).json({ error: "vocabulary must be a non-empty array." });
    }

    const target = normalizeTeacherTarget(rawTarget);
    const level = normalizeTeacherLevel(rawLevel);
    const textType = normalizeTeacherTextType(rawTextType);

    const system = buildTextTitlesPrompt({
        practiceLang,
        hintLang: hintLang || sourceLang,
        vocabulary,
        listName,
        target,
        level,
        textType,
        teacherPrompt,
    });

    try {
        async function requestTitles(attempt) {
            const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
                    messages: [
                        { role: "system", content: system },
                        {
                            role: "user",
                            content:
                                attempt === 0
                                    ? "Generate exactly 5 text titles as JSON matching the schema. Make them varied and list-specific."
                                    : "Previous output was incomplete. Return exactly 5 complete titles again, each with id and title.",
                        },
                    ],
                    temperature: attempt === 0 ? 0.7 : 0.45,
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            name: "teacher_text_titles",
                            strict: true,
                            schema: TEACHER_TEXT_TITLES_SCHEMA,
                        },
                    },
                }),
            });
            const text = await upstream.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                data = null;
            }
            if (!upstream.ok) {
                const msg =
                    (data && (data.message || data.error?.message || data.error)) ||
                    text.slice(0, 400) ||
                    "Title generation failed.";
                const err = new Error(String(msg));
                err.status = upstream.status;
                throw err;
            }
            const rawContent = data?.choices?.[0]?.message?.content;
            if (!rawContent) {
                throw new Error("Empty title response from OpenAI.");
            }
            let parsed;
            try {
                parsed = typeof rawContent === "string" ? JSON.parse(rawContent) : rawContent;
            } catch {
                throw new Error("Title response was not valid JSON.");
            }
            return normalizeTextTitles(parsed?.titles);
        }

        let titles = await requestTitles(0);
        if (titles.length < 5) {
            const retry = await requestTitles(1);
            if (retry.length >= titles.length) titles = retry;
            if (titles.length < 5 && retry.length) {
                const seen = new Set(titles.map((t) => t.id));
                for (const t of retry) {
                    if (seen.has(t.id)) continue;
                    titles.push(t);
                    seen.add(t.id);
                    if (titles.length >= 5) break;
                }
            }
        }
        if (titles.length < 5) {
            return res.status(502).json({
                error: `Expected 5 titles, got ${titles.length}. Try Create 5 texts again.`,
                titles,
            });
        }
        return res.json({ titles: titles.slice(0, 5) });
    } catch (err) {
        const status = Number(err.status) || 500;
        return res.status(status).json({ error: err.message });
    }
});

function escapeRegExpServer(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termAppearsInText(haystack, term) {
    const text = String(haystack || "");
    const needle = String(term || "").trim();
    if (!text || !needle) return false;
    if (/\s/.test(needle)) {
        return text.toLowerCase().includes(needle.toLowerCase());
    }
    try {
        const re = new RegExp(
            `(?:^|[^\\p{L}\\p{N}])${escapeRegExpServer(needle)}(?=$|[^\\p{L}\\p{N}])`,
            "iu"
        );
        return re.test(text);
    } catch (_e) {
        return text.toLowerCase().includes(needle.toLowerCase());
    }
}

function normalizeHintAnswers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item, i) => {
            if (item && typeof item === "object") {
                return {
                    label: String(item.label || "").trim() || (i === 0 ? "This way" : "Another way"),
                    text: String(item.text || "").trim(),
                };
            }
            return {
                label: i === 0 ? "This way" : "Another way",
                text: String(item || "").trim(),
            };
        })
        .filter((h) => h.text)
        .slice(0, 2);
}

function hintAnswerTexts(hintAnswers) {
    return normalizeHintAnswers(hintAnswers).map((h) => h.text);
}

/** Suggested words must come from hint answers — never pad with unrelated list terms. */
function buildSuggestedWordsFromHints(hintAnswers, vocabulary, modelSuggested) {
    const answers = hintAnswerTexts(hintAnswers);
    const joined = answers.join("\n");
    const found = [];
    const seen = new Set();

    function push(term) {
        const w = String(term || "").trim();
        if (!w) return;
        const key = w.toLowerCase();
        if (seen.has(key)) return;
        if (!termAppearsInText(joined, w)) return;
        seen.add(key);
        found.push(w);
    }

    const vocabSrc = (vocabulary || [])
        .map((v) => String(v.srcText || v.term || "").trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

    for (const src of vocabSrc) push(src);

    // Prefer model spellings when they also appear in the answers.
    if (found.length < 5) {
        for (const raw of modelSuggested || []) {
            push(raw);
            if (found.length >= 5) break;
        }
    }

    return found.slice(0, 5);
}

function normalizeScenario(raw) {
    if (!raw || typeof raw !== "object") return null;
    const persona = raw.persona && typeof raw.persona === "object" ? raw.persona : {};
    const you = raw.you && typeof raw.you === "object" ? raw.you : {};
    const title = String(raw.title || "").trim();
    const goal = String(raw.goal || "").trim();
    const name = String(persona.name || "").trim();
    const role = String(persona.role || "").trim();
    const youRole = String(you.role || "").trim();
    if (!title || !goal || !name || !role) return null;
    const beats = normalizeBeats(raw.beats, null);
    // When vocabulary isn't available here, keep beats if structurally valid.
    const looseBeats = Array.isArray(raw.beats)
        ? raw.beats
              .map((b) => {
                  const subject = String(b?.subject || "").trim();
                  const askAbout = String(b?.askAbout || "").trim();
                  const targetWords = [
                      ...new Set(
                          (Array.isArray(b?.targetWords) ? b.targetWords : [])
                              .map((t) => String(t || "").trim())
                              .filter(Boolean)
                      ),
                  ].slice(0, 4);
                  if (!subject || !askAbout || targetWords.length < 2) return null;
                  return { subject, askAbout, targetWords };
              })
              .filter(Boolean)
              .slice(0, 6)
        : [];
    return {
        id: String(raw.id || "").trim() || "scenario",
        title,
        goal,
        you: {
            role: youRole || "a language learner in an everyday situation",
            brief:
                String(you.brief || "").trim() ||
                "Play a simple everyday role. Stay natural and keep requests small.",
        },
        persona: {
            name,
            role,
            personality: String(persona.personality || "").trim() || "friendly",
            tone: String(persona.tone || "").trim() || "warm and clear",
        },
        beats: beats.length ? beats : looseBeats,
    };
}

function pickNextBeats(scenario, messages, limit = 2) {
    const history = (messages || []).map((m) => String(m?.content || "")).join("\n");
    const beats = Array.isArray(scenario?.beats) ? scenario.beats : [];
    const remaining = beats.filter((b) => {
        const words = Array.isArray(b.targetWords) ? b.targetWords : [];
        if (!words.length) return true;
        return words.some((w) => !termAppearsInText(history, w));
    });
    return remaining.slice(0, limit);
}

function formatBeatsForPrompt(beats) {
    if (!beats || !beats.length) return "";
    return beats
        .map(
            (b, i) =>
                `${i + 1}. Subject: ${b.subject}\n   Ask about: ${b.askAbout}\n   Learner should be able to use: ${b.targetWords.join(", ")}`
        )
        .join("\n");
}

const HINT_ANSWERS_JSON_RULES = `  - "hintAnswers": exactly 2 ready-to-speak answers to THAT question, in the practice language. They must fork the story in two very different directions.
      Each item is { "label", "text" }:
      * "label": short English name of the strategy (3–6 words), e.g. "Go along with it", "Change the plan", "Tell a personal story", "Make a practical offer"
      * "text": 1–2 spoken sentences the learner can read aloud as their next turn. Natural, concrete, in the practice language.
      Requirements for EACH answer:
      * Directly answers your question and continues the scene with new concrete detail
      * The two answers MUST take clearly different story strategies (agree vs redirect, practical vs personal, accept vs counter-offer, stay vs change course). Do not write two paraphrases of the same idea.
      * Must NOT be a polite closing, dismissal, or dead-end (forbidden examples: "Yes, I'll go now", "No thanks", "I'll ask someone else", "That's all", "Goodbye")
      * Must naturally include at least 2 exact SOURCE terms from the vocabulary list below (prefer this turn's beat targetWords; copy spellings exactly)
  - "suggestedWords": 2–5 SOURCE-language list terms that actually appear inside hintAnswers.text (exact spellings). Every suggestedWord MUST appear in at least one hintAnswer.`;

function buildPracticeSystemPrompt({ practiceLang, hintLang, vocabulary, scenario, nextBeats }) {
    const vocabLines = vocabLinesForPrompt(vocabulary, 80);
    const practice = practiceLang || "the source language";
    const hint = hintLang || "unknown";
    const sc = normalizeScenario(scenario);
    const beatBlock = formatBeatsForPrompt(nextBeats);

    if (sc) {
        const { persona, you } = sc;
        return `You are roleplaying as ${persona.name}, ${persona.role}, in the scenario: ${sc.title}.
Personality: ${persona.personality}. Tone: ${persona.tone}. Stay in character for the full session.

The learner is playing: ${you.role}.
Learner guidance: ${you.brief}.
Treat them as that person — do not cast them as an authority figure or expert unless their role says so. Keep the interaction easy for a language learner.

Practice language (speak almost only in this language — list SOURCE language): ${practice}.
Learner's translation / hint language (list target; only if stuck): ${hint}.
Scenario objective (what the learner is trying to achieve): ${sc.goal}.

${
    beatBlock
        ? `Active conversation beats for THIS turn (choose one and ask about it):\n${beatBlock}\nYour open question MUST invite an answer that naturally uses at least one of that beat's targetWords (exact spellings). Do not ask for full name, phone, email, ID, or other off-list personal data.\n`
        : ""
}Priority order (in case of conflict, higher wins):
1. The conversation should flow naturally and realistically — never sound like a vocabulary drill.
2. Every reply MUST end with an OPEN question designed so a normal answer can use still-unused SOURCE list words (especially this turn's beat targetWords). Avoid yes/no closers and off-list admin questions.
3. Weave in 1–2 of the source-language list terms per message only where they fit naturally; never force one.
4. Advance toward the scenario objective with small, easy steps.
5. If the user goes off-topic, bring them back to the topic in a subtle and realistic manner.

Other rules:
- Keep replies short: 1–3 sentences, always finishing with an open question for the learner.
- Stay in the practice language. Only use the hint language for a brief hint if the learner is clearly stuck.
- If the learner makes a mistake, recast the correct form naturally in your next sentence — do not lecture.
- Return JSON matching the schema:
  - "reply": what you say aloud in character; MUST end with an open question that needs a content answer using list words
  - "usedTerms": vocabulary SOURCE-language terms from the list that appear in your reply (exact spellings when possible)
${HINT_ANSWERS_JSON_RULES}

Vocabulary list (source practice form = translation; use lightly, never force):
${vocabLines || "(empty list — improvise within the scenario)"}`;
    }

    return `You are a friendly language-practice conversation partner.
Practice language (speak almost only in this language — list SOURCE language): ${practice}.
Learner's translation / hint language (list target; only if stuck): ${hint}.

Rules:
- Keep replies short: 1–3 sentences.
- Every reply MUST end with an OPEN question designed so a normal answer can use still-unused SOURCE list words. Avoid yes/no closers and off-list admin questions (full name, phone, email, ID).
- Stay in the practice language. Only use the hint language for a brief hint if the learner is clearly stuck.
- Have a natural chat around the vocabulary list themes below.
- Gently weave in unused SOURCE-language list terms over time; do not force every word.
- If the learner makes a mistake, recast the correct form naturally in your next sentence — do not lecture.
- Return JSON matching the schema:
  - "reply": what you say aloud; MUST end with an open question that needs a content answer using list words
  - "usedTerms": vocabulary SOURCE-language terms from the list that appear in your reply (exact spellings when possible)
${HINT_ANSWERS_JSON_RULES}

Vocabulary list (source practice form = translation):
${vocabLines || "(empty list — improvise a simple everyday conversation)"}`;
}

app.post("/practice-talk/chat", async (req, res) => {
    const apiKey = mistralApiKeyOrError(res);
    if (!apiKey) return;

    const { messages, vocabulary, practiceLang, hintLang, sourceLang, scenario } = req.body || {};
    if (!Array.isArray(messages)) {
        return res.status(400).json({ error: "messages must be an array." });
    }

    const sc = normalizeScenario(scenario);
    const nextBeats = pickNextBeats(sc, messages, 2);
    let system = buildPracticeSystemPrompt({
        practiceLang,
        hintLang: hintLang || sourceLang,
        vocabulary,
        scenario: sc,
        nextBeats,
    });

    const unusedForHints = (vocabulary || [])
        .map((v) => String(v.srcText || v.term || "").trim())
        .filter(Boolean)
        .filter((term) => {
            const history = (messages || [])
                .map((m) => String(m?.content || ""))
                .join("\n");
            return !termAppearsInText(history, term);
        })
        .slice(0, 30);
    const beatWords = [
        ...new Set(nextBeats.flatMap((b) => b.targetWords || [])),
    ];
    if (beatWords.length) {
        system += `\n\nThis turn's priority targetWords for your question + hintAnswers: ${beatWords.join(" · ")}`;
    }
    if (unusedForHints.length) {
        system += `\n\nStill-unused SOURCE list terms (prefer these when choosing beats / hintAnswers): ${unusedForHints.join(" · ")}`;
    }

    const chatMessages = [
        { role: "system", content: system },
        ...messages
            .filter((m) => m && (m.role === "user" || m.role === "assistant"))
            .map((m) => ({
                role: m.role,
                content: String(m.content || "").trim(),
            }))
            .filter((m) => m.content)
            .slice(-20),
    ];

    // Opening turn: no user message yet — open the scene (or greet without scenario).
    if (chatMessages.length === 1) {
        chatMessages.push({
            role: "user",
            content: sc
                ? `Start the scene now in character. I am playing a simple everyday role described in the system prompt — treat me as that person. Open naturally in the practice language and end with an OPEN content question (not yes/no). For hintAnswers: give 2 continuing answers with very different story strategies, each using at least 2 exact SOURCE list terms — no closings or "I'll ask someone else". Do not list vocabulary words in your spoken reply. Do not break character.`
                : "Start with a short friendly greeting in the practice language and end with an OPEN content question (not yes/no). For hintAnswers: 2 continuing answers with very different story strategies, each using at least 2 exact SOURCE list terms — no closings. Do not list the words in your spoken reply.",
        });
    }

    try {
        const upstream = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: process.env.MISTRAL_CHAT_MODEL || "mistral-small-latest",
                messages: chatMessages,
                temperature: 0.7,
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "practice_talk_turn",
                        strict: true,
                        schema: PRACTICE_CHAT_SCHEMA,
                    },
                },
            }),
        });
        const text = await upstream.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
        if (!upstream.ok) {
            const msg =
                (data && (data.message || data.error?.message || data.error)) ||
                text.slice(0, 400) ||
                "Chat failed.";
            return res.status(upstream.status).json({ error: String(msg) });
        }

        const rawContent = data?.choices?.[0]?.message?.content;
        if (!rawContent) {
            return res.status(502).json({ error: "Empty chat response from Mistral." });
        }
        let parsed;
        try {
            parsed = typeof rawContent === "string" ? JSON.parse(rawContent) : rawContent;
        } catch {
            return res.status(502).json({ error: "Chat response was not valid JSON." });
        }
        const reply = String(parsed.reply || "").trim();
        const usedTerms = Array.isArray(parsed.usedTerms)
            ? parsed.usedTerms.map((t) => String(t || "").trim()).filter(Boolean)
            : [];
        const hintAnswers = normalizeHintAnswers(parsed.hintAnswers);
        const suggestedWords = buildSuggestedWordsFromHints(
            hintAnswers,
            vocabulary,
            Array.isArray(parsed.suggestedWords) ? parsed.suggestedWords : []
        );
        if (!reply) {
            return res.status(502).json({ error: "Chat reply was empty." });
        }
        return res.json({ reply, usedTerms, suggestedWords, hintAnswers });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "word-list-import.html"));
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => console.log(`✅  Running on port ${PORT}`));
}