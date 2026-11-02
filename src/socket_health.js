/**
 * Detect dead Adventure Land sockets that never flip `connected=false`
 * (e.g. DNS EAI_AGAIN storms): engine.io can sit "connected" with no RX
 * while CODE still heartbeats → coordinator watchdog stays quiet.
 */

/** No inbound socket traffic while connected → redeploy. */
const SOCKET_CONNECTED_NO_RX_MS = 45_000;
/** Classic path: connected went false and stayed down. */
const SOCKET_DOWN_REDEPLOY_MS = 15_000;
/** After first successful connect, this many connect_error in a row → redeploy. */
const CONNECT_ERROR_STREAK_REDEPLOY = 8;

/**
 * @param {{
 *   now: number,
 *   sawConnected: boolean,
 *   sockConnected: boolean,
 *   socketDownSince: number | null,
 *   lastRxAt: number | null,
 *   connectedNoRxMs?: number,
 *   downMs?: number,
 * }} args
 * @returns {{
 *   redeploy: boolean,
 *   reason?: "connected_no_rx" | "socket_down",
 *   clearDownSince?: boolean,
 *   markDownSince?: number,
 * }}
 */
function evaluateSocketHealth(args) {
  const connectedNoRxMs = args.connectedNoRxMs ?? SOCKET_CONNECTED_NO_RX_MS;
  const downMs = args.downMs ?? SOCKET_DOWN_REDEPLOY_MS;
  if (!args.sawConnected) {
    return { redeploy: false };
  }
  if (args.sockConnected) {
    if (
      args.lastRxAt != null &&
      args.now - args.lastRxAt >= connectedNoRxMs
    ) {
      return { redeploy: true, reason: "connected_no_rx" };
    }
    return { redeploy: false, clearDownSince: true };
  }
  if (args.socketDownSince == null) {
    return { redeploy: false, markDownSince: args.now };
  }
  if (args.now - args.socketDownSince >= downMs) {
    return { redeploy: true, reason: "socket_down" };
  }
  return { redeploy: false };
}

/**
 * Only after we once connected — cold boots emit connect_error while dialing.
 * @param {{ sawConnected: boolean, streak: number, threshold?: number }} args
 */
function shouldRedeployForConnectErrorStreak(args) {
  const threshold = args.threshold ?? CONNECT_ERROR_STREAK_REDEPLOY;
  return Boolean(args.sawConnected) && args.streak >= threshold;
}

/**
 * Tap inbound engine.io / socket.io packets. Prefer onAny / onevent; else common AL events.
 * @param {any} sock
 * @param {() => void} onRx
 */
function tapSocketInbound(sock, onRx) {
  if (!sock || sock.__caracalRxTap) return;
  sock.__caracalRxTap = true;
  // engine.io keepalive (PING/PONG) never reaches socket.io onAny — count it
  // so a quiet-but-alive transport does not trip connected_no_rx.
  try {
    const engine = sock.io && sock.io.engine;
    if (engine && typeof engine.on === "function") {
      engine.on("packet", onRx);
    }
  } catch (_) {
    /* ignore */
  }
  if (typeof sock.onAny === "function") {
    sock.onAny(() => {
      onRx();
    });
    return;
  }
  if (typeof sock.onevent === "function") {
    const orig = sock.onevent.bind(sock);
    sock.onevent = function caracalOnevent(packet) {
      onRx();
      return orig(packet);
    };
    return;
  }
  const events = [
    "ping_ack",
    "server_info",
    "entities",
    "player",
    "disappear",
    "new_map",
    "game_response",
    "game_log",
    "welcome",
    "cm",
    "death",
    "hit",
    "game_error",
    "reloaded",
  ];
  for (let i = 0; i < events.length; i++) {
    try {
      sock.on(events[i], onRx);
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = {
  SOCKET_CONNECTED_NO_RX_MS,
  SOCKET_DOWN_REDEPLOY_MS,
  CONNECT_ERROR_STREAK_REDEPLOY,
  evaluateSocketHealth,
  shouldRedeployForConnectErrorStreak,
  tapSocketInbound,
};
