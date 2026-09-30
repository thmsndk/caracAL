const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");

describe("html_prelude", () => {
  it("defines proximity_guides before html.js render_server runs", () => {
    const prelude = fs.readFileSync("./src/html_prelude.js", "utf8");
    const context = { globalThis: {} };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(prelude, context);
    assert.equal("proximity_guides" in context, true);
    assert.equal(context.proximity_guides, false);
  });
});
