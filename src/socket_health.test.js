const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateSocketHealth,
  shouldRedeployForConnectErrorStreak,
  SOCKET_CONNECTED_NO_RX_MS,
  SOCKET_DOWN_REDEPLOY_MS,
  CONNECT_ERROR_STREAK_REDEPLOY,
} = require("./socket_health");

describe("socket_health", () => {
  it("ignores pre-connect silence", () => {
    assert.deepEqual(
      evaluateSocketHealth({
        now: 100_000,
        sawConnected: false,
        sockConnected: false,
        socketDownSince: null,
        lastRxAt: null,
      }),
      { redeploy: false },
    );
  });

  it("redeploys when connected but no RX (DNS zombie)", () => {
    const now = 200_000;
    assert.deepEqual(
      evaluateSocketHealth({
        now,
        sawConnected: true,
        sockConnected: true,
        socketDownSince: null,
        lastRxAt: now - SOCKET_CONNECTED_NO_RX_MS,
      }),
      { redeploy: true, reason: "connected_no_rx" },
    );
  });

  it("stays quiet when connected and RX is fresh", () => {
    const now = 200_000;
    assert.deepEqual(
      evaluateSocketHealth({
        now,
        sawConnected: true,
        sockConnected: true,
        socketDownSince: 1,
        lastRxAt: now - 1_000,
      }),
      { redeploy: false, clearDownSince: true },
    );
  });

  it("marks down-since then redeploys after socket_down window", () => {
    assert.deepEqual(
      evaluateSocketHealth({
        now: 50_000,
        sawConnected: true,
        sockConnected: false,
        socketDownSince: null,
        lastRxAt: 40_000,
      }),
      { redeploy: false, markDownSince: 50_000 },
    );

    assert.deepEqual(
      evaluateSocketHealth({
        now: 50_000 + SOCKET_DOWN_REDEPLOY_MS,
        sawConnected: true,
        sockConnected: false,
        socketDownSince: 50_000,
        lastRxAt: 40_000,
      }),
      { redeploy: true, reason: "socket_down" },
    );
  });

  it("connect_error streak only after first connect", () => {
    assert.equal(
      shouldRedeployForConnectErrorStreak({
        sawConnected: false,
        streak: CONNECT_ERROR_STREAK_REDEPLOY,
      }),
      false,
    );
    assert.equal(
      shouldRedeployForConnectErrorStreak({
        sawConnected: true,
        streak: CONNECT_ERROR_STREAK_REDEPLOY - 1,
      }),
      false,
    );
    assert.equal(
      shouldRedeployForConnectErrorStreak({
        sawConnected: true,
        streak: CONNECT_ERROR_STREAK_REDEPLOY,
      }),
      true,
    );
  });
});
