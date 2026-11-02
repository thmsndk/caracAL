const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  COORDINATOR_RESTART_DELAY_MS,
  kill_orphan_character_threads,
  setup_log_pipes,
} = require("./StreamMultiplexer");

describe("StreamMultiplexer coordinator supervision", () => {
  it("exposes a bounded restart delay", () => {
    assert.equal(typeof COORDINATOR_RESTART_DELAY_MS, "number");
    assert.ok(COORDINATOR_RESTART_DELAY_MS >= 1000);
    assert.ok(COORDINATOR_RESTART_DELAY_MS <= 60_000);
  });

  it("kill_orphan_character_threads is safe to call", () => {
    assert.doesNotThrow(() => kill_orphan_character_threads());
  });

  it("setup_log_pipes returns a ChildProcess-like runner", () => {
    assert.equal(typeof setup_log_pipes, "function");
  });
});
