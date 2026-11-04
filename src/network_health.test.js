const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isDnsLikeError,
  noteAccountFetchOk,
  noteAccountFetchFail,
  isAccountDnsOutage,
  _resetNetworkHealthForTests,
  _noteFailAtForTests,
} = require("./network_health");

describe("network_health", () => {
  it("detects EAI_AGAIN shaped errors", () => {
    assert.equal(isDnsLikeError({ code: "EAI_AGAIN", message: "getaddrinfo" }), true);
    assert.equal(
      isDnsLikeError({ message: "request failed, reason: getaddrinfo EAI_AGAIN adventure.land" }),
      true,
    );
    assert.equal(isDnsLikeError({ code: "ETIMEDOUT", message: "timeout" }), false);
  });

  it("flags outage after DNS fails without recovery", () => {
    const t0 = 1_000_000;
    _resetNetworkHealthForTests(t0);
    noteAccountFetchFail({ code: "EAI_AGAIN", message: "getaddrinfo EAI_AGAIN" });
    assert.equal(isAccountDnsOutage(t0 + 25_000), true);
    noteAccountFetchOk();
    assert.equal(isAccountDnsOutage(t0 + 30_000), false);
  });

  it("clears after failGrace", () => {
    const t0 = 2_000_000;
    _resetNetworkHealthForTests(t0);
    _noteFailAtForTests(t0 + 1_000, "EAI_AGAIN");
    assert.equal(isAccountDnsOutage(t0 + 200_000, { failGraceMs: 180_000 }), false);
  });
});
