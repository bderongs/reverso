(function () {
  "use strict";
  var LOG_PREFIX = "[read-aloud]";
  var DEFAULT_MODE = "preGenerated";

  function log(event, payload) {
    try {
      console.log(LOG_PREFIX, event, payload || {});
    } catch (_e) { }
  }

  function sentenceCandidates(text) {
    var out = [];
    String(text || "").replace(/[^.!?]+(?:[.!?]+|$)/g, function (m) {
      out.push(String(m || "").trim());
      return m;
    });
    if (!out.length && String(text || "").trim()) out.push(String(text || "").trim());
    return out.filter(Boolean);
  }

  function splitLongByWords(text, maxChars) {
    var words = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [];
    var chunks = [];
    var current = "";
    for (var i = 0; i < words.length; i += 1) {
      var word = words[i];
      if (word.length > maxChars) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        for (var j = 0; j < word.length; j += maxChars) {
          chunks.push(word.slice(j, j + maxChars));
        }
        continue;
      }
      var next = current ? current + " " + word : word;
      if (next.length <= maxChars) current = next;
      else {
        if (current) chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function splitText(text, maxChars) {
    var normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return [];
    var sentenceLike = sentenceCandidates(normalized);
    var chunks = [];
    for (var i = 0; i < sentenceLike.length; i += 1) {
      var sentence = sentenceLike[i];
      if (!sentence) continue;
      if (sentence.length <= maxChars) chunks.push(sentence);
      else {
        var byWords = splitLongByWords(sentence, maxChars);
        for (var k = 0; k < byWords.length; k += 1) chunks.push(byWords[k]);
      }
    }
    return chunks;
  }

  function normalizeToken(token) {
    return String(token || "")
      .toLowerCase()
      .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "")
      .trim();
  }

  function textToTokens(text) {
    var matches = String(text || "").match(/[a-z0-9']+/gi) || [];
    var out = [];
    for (var i = 0; i < matches.length; i += 1) {
      var normalized = normalizeToken(matches[i]);
      if (normalized) out.push(normalized);
    }
    return out;
  }

  function splitParagraphs(text) {
    var normalized = String(text || "").replace(/\r\n/g, "\n");
    return normalized
      .split(/\n\s*\n+/)
      .map(function (p) {
        return String(p || "").trim();
      })
      .filter(Boolean);
  }

  function findTokenSequenceIndex(haystack, needle) {
    if (!needle.length || needle.length > haystack.length) return -1;
    var anchorLen = Math.min(10, needle.length);
    for (var i = 0; i <= haystack.length - needle.length; i += 1) {
      var ok = true;
      for (var j = 0; j < anchorLen; j += 1) {
        if (haystack[i + j] !== needle[j]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (var k = anchorLen; k < needle.length; k += 1) {
        if (haystack[i + k] !== needle[k]) {
          ok = false;
          break;
        }
      }
      if (ok) return i;
    }
    return -1;
  }

  function findParagraphStartIndex(allTokens, paragraphTokens) {
    if (!paragraphTokens.length || !allTokens.length) return -1;
    var full = findTokenSequenceIndex(allTokens, paragraphTokens);
    if (full >= 0) return full;
    // Fallback to robust anchor matching for slight text differences.
    var anchorSizes = [24, 16, 12, 8, 6];
    for (var i = 0; i < anchorSizes.length; i += 1) {
      var size = Math.min(anchorSizes[i], paragraphTokens.length);
      if (size < 4) continue;
      var anchor = paragraphTokens.slice(0, size);
      var idx = findTokenSequenceIndex(allTokens, anchor);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function scoreParagraphSimilarity(aText, bText) {
    var a = textToTokens(aText);
    var b = textToTokens(bText);
    if (!a.length || !b.length) return 0;
    var maxPrefix = Math.min(20, a.length, b.length);
    var prefixHits = 0;
    for (var i = 0; i < maxPrefix; i += 1) {
      if (a[i] !== b[i]) break;
      prefixHits += 1;
    }
    var prefixScore = prefixHits / maxPrefix;
    var aSet = Object.create(null);
    for (var j = 0; j < a.length; j += 1) aSet[a[j]] = true;
    var overlapHits = 0;
    for (var k = 0; k < b.length; k += 1) {
      if (aSet[b[k]]) overlapHits += 1;
    }
    var overlapScore = overlapHits / Math.max(a.length, b.length);
    return prefixScore * 0.7 + overlapScore * 0.3;
  }

  function pickTranscriptParagraph(paragraphs, paragraphText, paragraphIndex) {
    if (!Array.isArray(paragraphs) || !paragraphs.length) return String(paragraphText || "");
    if (paragraphs.length <= 1) return String(paragraphText || "");
    if (typeof paragraphIndex === "number" && paragraphIndex >= 0 && paragraphIndex < paragraphs.length) {
      return String(paragraphs[paragraphIndex] || "");
    }
    var best = String(paragraphText || "");
    var bestScore = -1;
    for (var i = 0; i < paragraphs.length; i += 1) {
      var candidate = String(paragraphs[i] || "");
      var score = scoreParagraphSimilarity(paragraphText, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  function createMistralReadAloud(options) {
    var cfg = Object.assign(
      {
        mode: DEFAULT_MODE,
        endpoint: "/read-aloud/stream",
        format: "mp3",
        voice: "en_paul_neutral",
        language: "en-US",
        maxChunkChars: 2000,
        audio: null,
        preGeneratedAudioUrl: "/reader_v2.mp3",
        preGeneratedAudioByLanguage: null,
        preGeneratedTranscriptUrl: "/reader_v2_mp3_transcript.json",
        preGeneratedTranscriptByLanguage: null
      },
      options || {}
    );

    var audio = cfg.audio || new Audio();
    audio.preload = "auto";
    audio.muted = false;
    audio.volume = 1;
    var currentAbort = null;
    var runtimeMode = cfg.mode === "preGenerated" ? "preGenerated" : "streaming";
    var preGeneratedDataPromise = null;
    var karaokeState = {
      activeSegmentIndex: -1,
      onTimeUpdate: null,
      onEnded: null,
      onPlaying: null,
      onPause: null,
      tickRaf: 0
    };

    audio.addEventListener("playing", function () {
      log("audio_playing", {
        currentTime: audio.currentTime,
        duration: audio.duration,
        readyState: audio.readyState,
        muted: audio.muted,
        volume: audio.volume
      });
    });
    audio.addEventListener("pause", function () {
      log("audio_pause", { currentTime: audio.currentTime });
    });
    audio.addEventListener("ended", function () {
      log("audio_ended", { currentTime: audio.currentTime, duration: audio.duration });
    });
    audio.addEventListener("error", function () {
      var mediaErr = audio.error;
      log("audio_error", {
        code: mediaErr ? mediaErr.code : null,
        message: mediaErr && mediaErr.message ? mediaErr.message : "",
        currentSrc: audio.currentSrc || ""
      });
    });

    function clearKaraokeListeners() {
      if (karaokeState.tickRaf) {
        try {
          cancelAnimationFrame(karaokeState.tickRaf);
        } catch (_eCancel) { }
        karaokeState.tickRaf = 0;
      }
      if (karaokeState.onTimeUpdate) audio.removeEventListener("timeupdate", karaokeState.onTimeUpdate);
      if (karaokeState.onEnded) audio.removeEventListener("ended", karaokeState.onEnded);
      if (karaokeState.onPlaying) audio.removeEventListener("playing", karaokeState.onPlaying);
      if (karaokeState.onPause) audio.removeEventListener("pause", karaokeState.onPause);
      karaokeState.activeSegmentIndex = -1;
      karaokeState.onTimeUpdate = null;
      karaokeState.onEnded = null;
      karaokeState.onPlaying = null;
      karaokeState.onPause = null;
    }

    function languageKeyedLookup(map, fallback) {
      if (map && typeof map === "object") {
        var normalized = String(cfg.language || "")
          .trim()
          .replace(/_/g, "-")
          .toLowerCase();
        if (normalized && map[normalized]) return String(map[normalized]);
        var base = normalized ? normalized.split("-")[0] : "";
        if (base && map[base]) return String(map[base]);
      }
      return String(fallback || "");
    }

    function resolvePreGeneratedAudioUrl() {
      return languageKeyedLookup(cfg.preGeneratedAudioByLanguage, cfg.preGeneratedAudioUrl);
    }

    function resolvePreGeneratedTranscriptUrl() {
      return languageKeyedLookup(cfg.preGeneratedTranscriptByLanguage, cfg.preGeneratedTranscriptUrl);
    }

    async function loadPreGeneratedData() {
      if (preGeneratedDataPromise) return preGeneratedDataPromise;
      var transcriptUrl = resolvePreGeneratedTranscriptUrl();
      preGeneratedDataPromise = fetch(transcriptUrl)
        .then(function (res) {
          if (!res.ok) throw new Error("Transcript request failed (" + res.status + ")");
          return res.json();
        })
        .then(function (data) {
          var segments = Array.isArray(data && data.segments) ? data.segments : [];
          var timedWords = [];
          var timedSegments = [];
          var segmentTimedWordSpan = [];
          for (var i = 0; i < segments.length; i += 1) {
            var seg = segments[i];
            var segText = String(seg && seg.text ? seg.text : "");
            var segStart = Number(seg && seg.start != null ? seg.start : 0);
            var segEnd = Number(seg && seg.end != null ? seg.end : segStart);
            var tokens = textToTokens(segText);
            if (!tokens.length) continue;
            timedSegments.push({
              segmentIndex: i,
              start: segStart,
              end: Math.max(segStart, segEnd)
            });
            var fromIdx = timedWords.length;
            for (var t = 0; t < tokens.length; t += 1) {
              timedWords.push({
                token: tokens[t],
                segmentIndex: i
              });
            }
            segmentTimedWordSpan[i] = {
              from: fromIdx,
              to: timedWords.length - 1
            };
          }
          return {
            transcript: String((data && data.text) || ""),
            paragraphs: splitParagraphs((data && data.text) || ""),
            timedWords: timedWords,
            timedSegments: timedSegments,
            segmentTimedWordSpan: segmentTimedWordSpan
          };
        });
      return preGeneratedDataPromise;
    }

    function findTokenSequenceIndex(haystack, needle) {
      if (!needle.length || needle.length > haystack.length) return -1;
      var anchorLen = Math.min(10, needle.length);
      for (var i = 0; i <= haystack.length - needle.length; i += 1) {
        var ok = true;
        for (var j = 0; j < anchorLen; j += 1) {
          if (haystack[i + j] !== needle[j]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        for (var k = anchorLen; k < needle.length; k += 1) {
          if (haystack[i + k] !== needle[k]) {
            ok = false;
            break;
          }
        }
        if (ok) return i;
      }
      return -1;
    }

    function setupSegmentKaraokeTracking(timedSegments, segmentTimedWordSpan, callbacks) {
      clearKaraokeListeners();
      if (!timedSegments || !timedSegments.length) return;
      var cb = callbacks || {};
      var offsetSec = Number(window.READ_ALOUD_TRANSCRIPT_OFFSET_SEC || 0);
      function syncKaraokeToCurrentTime() {
        var audioCurrent = Number(audio.currentTime || 0);
        var current = audioCurrent - offsetSec;
        var active = -1;
        for (var si = 0; si < timedSegments.length; si += 1) {
          var sg = timedSegments[si];
          var t0 = Number(sg && sg.start != null ? sg.start : 0);
          var t1 = Number(sg && sg.end != null ? sg.end : t0);
          if (current + 1e-4 >= t0 && current <= t1 + 0.12) {
            active = sg.segmentIndex;
            break;
          }
        }
        if (active !== karaokeState.activeSegmentIndex) {
          karaokeState.activeSegmentIndex = active;
          if (typeof cb.onWordChange === "function") {
            if (active < 0) {
              cb.onWordChange(null);
            } else {
              var span = segmentTimedWordSpan[active];
              if (!span) {
                cb.onWordChange(null);
              } else {
                cb.onWordChange({
                  kind: "segment",
                  segmentIndex: active,
                  timedWordIndexFrom: span.from,
                  timedWordIndexTo: span.to
                });
              }
            }
          }
        }
      }
      karaokeState.onTimeUpdate = syncKaraokeToCurrentTime;
      function scheduleKaraokeFrame() {
        if (karaokeState.tickRaf) return;
        karaokeState.tickRaf = requestAnimationFrame(function karaokeSegFrame() {
          karaokeState.tickRaf = 0;
          if (!karaokeState.onTimeUpdate) return;
          syncKaraokeToCurrentTime();
          if (!audio.paused && !audio.ended) {
            scheduleKaraokeFrame();
          }
        });
      }
      karaokeState.onPlaying = function () {
        syncKaraokeToCurrentTime();
        scheduleKaraokeFrame();
      };
      karaokeState.onPause = function () {
        if (karaokeState.tickRaf) {
          try {
            cancelAnimationFrame(karaokeState.tickRaf);
          } catch (_eSegPause) { }
          karaokeState.tickRaf = 0;
        }
        syncKaraokeToCurrentTime();
      };
      karaokeState.onEnded = function () {
        if (karaokeState.tickRaf) {
          try {
            cancelAnimationFrame(karaokeState.tickRaf);
          } catch (_eSegEnd) { }
          karaokeState.tickRaf = 0;
        }
        karaokeState.activeSegmentIndex = -1;
        if (typeof cb.onWordChange === "function") cb.onWordChange(null);
      };
      audio.addEventListener("timeupdate", karaokeState.onTimeUpdate);
      audio.addEventListener("playing", karaokeState.onPlaying);
      audio.addEventListener("pause", karaokeState.onPause);
      audio.addEventListener("ended", karaokeState.onEnded);
    }

    async function playPreGenerated(text, callbacks) {
      var cb = callbacks || {};
      var data = await loadPreGeneratedData();
      var allTokens = data.timedWords.map(function (w) { return w.token; });
      var timedSegmentsAll = Array.isArray(data.timedSegments) ? data.timedSegments : [];
      var segmentSpan = data.segmentTimedWordSpan || [];
      var startAt = 0;
      var timedWordSliceStart = 0;
      var firstSegIdx = 0;
      var paragraphText = typeof cb.paragraphText === "string" ? cb.paragraphText : "";
      var paragraphIndex = typeof cb.paragraphIndex === "number" ? cb.paragraphIndex : -1;
      if (paragraphText) {
        var transcriptParagraphText = pickTranscriptParagraph(data.paragraphs, paragraphText, paragraphIndex);
        var paragraphTokens = textToTokens(transcriptParagraphText || paragraphText);
        log("paragraph_debug_input", {
          paragraphIndex: paragraphIndex,
          paragraphTextStart: String(paragraphText || "").slice(0, 120),
          transcriptParagraphStart: String(transcriptParagraphText || "").slice(0, 120),
          paragraphTokenCount: paragraphTokens.length
        });
        var idx = findParagraphStartIndex(allTokens, paragraphTokens);
        if (idx >= 0) {
          firstSegIdx = Number(data.timedWords[idx].segmentIndex || 0);
          for (var zi = 0; zi < timedSegmentsAll.length; zi += 1) {
            if (timedSegmentsAll[zi].segmentIndex === firstSegIdx) {
              startAt = Number(timedSegmentsAll[zi].start || 0);
              break;
            }
          }
          timedWordSliceStart = idx;
          log("paragraph_match", {
            tokenCount: paragraphTokens.length,
            startTokenIndex: idx,
            startAt: startAt,
            paragraphIndex: paragraphIndex,
            firstSegIdx: firstSegIdx
          });
        } else {
          log("paragraph_match_miss", { tokenCount: paragraphTokens.length, paragraphIndex: paragraphIndex });
        }
      } else if (text) {
        var tokens = textToTokens(text);
        var startIdx = findTokenSequenceIndex(allTokens, tokens.slice(0, Math.min(tokens.length, 24)));
        if (startIdx >= 0) {
          firstSegIdx = Number(data.timedWords[startIdx].segmentIndex || 0);
          for (var zj = 0; zj < timedSegmentsAll.length; zj += 1) {
            if (timedSegmentsAll[zj].segmentIndex === firstSegIdx) {
              startAt = Number(timedSegmentsAll[zj].start || 0);
              break;
            }
          }
          timedWordSliceStart = startIdx;
        }
      }

      var segPlayStart = 0;
      for (var si = 0; si < timedSegmentsAll.length; si += 1) {
        if (timedSegmentsAll[si].segmentIndex >= firstSegIdx) {
          segPlayStart = si;
          break;
        }
      }
      var timedSegmentsForPlay = timedSegmentsAll.slice(segPlayStart);

      var wrappedCallbacks = Object.assign({}, cb);
      if (typeof cb.onWordChange === "function") {
        var base = timedWordSliceStart;
        var origWord = cb.onWordChange;
        wrappedCallbacks.onWordChange = function (word) {
          if (!word) {
            origWord(null);
            return;
          }
          if (word.kind === "segment") {
            origWord({
              kind: "segment",
              segmentIndex: word.segmentIndex,
              paragraphTimedWordFrom: Math.max(0, word.timedWordIndexFrom - base),
              paragraphTimedWordTo: Math.max(0, word.timedWordIndexTo - base)
            });
            return;
          }
          origWord(word);
        };
      }

      var seekOnLoad = Math.max(0, Number(startAt) || 0);
      var resumeMedia = cb.resumeMediaSeconds;
      if (typeof resumeMedia === "number" && isFinite(resumeMedia) && resumeMedia >= 0) {
        seekOnLoad = resumeMedia;
      }
      var resumePaused = Boolean(cb.resumePaused);

      function clampSeekToDuration(raw) {
        var t = Math.max(0, Number(raw) || 0);
        var dur = audio.duration;
        if (isFinite(dur) && dur > 0) {
          t = Math.min(t, Math.max(0, dur - 0.05));
        }
        return t;
      }

      var preGeneratedAudioUrl = resolvePreGeneratedAudioUrl();
      audio.src = preGeneratedAudioUrl;
      audio.load();
      log("pregenerated_seek_begin", { startAt: startAt, seekOnLoad: seekOnLoad, src: preGeneratedAudioUrl });
      if (seekOnLoad > 0) {
        var seekTarget = seekOnLoad;
        await new Promise(function (resolve) {
          var done = false;
          var attemptedSeek = false;
          function finish() {
            if (done) return;
            done = true;
            audio.removeEventListener("loadedmetadata", onLoadedMetadata);
            audio.removeEventListener("canplay", onLoadedMetadata);
            resolve();
          }
          function onLoadedMetadata() {
            try {
              seekTarget = clampSeekToDuration(seekOnLoad);
              audio.currentTime = seekTarget;
              attemptedSeek = true;
              log("pregenerated_seek_on_metadata", {
                seekTarget: seekTarget,
                currentTime: audio.currentTime,
                readyState: audio.readyState
              });
            } catch (_e) { }
            finish();
          }
          function trySeekNow() {
            if (attemptedSeek) return;
            try {
              seekTarget = clampSeekToDuration(seekOnLoad);
              audio.currentTime = seekTarget;
              attemptedSeek = true;
              log("pregenerated_seek_try_now", {
                seekTarget: seekTarget,
                currentTime: audio.currentTime,
                readyState: audio.readyState
              });
            } catch (_e) { }
          }
          audio.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
          audio.addEventListener("canplay", onLoadedMetadata, { once: true });
          trySeekNow();
          setTimeout(function () {
            trySeekNow();
            log("pregenerated_seek_timeout_finish", {
              seekTarget: seekTarget,
              attemptedSeek: attemptedSeek,
              currentTime: audio.currentTime,
              readyState: audio.readyState
            });
            finish();
          }, 2200);
        });
      } else {
        try {
          audio.currentTime = 0;
        } catch (_e0) { }
      }
      log("pregenerated_before_play", {
        startAt: startAt,
        seekOnLoad: seekOnLoad,
        currentTime: audio.currentTime,
        readyState: audio.readyState
      });
      setupSegmentKaraokeTracking(timedSegmentsForPlay, segmentSpan, wrappedCallbacks);
      currentAbort = new AbortController();
      var chunkForUi = String(cb.paragraphText || text || data.transcript || "");
      var mediaTimeStart = 0;
      var mediaTimeEnd = 0;
      if (timedSegmentsForPlay.length) {
        mediaTimeStart = Number(timedSegmentsForPlay[0].start || 0);
        mediaTimeEnd = Number(timedSegmentsForPlay[timedSegmentsForPlay.length - 1].end || 0);
      }
      if (typeof cb.onChunkStart === "function") {
        cb.onChunkStart({
          chunkText: chunkForUi,
          chunkIndex: 0,
          startChar: 0,
          mediaTimeStart: mediaTimeStart,
          mediaTimeEnd: mediaTimeEnd
        });
      }
      if (resumePaused) {
        try {
          audio.pause();
        } catch (_pz) { }
        if (karaokeState.onTimeUpdate) karaokeState.onTimeUpdate();
        currentAbort = null;
        return { mode: "preGenerated", startAt: startAt, seekOnLoad: seekOnLoad, paused: true };
      }
      await audio.play();
      log("pregenerated_after_play", {
        startAt: startAt,
        seekOnLoad: seekOnLoad,
        currentTime: audio.currentTime,
        readyState: audio.readyState,
        duration: audio.duration
      });
      await waitForAudioEndOrAbort(currentAbort.signal);
      if (typeof cb.onChunkEnd === "function") {
        cb.onChunkEnd({
          chunkText: chunkForUi,
          chunkIndex: 0,
          playedChars: chunkForUi.length
        });
      }
      currentAbort = null;
      return { mode: "preGenerated", startAt: startAt, seekOnLoad: seekOnLoad, paused: false };
    }

    async function fetchChunkAudioUrl(chunk, signal) {
      log("chunk_request_start", { chars: chunk.length, format: cfg.format, voice: cfg.voice });
      var res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: chunk,
          format: cfg.format,
          voice: cfg.voice,
          language: cfg.language
        }),
        signal: signal
      });
      if (!res.ok) {
        var errText = "";
        try {
          errText = await res.text();
        } catch (_e) { }
        throw new Error("TTS request failed (" + res.status + "): " + (errText || "Unknown error"));
      }
      var blob = await res.blob();
      log("chunk_request_ok", {
        status: res.status,
        contentType: res.headers.get("content-type") || "",
        blobType: blob.type || "",
        blobSize: blob.size || 0
      });
      if (!blob.size) {
        throw new Error("TTS response was empty.");
      }
      return URL.createObjectURL(blob);
    }

    function waitForAudioEndOrAbort(signal) {
      return new Promise(function (resolve, reject) {
        var done = false;
        function cleanup() {
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("error", onError);
          signal.removeEventListener("abort", onAbort);
        }
        function onEnded() {
          if (done) return;
          done = true;
          cleanup();
          resolve();
        }
        function onError() {
          if (done) return;
          done = true;
          cleanup();
          reject(new Error("Audio playback error"));
        }
        function onAbort() {
          if (done) return;
          done = true;
          cleanup();
          try {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
          } catch (_e) { }
          reject(new DOMException("Aborted", "AbortError"));
        }
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", onError);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }

    async function playChunk(chunk, signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      var objectUrl = await fetchChunkAudioUrl(chunk, signal);
      audio.src = objectUrl;
      audio.load();
      log("chunk_play_attempt", {
        objectUrl: objectUrl.slice(0, 24) + "...",
        muted: audio.muted,
        volume: audio.volume,
        readyState: audio.readyState
      });
      try {
        await audio.play();
        log("chunk_play_started", {
          currentTime: audio.currentTime,
          duration: audio.duration,
          readyState: audio.readyState
        });
        await waitForAudioEndOrAbort(signal);
      } finally {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (_e) { }
      }
    }

    async function playText(text, callbacks) {
      if (runtimeMode === "preGenerated") {
        return playPreGenerated(text, callbacks);
      }
      var cb = callbacks || {};
      var chunks = splitText(text, cfg.maxChunkChars);
      if (!chunks.length) throw new Error("No text to read");
      log("play_text_start", { totalChars: String(text || "").length, chunkCount: chunks.length });
      currentAbort = new AbortController();
      var playedChars = 0;
      for (var i = 0; i < chunks.length; i += 1) {
        var chunk = chunks[i];
        if (typeof cb.onChunkStart === "function") {
          cb.onChunkStart({
            chunkText: chunk,
            chunkIndex: i,
            startChar: playedChars
          });
        }
        await playChunk(chunk, currentAbort.signal);
        playedChars += chunk.length;
        if (typeof cb.onChunkEnd === "function") {
          cb.onChunkEnd({
            chunkText: chunk,
            chunkIndex: i,
            playedChars: playedChars
          });
        }
      }
      currentAbort = null;
      return { playedChars: playedChars };
    }

    function stop() {
      if (currentAbort) {
        try {
          currentAbort.abort();
        } catch (_e) { }
      }
      currentAbort = null;
      clearKaraokeListeners();
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch (_e2) { }
    }

    function pause() {
      audio.pause();
    }

    function resume() {
      return audio.play();
    }

    function setMode(mode) {
      runtimeMode = mode === "preGenerated" ? "preGenerated" : "streaming";
      log("mode_set", { mode: runtimeMode });
      return runtimeMode;
    }

    function getMode() {
      return runtimeMode;
    }

    async function playParagraph(paragraphText, callbacks) {
      if (!String(paragraphText || "").trim()) throw new Error("No paragraph text provided");
      return playText(null, Object.assign({}, callbacks || {}, { paragraphText: paragraphText }));
    }

    async function loadAssets() {
      if (runtimeMode !== "preGenerated") return null;
      return loadPreGeneratedData();
    }

    return {
      audio: audio,
      playText: playText,
      playParagraph: playParagraph,
      stop: stop,
      pause: pause,
      resume: resume
      ,
      setMode: setMode,
      getMode: getMode,
      loadAssets: loadAssets
    };
  }

  window.DualTranslationReadAloud = {
    createMistralReadAloud: createMistralReadAloud,
    setDefaultMode: function (mode) {
      DEFAULT_MODE = mode === "preGenerated" ? "preGenerated" : "streaming";
      return DEFAULT_MODE;
    },
    getDefaultMode: function () {
      return DEFAULT_MODE;
    }
  };
})();
