(function () {
  "use strict";
  var LOG_PREFIX = "[read-aloud]";

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

  function createMistralReadAloud(options) {
    var cfg = Object.assign(
      {
        endpoint: "/read-aloud/stream",
        format: "mp3",
        voice: "gb_oliver_excited",
        language: "en",
        maxChunkChars: 2000,
        audio: null
      },
      options || {}
    );

    var audio = cfg.audio || new Audio();
    audio.preload = "auto";
    audio.muted = false;
    audio.volume = 1;
    var currentAbort = null;

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

    return {
      audio: audio,
      playText: playText,
      stop: stop,
      pause: pause,
      resume: resume
    };
  }

  window.DualTranslationReadAloud = {
    createMistralReadAloud: createMistralReadAloud
  };
})();
