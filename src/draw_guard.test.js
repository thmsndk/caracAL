const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const { JSDOM, VirtualConsole } = require("jsdom");
const { apply_draw_guard } = require("./draw_guard");

// A guarded draw() shaped like Adventure Land's: in_draw while it runs,
// re-armed at its end unless manual; the next `fail` draws throw before the
// re-arm. (jsdomError: where an exception that escapes a timer goes.)
function guarded_game(t) {
  const virtualConsole = new VirtualConsole(),
    uncaught = [],
    errors = [];
  virtualConsole.on("jsdomError", (e) => uncaught.push(e));
  const window = new JSDOM("", { virtualConsole }).window;
  // (its timers too: a loop left running would keep the test from ending)
  t.after(() => window.close());
  vm.createContext(window);
  vm.runInContext(
    `var in_draw = false, draws = 0, fail = 0;
    function draw(arg1, manual_draw) {
      draws++;
      in_draw = true;
      if (fail > 0) {
        fail--;
        throw new TypeError("Cannot read properties of undefined (reading '1')");
      }
      if (!manual_draw) setTimeout(draw, 16);
      in_draw = false;
    }`,
    window,
  );
  window.console = { error: (...args) => errors.push(args) };
  apply_draw_guard(window);
  return { window, errors, uncaught };
}

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

describe("draw_guard", () => {
  it("keeps one frame loop going when draw() throws, reported once a minute", async (t) => {
    const { window, errors, uncaught } = guarded_game(t);
    vm.runInContext("fail = 3; draw()", window);
    await wait(200);
    // (one loop of 16 ms frames: at most 13 in 200 ms)
    assert.ok(window.draws > 4 && window.draws <= 14, `draws ${window.draws}`);
    assert.equal(uncaught.length, 0);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][1]), /reading '1'/);
  });

  it("doesn't start a loop for a manual draw that throws, and clears in_draw", async (t) => {
    const { window, errors } = guarded_game(t);
    vm.runInContext("fail = 1; draw(0, 1)", window);
    assert.equal(window.in_draw, false);
    await wait(100);
    assert.equal(window.draws, 1);
    assert.equal(errors.length, 1);
  });
});
