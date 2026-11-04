/**
 * Official game.js catch-up after a long stall:
 *   cframe_ms = frame_ms; while (cframe_ms > 0) { ...; cframe_ms -= 50; }
 * The historical 2s clamp is commented out ("no need [26/07/16]"). In a browser
 * that rarely matters; in caracAL, DNS/EIO/event-loop stalls push frame_ms to
 * 40–110s (logged as `cframe_ms is N`). The uncapped while then burns the
 * Node event loop and looks like a fleet freeze (stat_beat goes quiet →
 * watchdog softkill). Cosmetics / draw work on the same tick amplify it.
 *
 * Re-enable the clamp (and apply the same cap to mframe_ms) when evaluating
 * game.js. Idempotent if already patched.
 */

const CFRAME_CLAMP_RE =
  /\/\/\s*cframe_ms\s*=\s*min\(\s*2000\s*,\s*cframe_ms\s*\)\s*;[^\n]*/;

const CARACAL_CLAMP_LINE =
  "cframe_ms=min(2000,cframe_ms); mframe_ms=min(2000,mframe_ms); // caracAL: clamp catch-up after stalls (was commented out in official client)";

/**
 * @param {string} source
 * @returns {{ text: string, patched: boolean }}
 */
function patchOfficialGameJs(source) {
  const text = String(source ?? "");
  if (text.includes("caracAL: clamp catch-up after stalls")) {
    return { text, patched: false };
  }
  if (!CFRAME_CLAMP_RE.test(text)) {
    return { text, patched: false };
  }
  return {
    text: text.replace(CFRAME_CLAMP_RE, CARACAL_CLAMP_LINE),
    patched: true,
  };
}

/** True when this path is the official game.js client script. */
function isOfficialGameJsPath(location) {
  const p = String(location ?? "").replace(/\\/g, "/");
  return /\/game\.js$/i.test(p) || /(^|\/)game\.js$/i.test(p);
}

module.exports = {
  patchOfficialGameJs,
  isOfficialGameJsPath,
  CARACAL_CLAMP_LINE,
};
