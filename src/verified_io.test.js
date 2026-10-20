const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  verified_io,
  is_tls_cert_error,
  tls_cert_help_message,
} = require("./verified_io");

describe("verified_io", () => {
  it("every socket verifies the server's certificate, whatever the page asks (its other options kept); io's properties kept", () => {
    const calls = [];
    const io = (...a) => (calls.push(a), "socket");
    io.Manager = function Manager() {};
    io.protocol = 5;
    const v = verified_io(io);
    assert.equal(
      v("https://de.adventure.land", {
        path: "/ws6/",
        transports: ["websocket"],
        rejectUnauthorized: false,
      }),
      "socket",
    );
    v.connect("https://x", undefined);
    v({ path: "/p" });
    assert.deepEqual(calls, [
      [
        "https://de.adventure.land",
        {
          path: "/ws6/",
          transports: ["websocket"],
          rejectUnauthorized: true,
        },
      ],
      ["https://x", { rejectUnauthorized: true }],
      [{ path: "/p", rejectUnauthorized: true }],
    ]);
    assert.equal(v.Manager, io.Manager);
    assert.equal(v.protocol, 5);
  });

  it("verify: false forces rejectUnauthorized false for private/self-signed HTTPS", () => {
    const calls = [];
    const io = (...a) => (calls.push(a), "socket");
    const v = verified_io(io, { verify: false });
    v("wss://gs.al.local", {
      path: "/socket.io/",
      rejectUnauthorized: true,
    });
    v({ path: "/p", rejectUnauthorized: true });
    assert.deepEqual(calls, [
      [
        "wss://gs.al.local",
        { path: "/socket.io/", rejectUnauthorized: false },
      ],
      [{ path: "/p", rejectUnauthorized: false }],
    ]);
  });

  it("is_tls_cert_error matches nested socket.io / OpenSSL failures", () => {
    assert.equal(is_tls_cert_error(new Error("self-signed certificate")), true);
    assert.equal(
      is_tls_cert_error({
        message: "websocket error",
        cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT", message: "self signed" },
      }),
      true,
    );
    assert.equal(is_tls_cert_error(new Error("ECONNREFUSED")), false);
  });

  it("tls_cert_help_message mentions mkcert, ACME, and verify_game_cert", () => {
    const msg = tls_cert_help_message(new Error("unable to verify the first certificate"));
    assert.match(msg, /NODE_EXTRA_CA_CERTS|--use-system-ca/);
    assert.match(msg, /verify_game_cert/);
    assert.match(msg, /ACME|Let's Encrypt/);
  });
});
