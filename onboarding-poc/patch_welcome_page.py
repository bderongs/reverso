#!/usr/bin/env python3
"""Patch the saved welcome page with the interactive hover demo (slide 1)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML_PATH = ROOT / "Reverso Chrome Extension _ Free Download.html"

OLD_IMG = (
    '<img _ngcontent-ng-c511768616="" width="528" height="520" '
    'class="post-install-slider__image" alt="Translate and learn as you watch" '
    'loading="lazy" fetchpriority="auto" decoding="auto" ng-img="true" '
    'src="./Reverso Chrome Extension _ Free Download_files/en.gif">'
)

DEMO_MARKUP = """<div class="post-install-slider__image rvp-demo" role="img" aria-label="Translate and learn as you watch" data-rvp-demo>
  <div class="rvp-video">
    <div class="rvp-badge" aria-hidden="true">Netflix</div>
    <div class="rvp-subtitle-bar">
      <p class="rvp-subtitle-line">
        <span class="rvp-word" data-word="we">We</span>
        <span class="rvp-word" data-word="need">need</span>
        <span class="rvp-word" data-word="to">to</span>
        <span class="rvp-word" data-word="get">get</span>
        <span class="rvp-word" data-word="out">out</span>
        <span class="rvp-word" data-word="of">of</span>
        <span class="rvp-word" data-word="here">here</span>
        <span class="rvp-word" data-word="before">before</span>
        <span class="rvp-word" data-word="they">they</span>
        <span class="rvp-word" data-word="find">find</span>
        <span class="rvp-word" data-word="us">us.</span>
      </p>
    </div>
    <div class="rvp-cursor" aria-hidden="true"></div>
    <div class="rvp-tip" role="tooltip" aria-hidden="true">
      <div class="rvp-tip-terms"></div>
      <div class="rvp-tip-example"></div>
    </div>
    <div class="rvp-handoff" hidden>Your turn — hover any word</div>
  </div>
</div>"""

STYLES = """<style id="rvp-styles">
.rvp-demo {
  display: block;
  width: 100%;
  max-width: 528px;
  height: 520px;
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(34, 44, 49, 0.18);
  background: #111;
  user-select: none;
}
.rvp-video {
  position: relative;
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.55) 100%),
    url("./Reverso Chrome Extension _ Free Download_files/en-poster.jpg") center / cover no-repeat;
}
.rvp-badge {
  position: absolute;
  top: 16px;
  left: 16px;
  padding: 4px 10px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.72);
  color: #e50914;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.rvp-subtitle-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 48px 20px 28px;
  background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.88) 55%);
}
.rvp-subtitle-line {
  margin: 0;
  text-align: center;
  font-size: 20px;
  line-height: 32px;
  font-weight: 500;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}
