const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { apply_realm_safe_clone } = require("./realm_safe_clone");

function makeCaracALStyleContext() {
  const window = new JSDOM("<!doctype html>", {
    url: "https://adventure.land/",
  }).window;
  window.globalThis = window;
  vm.createContext(window);
  // Upstream AL clone (broken under this context).
  vm.runInContext(
    `
    function is_function(f) {
      try {
        var g = {};
        return f && g.toString.call(f) === "[object Function]";
      } catch (e) {}
      return false;
    }
    function clone(obj, args) {
      if (!args) args = {};
      if (!args.seen && args.seen !== []) args.seen = [];
      if (null == obj) return obj;
      if (args.simple_functions && is_function(obj)) return "[clone]:" + obj.toString().substring(0, 40);
      if ("object" != typeof obj) return obj;
      if (obj instanceof Date) {
        var copy = new Date();
        copy.setTime(obj.getTime());
        return copy;
      }
      if (obj instanceof Array) {
        args.seen.push(obj);
        var copy = [];
        for (var i = 0; i < obj.length; i++) copy[i] = clone(obj[i], args);
        return copy;
      }
      if (obj instanceof Object) {
        args.seen.push(obj);
        var copy = {};
        for (var attr in obj) {
          if (obj.hasOwnProperty(attr)) {
            if (args.seen.indexOf(obj[attr]) !== -1) {
              copy[attr] = "circular_attribute[clone]";
              continue;
            }
            copy[attr] = clone(obj[attr], args);
          }
        }
        return copy;
      }
      throw "type not supported";
    }
    `,
    window,
  );
  return window;
}

describe("realm_safe_clone", () => {
  it("upstream clone throws on VM object literals under JSDOM+vm", () => {
    const ctx = makeCaracALStyleContext();
    assert.throws(
      () => vm.runInContext('clone({a:1, nested:{b:[2]}})', ctx),
      (err) => err === "type not supported",
    );
  });

  it("overlay clones VM literals, arrays, dates, and Node JSON", () => {
    const ctx = makeCaracALStyleContext();
    apply_realm_safe_clone(ctx);

    const result = vm.runInContext(
      `
      const lit = clone({ a: 1, nested: { b: [2, 3] } });
      const arr = clone([1, { x: 2 }]);
      const stamped = clone(new Date(0));
      JSON.stringify({
        lit: lit,
        arr: arr,
        stamped: stamped.getTime(),
        flagged: clone.__caracAL_realm_safe === true,
      });
      `,
      ctx,
    );
    assert.deepEqual(JSON.parse(result), {
      lit: { a: 1, nested: { b: [2, 3] } },
      arr: [1, { x: 2 }],
      stamped: 0,
      flagged: true,
    });

    const fromNode = JSON.parse('{"cx":{"hat":"wizardhat"},"n":[1,2]}');
    ctx.payload = fromNode;
    const copiedJson = vm.runInContext("JSON.stringify(clone(payload))", ctx);
    assert.equal(copiedJson, JSON.stringify(fromNode));
    const sameRef = vm.runInContext("clone(payload) === payload", ctx);
    assert.equal(sameRef, false);
  });

  it("overlay preserves circular_attribute marker", () => {
    const ctx = makeCaracALStyleContext();
    apply_realm_safe_clone(ctx);
    const out = vm.runInContext(
      `
      const o = { a: 1 };
      o.self = o;
      const c = clone(o);
      JSON.stringify({ a: c.a, self: c.self });
      `,
      ctx,
    );
    assert.deepEqual(JSON.parse(out), {
      a: 1,
      self: "circular_attribute[clone]",
    });
  });
});
