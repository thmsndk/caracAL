/**
 * Realm connect RTT probe + first-load deadline sizing.
 * Game `character.ping` only exists after load — probe the realm host instead.
 */

const net = require("node:net");
const tls = require("node:tls");

/** Floor — matches historical caracAL behaviour for nearby realms. */
const LOAD_DEADLINE_MIN_MS = 14_000;
/** Cap so a dead host still fails and sibling recovery can act. */
const LOAD_DEADLINE_MAX_MS = 60_000;
/** Fixed overhead (auth, assets, new_game_logic) atop RTT. */
const LOAD_DEADLINE_BASE_MS = 8_000;
/** Multiplier on probed RTT (Asia ~200–800ms → modest headroom; multi-second → long). */
const LOAD_DEADLINE_RTT_FACTOR = 12;
/** Give up probing after this — treat as worst-case RTT for deadline math. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Strip ws(s)://, path, and optional :port from a realm address.
 * @param {string} realmHost
 * @returns {{ host: string, port: number | null }}
 */
function parseRealmHost(realmHost) {
  let raw = String(realmHost ?? "").trim();
  if (!raw) return { host: "", port: null };
  raw = raw.replace(/^wss?:\/\//i, "");
  const slash = raw.indexOf("/");
  if (slash >= 0) raw = raw.slice(0, slash);
  let host = raw;
  let port = null;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end >= 0) {
      host = raw.slice(1, end);
      const rest = raw.slice(end + 1);
      if (rest.startsWith(":")) {
        const n = Number(rest.slice(1));
        if (Number.isFinite(n) && n > 0) port = n;
      }
    }
  } else {
    const idx = raw.lastIndexOf(":");
    if (idx > 0 && raw.indexOf(":") === idx) {
      const n = Number(raw.slice(idx + 1));
      if (Number.isFinite(n) && n > 0) {
        host = raw.slice(0, idx);
        port = n;
      }
    }
  }
  return { host, port };
}

/**
 * TCP(/TLS) connect RTT to the realm host. Failures resolve as {@link PROBE_TIMEOUT_MS}
 * so the load deadline still stretches instead of staying at the EU floor.
 * @param {string} host
 * @param {{ port?: number, tls?: boolean, timeoutMs?: number }} [opts]
 * @returns {Promise<number>}
 */
function probeRealmRttMs(host, opts = {}) {
  const port = opts.port ?? 443;
  const useTls = opts.tls !== false;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  if (!host) return Promise.resolve(timeoutMs);

  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    /** @type {import("node:net").Socket | import("node:tls").TLSSocket | null} */
    let socket = null;
    const finish = (ms) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
      }
      resolve(ms);
    };
    const timer = setTimeout(() => finish(timeoutMs), timeoutMs);

    try {
      if (useTls) {
        socket = tls.connect(
          { host, port, servername: host, rejectUnauthorized: true },
          () => finish(Date.now() - started),
        );
      } else {
        socket = net.connect({ host, port }, () => finish(Date.now() - started));
      }
      socket.on("error", () => finish(timeoutMs));
    } catch {
      finish(timeoutMs);
    }
  });
}

/**
 * First-load deadline from probed RTT.
 * @param {number} rttMs
 * @param {{ minMs?: number, maxMs?: number, baseMs?: number, factor?: number }} [opts]
 */
function loadDeadlineMsFromRtt(rttMs, opts = {}) {
  const minMs = opts.minMs ?? LOAD_DEADLINE_MIN_MS;
  const maxMs = opts.maxMs ?? LOAD_DEADLINE_MAX_MS;
  const baseMs = opts.baseMs ?? LOAD_DEADLINE_BASE_MS;
  const factor = opts.factor ?? LOAD_DEADLINE_RTT_FACTOR;
  const rtt = Number.isFinite(rttMs) && rttMs > 0 ? rttMs : PROBE_TIMEOUT_MS;
  return Math.min(maxMs, Math.max(minMs, Math.ceil(baseMs + factor * rtt)));
}

/**
 * Whether welcome.version should trigger a client refresh/redeploy.
 * Only when the server is *ahead* of our cached tree — behind/equal is noise
 * (stale welcome or our cache already newer) and must not thrash mid-connect.
 * @param {number} localVersion
 * @param {number} welcomeVersion
 */
function shouldRefreshClientForWelcome(localVersion, welcomeVersion) {
  if (!Number.isFinite(localVersion) || !Number.isFinite(welcomeVersion)) {
    return false;
  }
  return welcomeVersion > localVersion;
}

module.exports = {
  LOAD_DEADLINE_MIN_MS,
  LOAD_DEADLINE_MAX_MS,
  LOAD_DEADLINE_BASE_MS,
  LOAD_DEADLINE_RTT_FACTOR,
  PROBE_TIMEOUT_MS,
  parseRealmHost,
  probeRealmRttMs,
  loadDeadlineMsFromRtt,
  shouldRefreshClientForWelcome,
};
