const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { safeSendCodeMessage } = require("./safe_send_cm");

describe("safeSendCodeMessage", () => {
  it("returns false when socket is null (no throw)", () => {
    assert.equal(safeSendCodeMessage(null, ["x"], {}), false);
  });

  it("returns false when emit is missing", () => {
    assert.equal(safeSendCodeMessage({}, ["x"], {}), false);
  });

  it("emits when socket is live", () => {
    const calls = [];
    const socket = {
      emit(event, payload) {
        calls.push({ event, payload });
      },
    };
    assert.equal(safeSendCodeMessage(socket, ["Ahnaki"], { hi: 1 }), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event, "cm");
    assert.equal(calls[0].payload.to[0], "Ahnaki");
  });

  it("swallows emit throws", () => {
    const socket = {
      emit() {
        throw new TypeError("Cannot read properties of null (reading 'emit')");
      },
    };
    assert.equal(safeSendCodeMessage(socket, ["x"], {}), false);
  });
});
