/*
 * Quick translation bar for the toolbar popup.
 *
 * The popup is a compiled Angular app that we don't touch. This script
 * injects a small, self-contained translation bar at the top of the popup
 * and reuses the same public endpoint the double-click overlay uses
 * (context.reverso.net/bst-query-service).
 */
(function () {
  "use strict";

  var ENDPOINT = "https://context.reverso.net/bst-query-service";
  var STORE_KEY = "revQtbLangs";

  // Language pairs supported by Reverso Context. Values are the API codes.
  var LANGS = [
    { code: "ar", name: "Arabic" },
    { code: "de", name: "German" },
    { code: "en", name: "English" },
    { code: "es", name: "Spanish" },
    { code: "fr", name: "French" },
    { code: "he", name: "Hebrew" },
    { code: "it", name: "Italian" },
    { code: "ja", name: "Japanese" },
    { code: "ko", name: "Korean" },
    { code: "nl", name: "Dutch" },
    { code: "pl", name: "Polish" },
    { code: "pt", name: "Portuguese" },
    { code: "ro", name: "Romanian" },
    { code: "ru", name: "Russian" },
    { code: "sv", name: "Swedish" },
    { code: "tr", name: "Turkish" },
    { code: "uk", name: "Ukrainian" },
    { code: "zh", name: "Chinese" }
  ];

  function loadLangs() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved && saved.source && saved.target) return saved;
    } catch (e) {}
    return { source: "en", target: "fr" };
  }

  function saveLangs(source, target) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ source: source, target: target }));
    } catch (e) {}
  }

  // Escape everything, then re-enable only <em> tags that the API returns
  // around the matched term.
  function safeHighlight(html) {
    var escaped = String(html == null ? "" : html)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped
      .replace(/&lt;em&gt;/g, "<em>")
      .replace(/&lt;\/em&gt;/g, "</em>");
  }

  function buildSelect(className, selectedCode) {
    var sel = document.createElement("select");
    sel.className = className;
    LANGS.forEach(function (lang) {
      var opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = lang.name;
      if (lang.code === selectedCode) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  function build() {
    if (document.getElementById("rev-qtb")) return;

    var langs = loadLangs();

    var root = document.createElement("div");
    root.id = "rev-qtb";

    // Header
    var head = document.createElement("div");
    head.className = "rev-qtb-head";
    var title = document.createElement("span");
    title.className = "rev-qtb-title";
    title.textContent = "Quick translation";
    var toggle = document.createElement("button");
    toggle.className = "rev-qtb-toggle";
    toggle.type = "button";
    toggle.textContent = "\u2013"; // en-dash as "collapse"
    toggle.title = "Show/hide";
    head.appendChild(title);
    head.appendChild(toggle);

    // Body
    var body = document.createElement("div");
    body.className = "rev-qtb-body";

    var langRow = document.createElement("div");
    langRow.className = "rev-qtb-langs";
    var srcSel = buildSelect("rev-qtb-src", langs.source);
    var swap = document.createElement("button");
    swap.className = "rev-qtb-swap";
    swap.type = "button";
    swap.textContent = "\u21C4";
    swap.title = "Swap languages";
    var tgtSel = buildSelect("rev-qtb-tgt", langs.target);
    langRow.appendChild(srcSel);
    langRow.appendChild(swap);
    langRow.appendChild(tgtSel);

    var inputRow = document.createElement("div");
    inputRow.className = "rev-qtb-input-row";
    var input = document.createElement("input");
    input.className = "rev-qtb-input";
    input.type = "text";
    input.placeholder = "Type a word or phrase\u2026";
    input.autocomplete = "off";
    var go = document.createElement("button");
    go.className = "rev-qtb-go";
    go.type = "button";
    go.textContent = "Translate";
    inputRow.appendChild(input);
    inputRow.appendChild(go);

    var results = document.createElement("div");
    results.className = "rev-qtb-results";

    body.appendChild(langRow);
    body.appendChild(inputRow);
    body.appendChild(results);

    root.appendChild(head);
    root.appendChild(body);

    document.body.insertBefore(root, document.body.firstChild);

    // Behaviour
    toggle.addEventListener("click", function () {
      var collapsed = root.classList.toggle("rev-qtb-collapsed");
      toggle.textContent = collapsed ? "+" : "\u2013";
    });

    swap.addEventListener("click", function () {
      var s = srcSel.value;
      srcSel.value = tgtSel.value;
      tgtSel.value = s;
      saveLangs(srcSel.value, tgtSel.value);
      if (input.value.trim()) translate();
    });

    srcSel.addEventListener("change", function () { saveLangs(srcSel.value, tgtSel.value); });
    tgtSel.addEventListener("change", function () { saveLangs(srcSel.value, tgtSel.value); });

    go.addEventListener("click", translate);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") translate();
    });

    function setStatus(msg, isError) {
      results.innerHTML = "";
      var s = document.createElement("div");
      s.className = "rev-qtb-status" + (isError ? " rev-qtb-error" : "");
      s.textContent = msg;
      results.appendChild(s);
    }

    function render(data) {
      results.innerHTML = "";

      var terms = (data && data.dictionary_entry_list) || [];
      if (terms.length) {
        var termsWrap = document.createElement("div");
        termsWrap.className = "rev-qtb-terms";
        terms.slice(0, 10).forEach(function (t) {
          var chip = document.createElement("span");
          chip.className = "rev-qtb-term";
          var term = document.createElement("span");
          term.textContent = t.term || "";
          chip.appendChild(term);
          if (t.pos) {
            var pos = document.createElement("span");
            pos.className = "rev-qtb-pos";
            pos.textContent = t.pos;
            chip.appendChild(pos);
          }
          termsWrap.appendChild(chip);
        });
        results.appendChild(termsWrap);
      }

      var examples = (data && data.list) || [];
      if (examples.length) {
        var exWrap = document.createElement("div");
        exWrap.className = "rev-qtb-examples";
        examples.slice(0, 5).forEach(function (ex) {
          var row = document.createElement("div");
          row.className = "rev-qtb-example";
          var src = document.createElement("span");
          src.className = "rev-qtb-src";
          src.innerHTML = safeHighlight(ex.s_text);
          var tgt = document.createElement("span");
          tgt.className = "rev-qtb-tgt";
          tgt.innerHTML = safeHighlight(ex.t_text);
          row.appendChild(src);
          row.appendChild(tgt);
          exWrap.appendChild(row);
        });
        results.appendChild(exWrap);
      }

      if (!terms.length && !examples.length) {
        setStatus("No translation found.");
      }
    }

    function translate() {
      var text = input.value.trim();
      if (!text) {
        results.innerHTML = "";
        return;
      }
      var source = srcSel.value;
      var target = tgtSel.value;
      if (source === target) {
        setStatus("Source and target languages must differ.", true);
        return;
      }

      saveLangs(source, target);
      go.disabled = true;
      setStatus("Translating\u2026");

      var params = new URLSearchParams({
        source_text: text,
        source_lang: source,
        target_lang: target,
        mode: "1",
        max_results: "24",
        npage: "1",
        json: "1",
        dym_apply: "true",
        pos_reorder: "5",
        isAnonymous: "true"
      });

      fetch(ENDPOINT + "?" + params.toString(), {
        method: "GET",
        headers: { "X-Reverso-Origin": "extension" }
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) { render(data); })
        .catch(function () {
          setStatus("Translation failed. Please try again.", true);
        })
        .then(function () { go.disabled = false; });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
