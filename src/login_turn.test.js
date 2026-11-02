const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * Lightweight queue semantics matching CharacterCoordinator login_turn_* helpers.
 * Kept local so we can unit-test without forking the full coordinator.
 */
function makeLoginTurn(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const sent = [];
  const login_turn = { holder: null, queue: [] };

  function safe_send(proc, data) {
    sent.push({ proc, data });
  }

  function login_turn_grant_next() {
    if (login_turn.holder) return;
    const next = login_turn.queue.shift();
    if (!next) return;
    const holder = { ...next, granted_at: Date.now() };
    holder.timer = setTimeout(() => {
      login_turn_release(holder.proc, "timeout");
    }, timeoutMs);
    login_turn.holder = holder;
    safe_send(holder.proc, { type: "login_turn_grant" });
  }

  function login_turn_request(char_name, proc) {
    const holds = login_turn.holder && login_turn.holder.proc === proc;
    if (holds || login_turn.queue.some((x) => x.proc === proc)) return;
    login_turn.queue.push({ char_name, proc });
    login_turn_grant_next();
  }

  function login_turn_release(proc, reason) {
    const holder = login_turn.holder;
    if (!holder || holder.proc !== proc) return;
    clearTimeout(holder.timer);
    login_turn.holder = null;
    login_turn_grant_next();
    return reason;
  }

  function login_turn_dequeue(proc) {
    login_turn.queue = login_turn.queue.filter((x) => x.proc !== proc);
  }

  return {
    login_turn,
    sent,
    login_turn_request,
    login_turn_release,
    login_turn_dequeue,
  };
}

describe("login_turn queue", () => {
  it("grants the first request immediately and queues the second", () => {
    const q = makeLoginTurn();
    q.login_turn_request("A", "procA");
    q.login_turn_request("B", "procB");
    assert.equal(q.login_turn.holder.char_name, "A");
    assert.deepEqual(
      q.login_turn.queue.map((x) => x.char_name),
      ["B"],
    );
    assert.equal(q.sent[0].data.type, "login_turn_grant");
  });

  it("promotes the next waiter on release", () => {
    const q = makeLoginTurn();
    q.login_turn_request("A", "procA");
    q.login_turn_request("B", "procB");
    q.login_turn_release("procA", "released");
    assert.equal(q.login_turn.holder.char_name, "B");
    assert.equal(q.login_turn.queue.length, 0);
  });

  it("ignores duplicate requests from the same proc", () => {
    const q = makeLoginTurn();
    q.login_turn_request("A", "procA");
    q.login_turn_request("A", "procA");
    assert.equal(q.login_turn.queue.length, 0);
  });

  it("dequeue drops a waiter without releasing the holder", () => {
    const q = makeLoginTurn();
    q.login_turn_request("A", "procA");
    q.login_turn_request("B", "procB");
    q.login_turn_dequeue("procB");
    assert.equal(q.login_turn.holder.char_name, "A");
    assert.equal(q.login_turn.queue.length, 0);
  });
});
