/**
 * Track adventure.land API reachability so the coordinator can pause
 * softkill storms during DNS outages (EAI_AGAIN). Live: fleet went silent,
 * watchdog redeployed every char, Hard-terminate raced null sockets.
 */

let lastOkAt = Date.now();
let lastFailAt = 0;
let lastFailCode = "";

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isDnsLikeError(err) {
  if (!err) return false;
  const code = String(
    (err && err.code) ||
      (err.cause && err.cause.code) ||
      (err.erroredSysCall && err.code) ||
      "",
  );
  const msg = String(
    (err && err.message) || err.reason || err || "",
  );
  if (code === "EAI_AGAIN" || code === "ENOTFOUND" || code === "ECONNREFUSED") {
    return true;
  }
  return /EAI_AGAIN|ENOTFOUND|getaddrinfo|ENETUNREACH/i.test(msg);
}

function noteAccountFetchOk() {
  lastOkAt = Date.now();
  lastFailCode = "";
}

/**
 * @param {unknown} err
 */
function noteAccountFetchFail(err) {
  lastFailAt = Date.now();
  lastFailCode = String(
    (err && err.code) ||
      (err && err.cause && err.cause.code) ||
      (isDnsLikeError(err) ? "EAI_AGAIN" : "ERR"),
  );
}

/**
 * True when recent account API failures look like DNS/network and we have not
 * recovered — watchdog should not softkill (chars cannot reconnect anyway).
 * @param {number} [now]
 * @param {{ failGraceMs?: number, minFailAgeMs?: number }} [opts]
 */
function isAccountDnsOutage(now = Date.now(), opts = {}) {
  const failGraceMs = opts.failGraceMs ?? 180_000;
  const minFailAgeMs = opts.minFailAgeMs ?? 20_000;
  if (!(lastFailAt > lastOkAt)) return false;
  if (now - lastFailAt > failGraceMs) return false;
  if (now - lastOkAt < minFailAgeMs) return false;
  return (
    lastFailCode === "EAI_AGAIN" ||
    lastFailCode === "ENOTFOUND" ||
    lastFailCode === "ENETUNREACH" ||
    lastFailCode === "ECONNREFUSED"
  );
}

/** Test seam */
function _resetNetworkHealthForTests(now = Date.now()) {
  lastOkAt = now;
  lastFailAt = 0;
  lastFailCode = "";
}

/** Test seam — stamp a DNS fail at an absolute time. */
function _noteFailAtForTests(atMs, code = "EAI_AGAIN") {
  lastFailAt = atMs;
  lastFailCode = code;
}

/** Test seam */
function _snapshotNetworkHealthForTests() {
  return { lastOkAt, lastFailAt, lastFailCode };
}

module.exports = {
  isDnsLikeError,
  noteAccountFetchOk,
  noteAccountFetchFail,
  isAccountDnsOutage,
  _resetNetworkHealthForTests,
  _noteFailAtForTests,
  _snapshotNetworkHealthForTests,
};
