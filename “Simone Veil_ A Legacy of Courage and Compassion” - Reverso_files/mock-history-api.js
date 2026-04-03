(function () {
  "use strict";

  var HISTORY_URL_PART = "/bst-web-user/user/history";
  var READER_PAGE_PATH = "/readerPage/";

  function parseNgState() {
    var script = document.getElementById("ng-state");
    if (!script || !script.textContent) return null;
    try {
      return JSON.parse(script.textContent);
    } catch (err) {
      console.warn("[mock-history-api] Unable to parse ng-state:", err);
      return null;
    }
  }

  function findHistoryResponse(state) {
    if (!state || typeof state !== "object") return null;
    var keys = Object.keys(state);
    for (var i = 0; i < keys.length; i++) {
      var entry = state[keys[i]];
      if (!entry || !entry.u || !entry.b) continue;
      if (typeof entry.u === "string" && entry.u.indexOf(HISTORY_URL_PART) !== -1) {
        return entry;
      }
    }
    return null;
  }

  function parseBody(body) {
    if (!body) return {};
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch (_) {
        return {};
      }
    }
    return body;
  }

  var state = parseNgState();
  var historyEntry = findHistoryResponse(state);
  var initialResults = historyEntry && historyEntry.b && Array.isArray(historyEntry.b.results)
    ? historyEntry.b.results.slice()
    : [];
  var historyUrl = historyEntry && historyEntry.u
    ? historyEntry.u
    : "https://context.reverso.net/bst-web-user/user/history/readerPage/mock-reader-page";
  var pageUuid = historyUrl.indexOf(READER_PAGE_PATH) !== -1
    ? historyUrl.split(READER_PAGE_PATH)[1]
    : "mock-reader-page";

  var store = {
    results: initialResults,
    nextId: Date.now()
  };

  function normalizeWord(payload) {
    var now = new Date().toISOString();
    return {
      id: payload.id || store.nextId++,
      userID: payload.userID || 13505514,
      hash: payload.hash || String(Math.random()).slice(2),
      srcText: payload.srcText || payload.word || "example",
      trgText: payload.trgText || "",
      srcLang: payload.srcLang || "en",
      trgLang: payload.trgLang || "fr",
      priority: payload.priority || 0,
      creationDate: payload.creationDate || now,
      removed: false,
      status: payload.status || 3,
      translation1: payload.translation1 || "",
      translation2: payload.translation2 || "",
      translation3: payload.translation3 || "",
      comment: payload.comment || "",
      document: payload.document || "",
      source: payload.source || 3,
      srcContext: payload.srcContext || "",
      srcSegment: payload.srcSegment || "",
      srcSegmentTranslation1: payload.srcSegmentTranslation1 || null,
      srcSegmentTranslation2: payload.srcSegmentTranslation2 || null,
      srcSegmentTranslation3: payload.srcSegmentTranslation3 || null,
      documentTitle: payload.documentTitle || "Mock Reader Page",
      histType: payload.histType || null,
      position: payload.position || "{\"start\":0,\"end\":0}",
      viewDate: payload.viewDate || now
    };
  }

  function removeWordFromStore(payload) {
    var target = payload || {};
    var id = target.id != null ? Number(target.id) : null;
    var srcText = (target.srcText || target.word || "").toLowerCase();
    var before = store.results.length;
    store.results = store.results.filter(function (item) {
      if (id != null && Number(item.id) === id) return false;
      if (srcText && String(item.srcText || "").toLowerCase() === srcText) return false;
      return true;
    });
    return before !== store.results.length;
  }

  function makeApiResponse(url) {
    return {
      b: {
        numTotalResults: store.results.length,
        numFilteredResults: store.results.length,
        numStoredItems: store.results.length,
        results: store.results.slice()
      },
      h: {},
      s: 200,
      st: "OK",
      u: url || historyUrl,
      rt: "json"
    };
  }

  function isHistoryRequest(url) {
    return typeof url === "string" && url.indexOf(HISTORY_URL_PART) !== -1;
  }

  function makeFetchResponse(payload) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  var originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (originalFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url;
      var method = ((init && init.method) || "GET").toUpperCase();
      if (!isHistoryRequest(url)) return originalFetch(input, init);

      if (method === "GET") {
        return Promise.resolve(makeFetchResponse(makeApiResponse(url)));
      }

      if (method === "POST") {
        var payload = parseBody(init && init.body);
        if (payload && (payload.removed === true || payload.action === "delete")) {
          removeWordFromStore(payload);
        } else {
          var word = normalizeWord(payload);
          store.results.unshift(word);
        }
        return Promise.resolve(makeFetchResponse(makeApiResponse(url)));
      }

      if (method === "DELETE") {
        var delPayload = parseBody(init && init.body);
        removeWordFromStore(delPayload);
        return Promise.resolve(makeFetchResponse(makeApiResponse(url)));
      }

      return Promise.resolve(makeFetchResponse(makeApiResponse(url)));
    };
  }

  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__mockHistoryMethod = (method || "GET").toUpperCase();
    this.__mockHistoryUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (!isHistoryRequest(this.__mockHistoryUrl)) {
      return originalSend.apply(this, arguments);
    }

    var self = this;
    var method = self.__mockHistoryMethod || "GET";
    if (method === "POST") {
      var payload = parseBody(body);
      if (payload && (payload.removed === true || payload.action === "delete")) {
        removeWordFromStore(payload);
      } else {
        var word = normalizeWord(payload);
        store.results.unshift(word);
      }
    }
    if (method === "DELETE") {
      var delPayload = parseBody(body);
      removeWordFromStore(delPayload);
    }

    var responsePayload = JSON.stringify(makeApiResponse(self.__mockHistoryUrl));
    setTimeout(function () {
      Object.defineProperty(self, "readyState", { value: 4, configurable: true });
      Object.defineProperty(self, "status", { value: 200, configurable: true });
      Object.defineProperty(self, "responseText", { value: responsePayload, configurable: true });
      Object.defineProperty(self, "response", { value: responsePayload, configurable: true });
      if (typeof self.onreadystatechange === "function") self.onreadystatechange();
      if (typeof self.onload === "function") self.onload();
      self.dispatchEvent(new Event("readystatechange"));
      self.dispatchEvent(new Event("load"));
      self.dispatchEvent(new Event("loadend"));
    }, 20);
  };

  window.reversoHistoryMock = {
    getPageUuid: function () {
      return pageUuid;
    },
    getResults: function () {
      return store.results.slice();
    },
    addWord: function (wordPayload) {
      var word = normalizeWord(wordPayload || {});
      store.results.unshift(word);
      return word;
    },
    removeWord: function (wordPayload) {
      var removed = removeWordFromStore(wordPayload || {});
      return removed;
    },
    clear: function () {
      store.results = [];
    },
    getApiSnapshot: function () {
      return makeApiResponse(historyUrl);
    }
  };

  console.info("[mock-history-api] Enabled for", HISTORY_URL_PART);
})();
