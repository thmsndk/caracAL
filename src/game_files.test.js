const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { follows_latest_client } = require("./game_files");

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
