const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");
const { extractPageGlobals } = require("./html_globals");

const FIXTURE = `
<html><body>
<script>
	var inside="login";
	var proximity_guides='1';
	var last_deploy="[30/08/26]";
	var X={};
	function payment_logic(){};
	if(is_electron) { electron_init(); }
</script>
</body></html>
`;

describe("extractPageGlobals", () => {
  it("extracts var/function declarations and stops before page logic", () => {
    const script = extractPageGlobals(FIXTURE);
    assert.match(script, /var inside="login"/);
    assert.match(script, /proximity_guides/);
    assert.match(script, /function payment_logic/);
    assert.doesNotMatch(script, /is_electron/);
  });

  it("defines globals when evaluated in a VM context", () => {
    const script = extractPageGlobals(FIXTURE);
    const context = { globalThis: {}, window: {} };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);
    vm.runInContext(script, context);
    assert.equal(context.proximity_guides, "1");
    assert.equal(context.last_deploy, "[30/08/26]");
  });

  it("extracts proximity_guides from a cached official html_globals file if present", () => {
    const samples = fs
      .readdirSync("./game_files", { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((hostDir) => {
        const hostPath = `./game_files/${hostDir.name}`;
        return fs
          .readdirSync(hostPath, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
          .map((verDir) => `${hostPath}/${verDir.name}/html_globals.js`);
      });
    const path = samples.find((p) => fs.existsSync(p));
    if (!path) return;
    const script = fs.readFileSync(path, "utf8");
    assert.match(script, /proximity_guides/);
  });
});