.rvp-word {
  display: inline;
  cursor: pointer;
  border-radius: 4px;
  padding: 0 1px;
  transition: background 0.12s ease;
}
.rvp-word.rvp-active,
.rvp-demo.rvp-interactive .rvp-word:hover {
  background: rgba(255, 255, 128, 0.9);
  color: #111;
}
.rvp-cursor {
  position: absolute;
  width: 22px;
  height: 22px;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 4;
  opacity: 0;
  transform: translate(-4px, -2px);
  transition: left 0.85s cubic-bezier(0.4, 0, 0.2, 1),
    top 0.85s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.25s ease;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45));
}
.rvp-cursor::before {
  content: "";
  display: block;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 12px solid transparent;
  border-left: 18px solid #fff;
}
.rvp-cursor.rvp-visible {
  opacity: 1;
}
.rvp-tip {
  position: absolute;
  z-index: 5;
  min-width: 280px;
  max-width: 360px;
  padding: 10px 14px 12px;
  border-radius: 6px;
  background: rgba(242, 249, 255, 0.95);
  color: #004c87;
  box-shadow: 0 8px 25px rgba(34, 44, 49, 0.25);
  font-family: "Helvetica Neue", Roboto, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 24px;
  pointer-events: none;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.rvp-tip.rvp-visible {
  opacity: 1;
  transform: translateY(0);
}
.rvp-tip-terms {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  justify-content: center;
  font-weight: 500;
}
.rvp-tip-term {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.rvp-tip-pos {
  font-size: 12px;
  color: #607d8b;
  font-weight: 400;
}
.rvp-tip-example {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(0, 76, 135, 0.12);
  font-size: 13px;
  line-height: 20px;
  color: #3b4c55;
  text-align: left;
}
.rvp-tip-example:empty {
  display: none;
}
.rvp-tip-example em {
  font-style: normal;
  background: rgba(255, 255, 128, 0.55);
  border-radius: 2px;
}
.rvp-tip.rvp-loading .rvp-tip-terms::after {
  content: "…";
  margin-left: 4px;
}
.rvp-handoff {
  position: absolute;
  top: 16px;
  right: 16px;
  padding: 8px 12px;
  border-radius: 20px;
  background: rgba(10, 108, 194, 0.92);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(10, 108, 194, 0.35);
  animation: rvp-pulse 2s ease-in-out infinite;
  z-index: 6;
}
.rvp-handoff[hidden] {
  display: none;
}
@keyframes rvp-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
@media only screen and (max-width: 567px) {
  .rvp-subtitle-line { font-size: 16px; line-height: 26px; }
  .rvp-tip { min-width: 220px; font-size: 14px; }
}
</style>"""

SCRIPT = """<script id="rvp-script">
(function () {
  if (window.__rvpDemoInit) return;
  window.__rvpDemoInit = true;

  var ENDPOINT = "https://context.reverso.net/bst-query-service";
  var PREBAKED = {
    we: { terms: [{ term: "nous", pos: "pron." }], example: { src: "We need to leave.", tgt: "Nous devons partir." } },
    need: { terms: [{ term: "avoir besoin", pos: "v." }, { term: "besoin", pos: "n." }], example: { src: "I need help.", tgt: "J'ai besoin d'aide." } },
    to: { terms: [{ term: "de", pos: "part." }], example: { src: "time to go", tgt: "il est temps de partir" } },
    get: { terms: [{ term: "sortir", pos: "v." }], example: { src: "Get out!", tgt: "Sors !" } },
    out: { terms: [{ term: "dehors", pos: "adv." }], example: { src: "Get out of here.", tgt: "Sors d'ici." } },
    of: { terms: [{ term: "de", pos: "prep." }], example: { src: "out of time", tgt: "à court de temps" } },
    here: { terms: [{ term: "ici", pos: "adv." }], example: { src: "Come here.", tgt: "Viens ici." } },
    before: { terms: [{ term: "avant", pos: "prep." }], example: { src: "Before they arrive.", tgt: "Avant qu'ils arrivent." } },
    they: { terms: [{ term: "ils", pos: "pron." }], example: { src: "They are coming.", tgt: "Ils arrivent." } },
    find: { terms: [{ term: "trouver", pos: "v." }], example: { src: "They will find us.", tgt: "Ils nous trouveront." } },
    us: { terms: [{ term: "nous", pos: "pron." }], example: { src: "Help us!", tgt: "Aidez-nous !" } }
  };
  var DEMO_SEQUENCE = ["need", "here", "find"];
  var liveCache = Object.create(null);
  var demo;
  var video;
  var cursor;
  var tip;
  var tipTerms;
  var tipExample;
  var handoff;
  var words;
  var interactive = false;
  var activeWord = null;
  var requestId = 0;

  function normalize(word) {
    return String(word || "").toLowerCase().replace(/[^a-z']/g, "");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function safeHighlight(html) {
    return escapeHtml(html)
      .replace(/&lt;em&gt;/g, "<em>")
      .replace(/&lt;\\/em&gt;/g, "</em>");
  }

  function renderPayload(payload, sourceWord) {
    var terms = (payload && payload.terms) || [];
    var example = payload && payload.example;
    tipTerms.innerHTML = terms.slice(0, 4).map(function (item) {
      return '<span class="rvp-tip-term"><span>' + escapeHtml(item.term) + '</span>' +
        (item.pos ? '<span class="rvp-tip-pos">' + escapeHtml(item.pos) + '</span>' : '') +
        '</span>';
    }).join("");
    if (!tipTerms.innerHTML) {
      tipTerms.textContent = "—";
    }
    if (example && example.src && example.tgt) {
      tipExample.innerHTML = safeHighlight(example.src) + "<br>" + safeHighlight(example.tgt);
    } else {
      tipExample.innerHTML = "";
    }
    positionTip(sourceWord);
  }

  function positionTip(wordEl) {
    if (!wordEl || !demo || !tip) return;
    var demoRect = demo.getBoundingClientRect();
    var wordRect = wordEl.getBoundingClientRect();
    var tipWidth = tip.offsetWidth || 300;
    var tipHeight = tip.offsetHeight || 80;
    var left = wordRect.left - demoRect.left + wordRect.width / 2 - tipWidth / 2;
    var top = wordRect.top - demoRect.top - tipHeight - 14;
    left = Math.max(8, Math.min(left, demoRect.width - tipWidth - 8));
    if (top < 12) {
      top = wordRect.bottom - demoRect.top + 12;
    }
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  function setActiveWord(wordEl) {
    words.forEach(function (node) { node.classList.remove("rvp-active"); });
    if (wordEl) wordEl.classList.add("rvp-active");
    activeWord = wordEl || null;
  }

  function showTip(wordEl, payload, loading) {
    setActiveWord(wordEl);
    tip.classList.toggle("rvp-loading", !!loading);
    tip.classList.add("rvp-visible");
    tip.setAttribute("aria-hidden", "false");
    if (payload) renderPayload(payload, wordEl);
    else positionTip(wordEl);
  }

  function hideTip() {
    tip.classList.remove("rvp-visible", "rvp-loading");
    tip.setAttribute("aria-hidden", "true");
    setActiveWord(null);
  }

  function mapApiResponse(data) {
    var terms = ((data && data.dictionary_entry_list) || []).slice(0, 4).map(function (item) {
      return { term: item.term || "", pos: item.pos || "" };
    });
    var exampleItem = ((data && data.list) || [])[0];
    return {
      terms: terms,
      example: exampleItem ? { src: exampleItem.s_text || "", tgt: exampleItem.t_text || "" } : null
    };
  }

  function resolveTranslation(word, allowLive) {
    var key = normalize(word);
    if (PREBAKED[key]) {
      return Promise.resolve(PREBAKED[key]);
    }
    if (liveCache[key]) {
      return Promise.resolve(liveCache[key]);
    }
    if (!allowLive) {
      return Promise.resolve({ terms: [{ term: "—", pos: "" }], example: null });
    }
    var params = new URLSearchParams({
      source_text: key,
      source_lang: "en",
      target_lang: "fr",
      mode: "1",
      max_results: "24",
      npage: "1",
      json: "1",
      dym_apply: "true",
      pos_reorder: "5",
      isAnonymous: "true"
    });
    return fetch(ENDPOINT + "?" + params.toString(), {
      method: "GET",
      headers: { "X-Reverso-Origin": "extension" }
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        var payload = mapApiResponse(data);
        if (!payload.terms.length) {
          payload = { terms: [{ term: "—", pos: "" }], example: null };
        }
        liveCache[key] = payload;
        return payload;
      })
      .catch(function () {
        return { terms: [{ term: "—", pos: "" }], example: null };
      });
  }

  function translateWord(wordEl, allowLive) {
    var key = normalize(wordEl.getAttribute("data-word") || wordEl.textContent);
    var currentRequest = ++requestId;
    showTip(wordEl, null, true);
    return resolveTranslation(key, allowLive).then(function (payload) {
      if (currentRequest !== requestId) return;
      if (!interactive && !demo.classList.contains("rvp-autodemo")) return;
      if (activeWord !== wordEl && interactive) return;
      showTip(wordEl, payload, false);
    });
  }

  function moveCursorTo(wordEl) {
    var demoRect = demo.getBoundingClientRect();
    var wordRect = wordEl.getBoundingClientRect();
    cursor.style.left = (wordRect.left - demoRect.left + wordRect.width * 0.35) + "px";
    cursor.style.top = (wordRect.top - demoRect.top + wordRect.height * 0.7) + "px";
    cursor.classList.add("rvp-visible");
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function runAutoDemo() {
    demo.classList.add("rvp-autodemo");
    cursor.classList.add("rvp-visible");
    return DEMO_SEQUENCE.reduce(function (chain, key) {
      return chain.then(function () {
        var target = words.find(function (node) {
          return normalize(node.getAttribute("data-word") || node.textContent) === key;
        });
        if (!target) return wait(300);
        moveCursorTo(target);
        return wait(900).then(function () {
          return resolveTranslation(key, false).then(function (payload) {
            showTip(target, payload, false);
            return wait(1400);
          });
        });
      });
    }, wait(700)).then(function () {
      hideTip();
      cursor.classList.remove("rvp-visible");
      demo.classList.remove("rvp-autodemo");
      interactive = true;
      demo.classList.add("rvp-interactive");
      handoff.hidden = false;
    });
  }

  function bindInteractions() {
    words.forEach(function (wordEl) {
      wordEl.addEventListener("mouseenter", function () {
        if (!interactive) return;
        translateWord(wordEl, true);
      });
      wordEl.addEventListener("mouseleave", function () {
        if (!interactive) return;
        requestId++;
        hideTip();
      });
    });
    window.addEventListener("resize", function () {
      if (tip.classList.contains("rvp-visible") && activeWord) {
        positionTip(activeWord);
      }
    });
  }

  function init() {
    demo = document.querySelector("[data-rvp-demo]");
    if (!demo) return;
    video = demo.querySelector(".rvp-video");
    cursor = demo.querySelector(".rvp-cursor");
    tip = demo.querySelector(".rvp-tip");
    tipTerms = demo.querySelector(".rvp-tip-terms");
    tipExample = demo.querySelector(".rvp-tip-example");
    handoff = demo.querySelector(".rvp-handoff");
    words = Array.prototype.slice.call(demo.querySelectorAll(".rvp-word"));
    if (!video || !cursor || !tip || !words.length) return;
    bindInteractions();
    runAutoDemo();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
</script>"""


def main() -> None:
    html = HTML_PATH.read_text(encoding="utf-8")

    if OLD_IMG not in html:
        raise SystemExit("Could not find first-slide <img> to replace.")

    html = html.replace(OLD_IMG, DEMO_MARKUP, 1)

    if 'id="rvp-styles"' not in html:
        html = html.replace("</head>", STYLES + "\n</head>", 1)

    if 'id="rvp-script"' not in html:
        marker = '<script id="ng-state" type="application/json">'
        if marker in html:
            html = html.replace(marker, SCRIPT + "\n" + marker, 1)
        else:
            html = html.replace("</body>", SCRIPT + "\n</body>", 1)

    HTML_PATH.write_text(html, encoding="utf-8")
    print(f"Patched {HTML_PATH}")


if __name__ == "__main__":
    main()
