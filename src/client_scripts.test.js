const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractScriptSrcs,
  resolveGameFilesFromIndexHtml,
  resolveRunnerFilesFromRunnerHtml,
} = require("./client_scripts");

const INDEX_FIXTURE = `
<script src="/js/pixi/4.8.2-roundpixels/pixi.min.js"></script>
<script src="/js/pixi-layers/0.1.7.2/pixi-layers.js"></script>
<script src="/js/socket.io/4.2.0/socket.io.min.js"></script>
<script src="/js/jquery/jquery-3.2.0.min.js"></script>
<script src="/js/howler/2.0.13/howler.min.js"></script>
<script src="/js/libraries/combined.js?v=4"></script>
<script src="/js/codemirror/5.65.1/codemirror.js"></script>
<script src="/js/common_functions.js?v=8507"></script>
<script src="/js/old_common_functions.js?v=8507"></script>
<script src="/js/functions.js?v=8507"></script>
<script src="/js/game.js?v=8507"></script>
<script src="/js/html.js?v=8507"></script>
<script src="/js/merrit_stand_notice.js?v=8507"></script>
<script src="/js/steam_news.js?v=8507"></script>
<script src="/js/payments.js?v=8507"></script>
<script src="/js/keyboard.js?v=8507"></script>
<script src="/data.js?v=8507"></script>
<script src="/js/npc_obstruction_hint.js?v=8507"></script>
<script src="/js/ios-drag-drop.js"></script>
`;

const RUNNER_FIXTURE = `
<script src="/js/jquery/jquery-3.2.0.min.js"></script>
<script src="/js/common_functions.js?v=8507"></script>
<script src="/js/old_common_functions.js?v=8507"></script>
<script src="/js/runner_functions.js?v=8507"></script>
<script src="/js/runner_compat.js?v=8507"></script>
`;

describe("client_scripts", () => {
  it("strips query strings from script srcs", () => {
    assert.deepEqual(extractScriptSrcs('<script src="/js/game.js?v=9"></script>'), [
      "/js/game.js",
    ]);
  });

  it("rewrites vendors and keeps new first-party scripts from the index", () => {
    const files = resolveGameFilesFromIndexHtml(INDEX_FIXTURE);
    assert.equal(files[0], "/js/pixi/fake/pixi.min.js");
    assert.ok(files.includes("/js/libraries/combined.js"));
    assert.ok(files.includes("/js/codemirror/fake/codemirror.js"));
    assert.ok(files.includes("/js/merrit_stand_notice.js"));
    assert.ok(files.includes("/js/steam_news.js"));
    assert.ok(files.includes("/js/npc_obstruction_hint.js"));
    assert.ok(files.includes("/data.js"));
    assert.ok(!files.includes("/js/howler/2.0.13/howler.min.js"));
    assert.ok(!files.includes("/js/ios-drag-drop.js"));
    assert.ok(!files.some((f) => f.includes("socket.io")));
    assert.ok(files.indexOf("/js/html.js") < files.indexOf("/js/merrit_stand_notice.js"));
  });

  it("resolves runner scripts without jquery", () => {
    assert.deepEqual(resolveRunnerFilesFromRunnerHtml(RUNNER_FIXTURE), [
      "/js/common_functions.js",
      "/js/old_common_functions.js",
      "/js/runner_functions.js",
      "/js/runner_compat.js",
    ]);
  });
});
