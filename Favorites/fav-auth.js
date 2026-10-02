/**
 * Shared auth helpers for Favourites / SRS local testers.
 * Stores a long-lived refreshToken and exchanges it for access tokens via
 * POST https://account.reverso.net/api/v1/account/accessToken (direct from the browser).
 *
 * Proxy routes (/proxy, /account-proxy) are set aside — clients call Reverso APIs directly.
 */
(function (global) {
  const STORAGE_KEY = "fav-api-tester.v1";
  const ACCOUNT_API_BASE = "https://account.reverso.net";
  const ACCOUNT_TOKEN_PATH = `${ACCOUNT_API_BASE}/api/v1/account/accessToken`;
  const FAV_API_BASE = "https://context.reverso.net/bst-web-user";
  /** Preferred User-Agent; browsers often forbid overriding it on fetch. */
  const CLIENT_UA = "reverso-internal-tester";
  const TOKEN_SKEW_SEC = 60;
  /** Fixed client origin for all Favourites / SRS local testers. */
  const FIXED_ORIGIN = "reverso.app.ios";

  let refreshInFlight = null;

  function el(id) {
    return document.getElementById(id);
  }

  function loadAuth() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function normalizeBearer(token) {
    const raw = String(token || "").trim();
    if (!raw) return "";
    return /^Bearer\s+/i.test(raw) || raw.split(".").length !== 3 ? raw : `Bearer ${raw}`;
  }

  function bareToken(token) {
    return String(token || "").replace(/^Bearer\s+/i, "").trim();
  }

  function getAccessTokenValue() {
    return el("auth-token")?.value.trim() || loadAuth().authToken || "";
  }

  function getRefreshTokenValue() {
    return el("refresh-token")?.value.trim() || loadAuth().refreshToken || "";
  }

  function getOriginValue() {
    return FIXED_ORIGIN;
  }

  function forceOriginInput() {
    const input = el("origin-header");
    if (input) {
      input.value = FIXED_ORIGIN;
      input.readOnly = true;
    }
  }

  /** Absolute Favourites API URL for a path like `/user/favourites?...`. */
  function favApiUrl(pathWithQuery) {
    const path = String(pathWithQuery || "");
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return FAV_API_BASE.replace(/\/$/, "") + normalized;
  }

  function setAccessTokenValue(token) {
    const normalized = bareToken(token);
    if (el("auth-token")) el("auth-token").value = normalized;
  }

  function setRefreshTokenValue(token) {
    if (el("refresh-token")) el("refresh-token").value = String(token || "").trim();
  }

  function saveAuth() {
    const prev = loadAuth();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...prev,
        authToken: getAccessTokenValue(),
        refreshToken: getRefreshTokenValue(),
        origin: getOriginValue(),
      })
    );
  }

  function decodeJwtPayload(token) {
    const raw = bareToken(token);
    const parts = raw.split(".");
    if (parts.length < 2) return null;
    try {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    } catch {
      return null;
    }
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.floor(sec));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function jwtValidity(token) {
    const raw = String(token || "").trim();
    if (!raw) return { level: "empty", badge: "No access token", detail: "" };
    const payload = decodeJwtPayload(raw);
    if (!payload) {
      return { level: "invalid", badge: "Not a JWT", detail: "Paste a Bearer JWT or use a refresh token." };
    }
    if (!payload.exp) {
      return { level: "warn", badge: "No exp", detail: "Token has no exp claim." };
    }
    const remaining = payload.exp - Date.now() / 1000;
    const when = new Date(payload.exp * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (remaining <= 0) {
      return {
        level: "err",
        badge: `Expired ${formatDuration(-remaining)} ago`,
        detail: `JWT expired at ${when}.`,
      };
    }
    if (remaining <= 120) {
      return {
        level: "warn",
        badge: `Expires in ${formatDuration(remaining)}`,
        detail: `JWT exp at ${when}.`,
      };
    }
    return {
      level: "ok",
      badge: `Valid · ${formatDuration(remaining)} left`,
      detail: `JWT exp at ${when}.`,
    };
  }

  function hasRefreshToken() {
    return !!getRefreshTokenValue();
  }

  function updateJwtUi() {
    const info = jwtValidity(getAccessTokenValue());
    const badge = el("jwt-badge");
    const inline = el("jwt-warn-inline");
    const refresh = hasRefreshToken();

    let badgeText = info.badge;
    let level = info.level;
    let detail = info.detail;

    if (refresh) {
      if (info.level === "empty" || info.level === "err") {
        badgeText = info.level === "empty" ? "Refresh token saved" : "Expired · will refresh";
        level = info.level === "empty" ? "ok" : "warn";
        detail = info.level === "empty"
          ? "Access token will be fetched from your refresh token when needed."
          : `${info.detail} A fresh access token will be requested automatically.`;
      } else if (info.level === "warn") {
        detail = `${info.detail} Will refresh automatically when needed.`;
      }
    } else if (info.level === "err") {
      detail = `${info.detail} Paste a refresh token to avoid manual JWT copy-paste.`;
    }

    if (badge) {
      badge.textContent = badgeText;
      badge.className =
        "jwt-badge" +
        (level === "ok"
          ? " ok"
          : level === "warn" || level === "invalid"
            ? " warn"
            : level === "err"
              ? " err"
              : "");
    }

    if (inline) {
      const show =
        level === "err" ||
        level === "warn" ||
        level === "invalid" ||
        (refresh && info.level === "empty");
      inline.classList.toggle("show", show);
      inline.classList.toggle("err", level === "err");
      inline.textContent = show ? detail : "";
    }

    return { ...info, level, badge: badgeText, detail };
  }

  function authHeaders() {
    const headers = {
      Accept: "application/json",
      "X-Reverso-Origin": FIXED_ORIGIN,
      // Browsers usually strip User-Agent; X-Reverso-Client still identifies the tester.
      "User-Agent": CLIENT_UA,
      "X-Reverso-Client": CLIENT_UA,
    };
    const token = getAccessTokenValue();
    if (token) headers.Authorization = normalizeBearer(token);
    return headers;
  }

  function accessTokenNeedsRefresh() {
    const token = getAccessTokenValue();
    if (!token) return true;
    const payload = decodeJwtPayload(token);
    if (!payload?.exp) return false;
    return payload.exp - Date.now() / 1000 <= TOKEN_SKEW_SEC;
  }

  function htmlToPlainText(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Build a long, readable error from an upstream response.
   * Prefer bodyText / JSON fields; fall back to stripped HTML; keep a large slice.
   */
  function formatUpstreamError(res, data, text, pathLabel) {
    const status = res?.status ?? "?";
    const ct = res?.headers?.get?.("content-type") || "";
    const upstreamUrl = res?.headers?.get?.("x-proxy-upstream-url") || "";
    const parts = [`${status} ${pathLabel || ""}`.trim()];
    if (upstreamUrl) parts.push(`upstream ${upstreamUrl}`);
    if (ct) parts.push(`content-type ${ct}`);

    let detail = "";
    if (data && typeof data === "object" && !Array.isArray(data)) {
      if (data.bodyText) detail = String(data.bodyText);
      else if (data.message || data.error || data.title) {
        detail = [data.error, data.message, data.title, data.bodyText]
          .filter(Boolean)
          .map(String)
          .join(" — ");
        try {
          const full = JSON.stringify(data, null, 2);
          if (full.length < 12000) detail = `${detail}\n${full}`;
          else detail = `${detail}\n${full.slice(0, 12000)}\n…[truncated]`;
        } catch {
          /* ignore */
        }
      } else {
        try {
          detail = JSON.stringify(data, null, 2);
        } catch {
          detail = String(data);
        }
      }
    } else if (typeof data === "string") {
      detail = /^\s*</.test(data) ? htmlToPlainText(data) : data;
    } else if (text) {
      detail = /^\s*</.test(text) ? htmlToPlainText(text) : String(text);
    }

    detail = String(detail || "").trim();
    if (detail.length > 12000) detail = `${detail.slice(0, 12000)}\n…[truncated ${detail.length} chars]`;
    const msg = detail ? `${parts.join(" · ")}\n${detail}` : parts.join(" · ");
    const err = new Error(msg);
    err.status = status;
    err.upstreamUrl = upstreamUrl;
    err.upstreamBody = typeof data === "string" ? data : (text || data);
    err.upstreamJson = data && typeof data === "object" ? data : null;
    return err;
  }

  async function refreshAccessToken() {
    const refreshToken = getRefreshTokenValue();
    if (!refreshToken) throw new Error("No refresh token — paste one in Auth & load.");

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Reverso-Origin": FIXED_ORIGIN,
      "User-Agent": CLIENT_UA,
      "X-Reverso-Client": CLIENT_UA,
    };
    const current = getAccessTokenValue();
    if (current) headers.Authorization = normalizeBearer(current);

    const res = await fetch(ACCOUNT_TOKEN_PATH, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = formatUpstreamError(res, data, text, ACCOUNT_TOKEN_PATH);
      console.error("[FavAuth] refresh failed", err.upstreamJson || err.upstreamBody || err.message);
      throw err;
    }
    if (!data?.accessToken) {
      throw new Error("Refresh response missing accessToken.");
    }

    setAccessTokenValue(data.accessToken);
    if (data.refreshToken) setRefreshTokenValue(data.refreshToken);
    saveAuth();
    updateJwtUi();
    return data.accessToken;
  }

  async function ensureAccessToken({ force = false } = {}) {
    if (!force && !accessTokenNeedsRefresh()) {
      return getAccessTokenValue();
    }
    const refreshToken = getRefreshTokenValue();
    if (refreshToken) {
      if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
      }
      return refreshInFlight;
    }
    const token = getAccessTokenValue();
    const info = jwtValidity(token);
    if (token && info.level !== "err") return token;
    throw new Error("Access token expired and no refresh token is saved.");
  }

  function authReadyForLiveApi() {
    if (getRefreshTokenValue()) return true;
    const info = jwtValidity(getAccessTokenValue());
    return !!getAccessTokenValue() && info.level !== "err";
  }

  async function fetchWithAuth(url, options = {}, retried = false) {
    await ensureAccessToken();
    const res = await fetch(url, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
    });
    if (
      !retried &&
      (res.status === 401 || res.status === 403) &&
      getRefreshTokenValue()
    ) {
      await refreshAccessToken();
      return fetchWithAuth(url, options, true);
    }
    return res;
  }

  async function readJsonResponse(res, pathLabel) {
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = formatUpstreamError(res, data, text, pathLabel);
      console.error("[FavAuth] API error", err.upstreamJson || err.upstreamBody || err.message);
      throw err;
    }
    return data;
  }

  function initAuthUi() {
    const saved = loadAuth();
    if (saved.refreshToken) setRefreshTokenValue(saved.refreshToken);
    if (saved.authToken) setAccessTokenValue(saved.authToken);
    forceOriginInput();
    saveAuth();

    el("auth-token")?.addEventListener("input", updateJwtUi);
    el("refresh-token")?.addEventListener("input", updateJwtUi);
    el("btn-refresh-token")?.addEventListener("click", async () => {
      saveAuth();
      try {
        await refreshAccessToken();
      } catch (err) {
        updateJwtUi();
        const warn = el("jwt-warn-inline");
        if (warn) {
          warn.textContent = err.message;
          warn.classList.add("show", "err");
        }
        window.alert(err.message);
      }
    });

    updateJwtUi();
    setInterval(updateJwtUi, 15000);
  }

  global.FavAuth = {
    STORAGE_KEY,
    FIXED_ORIGIN,
    CLIENT_UA,
    FAV_API_BASE,
    ACCOUNT_API_BASE,
    favApiUrl,
    loadAuth,
    saveAuth,
    decodeJwtPayload,
    formatDuration,
    jwtValidity,
    updateJwtUi,
    authHeaders,
    ensureAccessToken,
    refreshAccessToken,
    authReadyForLiveApi,
    fetchWithAuth,
    readJsonResponse,
    formatUpstreamError,
    initAuthUi,
    getOriginValue,
    forceOriginInput,
  };
})(window);
