const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  patchOfficialGameJs,
  isOfficialGameJsPath,
  CARACAL_CLAMP_LINE,
} = require("./patch_official_game_js");

const SNIPPET = `
	var cframe_ms = frame_ms,
		mframe_ms = frame_ms;
	// cframe_ms=min(2000,cframe_ms); // so the game won't freeze after a lengthy sleep - no need [26/07/16]
	if (cframe_ms > ((Dev && 200) || 10000)) console.log("cframe_ms is " + cframe_ms);
	while (cframe_ms > 0) {
`;

describe("patchOfficialGameJs", () => {
  it("re-enables the 2s clamp and caps mframe", () => {
    const { text, patched } = patchOfficialGameJs(SNIPPET);
    assert.equal(patched, true);
    assert.match(text, /cframe_ms=min\(2000,cframe_ms\)/);
    assert.match(text, /mframe_ms=min\(2000,mframe_ms\)/);
    assert.ok(text.includes("caracAL: clamp catch-up"));
    assert.ok(!text.includes("// cframe_ms=min(2000"));
  });

  it("is idempotent", () => {
    const once = patchOfficialGameJs(SNIPPET).text;
    const twice = patchOfficialGameJs(once);
    assert.equal(twice.patched, false);
    assert.equal(twice.text, once);
    assert.ok(twice.text.includes(CARACAL_CLAMP_LINE));
  });

  it("leaves unrelated sources alone", () => {
    const src = "var x = 1;";
    assert.deepEqual(patchOfficialGameJs(src), { text: src, patched: false });
  });
});

describe("isOfficialGameJsPath", () => {
  it("matches cached game.js paths", () => {
    assert.equal(
      isOfficialGameJsPath("./game_files/adventure.land/18285/game.js"),
      true,
    );
    assert.equal(isOfficialGameJsPath("C:\\\\x\\\\game.js"), true);
    assert.equal(isOfficialGameJsPath("./game_files/x/functions.js"), false);
  });
});
