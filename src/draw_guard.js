/**
 * Adventure Land's draw() re-arms its frame loop (setTimeout(draw, 16) under
 * no_graphics) only at its end: one exception (seen: set_texture after a skin
 * change) left a character on the heartbeat's 15 s frames until a reload.
 * Guarded: a throw re-arms the loop (not for manual draws) and is logged at
 * most once a minute. draw's only code after its re-arm is in a try, so a
 * throw means it didn't re-arm.
 */

"use strict";

const vm = require("vm");

const OVERLAY_SOURCE = `
if (typeof draw === "function") {
  const draw_unguarded = draw;
  let thrown = 0, reported = 0;
  draw = function (arg1, manual_draw) {
    try {
      return draw_unguarded.apply(this, arguments);
    } catch (e) {
      window.in_draw = false;
      if (!manual_draw) setTimeout(draw, 16);
      thrown++;
      if (Date.now() - reported >= 60000) {
        console.error("caracAL: draw() threw " + thrown +
          "x since the last report; the frame loop goes on", e);
        reported = Date.now();
        thrown = 0;
      }
    }
  };
}
//# sourceURL=caracAL://draw_guard.js`;

/** Wrap Adventure Land draw() on a game vm context (a JSDOM window). */
exports.apply_draw_guard = (context) =>
  vm.runInContext(OVERLAY_SOURCE, context);
