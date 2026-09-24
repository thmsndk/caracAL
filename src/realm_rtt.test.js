const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  LOAD_DEADLINE_MIN_MS,
  LOAD_DEADLINE_MAX_MS,
  PROBE_TIMEOUT_MS,
  parseRealmHost,
  loadDeadlineMsFromRtt,
  shouldRefreshClientForWelcome,
} = require("./realm_rtt");

describe("parseRealmHost", () => {
  it("strips wss and path", () => {
    assert.deepEqual(parseRealmHost("wss://asia1.adventure.land/socket.io/"), {
      host: "asia1.adventure.land",
      port: null,
    });
  });

  it("keeps explicit port", () => {
    assert.deepEqual(parseRealmHost("eu1.adventure.land:2053"), {
      host: "eu1.adventure.land",
      port: 2053,
    });
  });
});

describe("loadDeadlineMsFromRtt", () => {
  it("keeps the historical floor for low RTT", () => {
    assert.equal(loadDeadlineMsFromRtt(40), LOAD_DEADLINE_MIN_MS);
    assert.equal(loadDeadlineMsFromRtt(200), LOAD_DEADLINE_MIN_MS);
  });

  it("scales up for high RTT", () => {
    const mid = loadDeadlineMsFromRtt(800);
    assert.ok(mid > LOAD_DEADLINE_MIN_MS);
    assert.ok(mid < LOAD_DEADLINE_MAX_MS);
    assert.equal(mid, 8_000 + 12 * 800);
  });

  it("caps at max", () => {
    assert.equal(loadDeadlineMsFromRtt(10_000), LOAD_DEADLINE_MAX_MS);
    assert.equal(loadDeadlineMsFromRtt(PROBE_TIMEOUT_MS), LOAD_DEADLINE_MAX_MS);
  });
});

describe("shouldRefreshClientForWelcome", () => {
  it("refreshes only when welcome is ahead of local", () => {
    assert.equal(shouldRefreshClientForWelcome(17139, 17175), true);
    assert.equal(shouldRefreshClientForWelcome(17175, 17139), false);
    assert.equal(shouldRefreshClientForWelcome(17175, 17175), false);
  });

  it("ignores non-finite versions", () => {
    assert.equal(shouldRefreshClientForWelcome(NaN, 17175), false);
    assert.equal(shouldRefreshClientForWelcome(17175, NaN), false);
  });
});
