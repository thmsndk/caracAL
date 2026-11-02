const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  COORDINATOR_RESTART_DELAY_MS,
  COORDINATOR_RESTART_DELAY_MAX_MS,
  COORDINATOR_MAX_FAILURES,
  kill_orphan_character_threads,
  is_coordinator_module,
  restart_delay_ms,
  setup_log_pipes,
} = require("./StreamMultiplexer");

describe("StreamMultiplexer coordinator supervision", () => {
  it("exposes a bounded restart delay", () => {
    assert.equal(typeof COORDINATOR_RESTART_DELAY_MS, "number");
    assert.ok(COORDINATOR_RESTART_DELAY_MS >= 1000);
    assert.ok(COORDINATOR_RESTART_DELAY_MS <= 60_000);
    assert.ok(COORDINATOR_RESTART_DELAY_MAX_MS >= COORDINATOR_RESTART_DELAY_MS);
    assert.ok(COORDINATOR_MAX_FAILURES >= 5);
  });

  it("restart_delay_ms backs off then caps", () => {
    assert.equal(restart_delay_ms(1), COORDINATOR_RESTART_DELAY_MS);
    assert.equal(restart_delay_ms(2), COORDINATOR_RESTART_DELAY_MS * 2);
    assert.equal(restart_delay_ms(99), COORDINATOR_RESTART_DELAY_MAX_MS);
  });

  it("detects CharacterCoordinator paths only", () => {
    assert.equal(
      is_coordinator_module("./standalones/CharacterCoordinator.js"),
      true,
    );
    assert.equal(
      is_coordinator_module("standalones\\CharacterCoordinator.js"),
      true,
    );
    assert.equal(
      is_coordinator_module("./node_modules/webpack/bin/webpack"),
      false,
    );
  });

  it("kill_orphan_character_threads is safe to call", async () => {
    await assert.doesNotReject(() => kill_orphan_character_threads());
    await assert.doesNotReject(() => kill_orphan_character_threads(12345));
  });

  it("setup_log_pipes returns a ChildProcess-like runner", () => {
    assert.equal(typeof setup_log_pipes, "function");
  });
});
