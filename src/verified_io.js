// The game's page opens its socket with socket.io-client's io(server, { ..., rejectUnauthorized: false }): a browser
// ignores that option and verifies the server's certificate anyway, Node's client honours it and doesn't (the login
// and everything after it over TLS anyone on the way could intercept). The page's io here verifies by default, as a
// browser does. Private HTTPS with a cert Node does not trust (mkcert, self-signed) can set verify_game_cert: false.

/** @param {unknown} err */
function is_tls_cert_error(err) {
  let cur = err;
  for (let i = 0; i < 5 && cur; i++) {
    const msg = String(cur.message || cur.reason || cur || "");
    const code = cur.code;
    if (
      /self-signed|unable to verify|CERT_|UNABLE_TO_VERIFY|SSL routines|certificate/i.test(
        msg,
      )
    ) {
      return true;
    }
    if (
      [
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "CERT_HAS_EXPIRED",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "ERR_TLS_CERT_ALTNAME_INVALID",
      ].includes(code)
    ) {
      return true;
    }
    cur = cur.cause || cur.error;
  }
  return false;
}

/**
 * Actionable hint when HTTPS/WSS cert verification fails (login fetch or game socket).
 * @param {unknown} err
 */
function tls_cert_help_message(err) {
  const detail = err && err.message ? err.message : String(err);
  return [
    `TLS certificate problem: ${detail}`,
    "caracAL verifies HTTPS/WSS certificates by default (like a browser).",
    "For local mkcert: start with `node --use-system-ca main.js …` or set NODE_EXTRA_CA_CERTS to mkcert's rootCA.pem (`mkcert -CAROOT`).",
    "For production private hosts: use Let's Encrypt / ACME so Node trusts the cert automatically.",
    "To allow untrusted certs on a private HTTPS host you trust: set verify_game_cert: false in config (not for adventure.land).",
    "Plain http://localhost (ws://) needs none of the above — TLS never applies.",
  ].join("\n");
}

/**
 * socket.io-client's io, with rejectUnauthorized forced from options.verify (default true).
 * @param {Function} io
 * @param {{ verify?: boolean }} [options]
 */
function verified_io(io, options = {}) {
  const verify = options.verify !== false;
  const v = (uri, opts) =>
    uri !== null && typeof uri === "object"
      ? io({ ...uri, rejectUnauthorized: verify })
      : io(uri, { ...(opts || {}), rejectUnauthorized: verify });
  return Object.assign(v, io, { connect: v });
}

module.exports = { verified_io, is_tls_cert_error, tls_cert_help_message };
