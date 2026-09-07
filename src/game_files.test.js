const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  follows_latest_client,
  get_game_files,
  get_runner_files,
  get_game_files_fallback,
  get_runner_files_fallback,
} = require("./game_files");

describe("follows_latest_client", () => {
  it("treats missing and 0 as live latest", () => {
    assert.equal(follows_latest_client(undefined), true);
    assert.equal(follows_latest_client(null), true);
    assert.equal(follows_latest_client(0), true);
    assert.equal(follows_latest_client("0"), true);
    assert.equal(follows_latest_client(""), true);
  });

  it("treats numeric and named folders as pinned", () => {
    assert.equal(follows_latest_client(5158), false);
    assert.equal(follows_latest_client("5158"), false);
    assert.equal(follows_latest_client("halflife3"), false);
  });
});

describe("official client script lists", () => {
  it("fallback loads merrit_stand_notice after html.js", () => {
    const files = get_game_files_fallback();
    const html = files.indexOf("/js/html.js");
    const merrit = files.indexOf("/js/merrit_stand_notice.js");
    assert.ok(html >= 0, "html.js required");
    assert.ok(merrit >= 0, "merrit_stand_notice.js required");
    assert.ok(merrit > html, "merrit_stand_notice.js must load after html.js");
  });

  it("fallback runner scripts match /runner", () => {
    assert.deepEqual(get_runner_files_fallback(), [
      "/js/old_common_functions.js",
      "/js/common_functions.js",
      "/js/runner_functions.js",
      "/js/runner_compat.js",
    ]);
  });

  it("get_game_files without version uses fallback", () => {
    assert.deepEqual(get_game_files(), get_game_files_fallback());
    assert.deepEqual(get_runner_files(), get_runner_files_fallback());
  });
});
