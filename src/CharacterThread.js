const vm = require("vm");
const LogUtils = require("./LogUtils");
const { console } = LogUtils;
let nodeCanvasModule = null;
try {
  nodeCanvasModule = require("canvas");
} catch (err) {
  // Optional: minimap/BWI drawing only. Missing native canvas.node must not block bots.
  console.warn("canvas unavailable; continuing without nodeCanvas:", err && err.message);
  nodeCanvasModule = {
    createCanvas() {
      throw new Error("node-canvas native addon missing");
    },
  };
}
const io = require("socket.io-client");
const fs = require("fs").promises;
const { JSDOM } = require("jsdom");
const node_query = require("jquery");
const game_files = require("./game_files");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const monitoring_util = require("./monitoring_util");
const ipc_storage = require("./ipcStorage");
const {
  parseRealmHost,
  probeRealmRttMs,
  loadDeadlineMsFromRtt,
  shouldRefreshClientForWelcome,
} = require("./realm_rtt");
const { apply_realm_safe_clone } = require("./realm_safe_clone");

process.on("unhandledRejection", function (exception) {
  console.warn("promise rejected: \n", exception);
});

const html_spoof = `<!DOCTYPE html>
<html>
<head>
<title>Adventure Land</title>
</head>
<body>
</body>
</html>`;

function make_context(upper = null, base_url) {
  const result = new JSDOM(html_spoof, { url: base_url }).window;
  //jsdom maked globalThis point to Node global
  //but we want it to be window instead
  result.globalThis = result;
  result.fetch = fetch;
  result.$ = result.jQuery = node_query(result);
  result.require = require;
  result.Buffer = Buffer;
  result.process = process;
  if (globalThis.FormData) result.FormData = globalThis.FormData;
  if (globalThis.Blob) result.Blob = globalThis.Blob;
  result.console = console;
  if (upper) {
    Object.defineProperty(result, "parent", { value: upper });
    result._localStorage = upper._localStorage;
    result._sessionStorage = upper._sessionStorage;
    const upperCaracAL = upper.caracAL;
    if (upperCaracAL?.nodeCanvas) {
      result.__nodeCanvas = upperCaracAL.nodeCanvas;
    }
  } else {
    result._localStorage = ipc_storage.make_IPC_storage("ls");
    result._sessionStorage = ipc_storage.make_IPC_storage("ss");
  }
  vm.createContext(result);

  result.eval = function (arg) {
    return vm.runInContext(arg, result);
  };

  return result;
}

async function ev_files(locations, context) {
  for (let location of locations) {
    let text = await fs.readFile(location, "utf8");
    vm.runInContext(text + "\n//# sourceURL=file://" + location, context);
  }
}

async function make_runner(upper, CODE_file, proc_args, is_typescript) {
  const runner_sources = game_files
    .get_runner_files(proc_args.base_url, proc_args.version)
    .map((f) =>
      game_files.locate_game_file(proc_args.base_url, f, proc_args.version),
    );
  console.log("constructing runner instance");
  console.debug("source files:\n%s", runner_sources);
  const runner_context = make_context(upper, proc_args.base_url);
  //contents of adventure.land/runner
  //its an html file but not labeled as such
  //TODO in the future i should consider parsing the relevant parts out of the html files directly
  //for the runners as well as the instances
  vm.runInContext(
    `
    var active=false,catch_errors=true,is_code=1,is_server=0,is_game=0,is_bot=parent.is_bot,is_cli=parent.is_cli,is_sdk=parent.is_sdk;
    var Place='game';
    var transporting=false;var Dev='';
    var Local='';
    `,
    runner_context,
  );

  vm.runInContext(
    `
  (function() {
    const originalDefine = Object.defineProperty;

    Object.defineProperty = function(obj, prop, descriptor) {
      if (
        obj === String.prototype &&
        prop === "hashCode" &&
        Object.prototype.hasOwnProperty.call(String.prototype, "hashCode")
      ) {
        return obj;
      }
      return originalDefine(obj, prop, descriptor);
    };
  })();
`,
    runner_context,
  );
  await ev_files(runner_sources, runner_context);
  // JSDOM+vm breaks AL clone()'s instanceof checks — see docs/jsdom-vm-realm-clone.md
  apply_realm_safe_clone(runner_context);
  runner_context.send_cm = function (to, data) {
    process.send({
      type: "cm",
      to,
      data,
    });
  };
  //we need to do this here because of scoping
  upper.caracAL.load_scripts = async function (locations) {
    if (!is_typescript) {
      return await ev_files(
        locations.map((x) => "./CODE/" + x),
        runner_context,
      );
    } else {
      throw new Exception(
        "Runtime Loading Code is not supported in Typescript Mode.\nUse an import instead",
      );
    }
  };
  vm.runInContext(
    "active = true;parent.code_active = true;set_message('Code Active');if (character.rip) character.trigger('death', {past: true});",
    runner_context,
  );

  process.on("message", (m) => {
    switch (m.type) {
      case "closing_client":
        console.log("terminating self");
        vm.runInContext("on_destroy()", runner_context);
        process.exit();
        //vscode says this is unreachable.
        //with how whack node is better be safe
        break;
    }
  });

  //so.
  //these should send a shutdown to parent
  //parent deletes instance and marks them inactive
  //if its duplicate then no instance and no double shutdown
  ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) =>
    process.on(signal, async () => {
      console.log(`Received ${signal} on client. Requesting termination`);
      process.send({
        type: "shutdown",
      });
    }),
  );

  //awaits the arrival of a message from parent process
  //indicating the servers_and_characters proxy that we use
  const connected_signoff = new Promise((resolve) => {
    process.on("message", (m) => {
      switch (m.type) {
        case "siblings_and_acc":
          resolve();
          break;
      }
    });
  });

  process.send({ type: "connected" });

  console.log("runner instance constructed");
  monitoring_util.register_stat_beat(upper);
  //Fix a bug where parent.X is initially empty
  await connected_signoff;
  await ev_files([CODE_file], runner_context);
  //TODO put a process end handler here

  return runner_context;
}

async function make_game(proc_args) {
  await game_files.ensure_html_globals(proc_args.base_url, proc_args.version);
  const game_sources = [
    game_files.resolve_html_globals_source(
      proc_args.base_url,
      proc_args.version,
    ),
  ]
    .concat(
      game_files
        .get_game_files(proc_args.base_url, proc_args.version)
        .map((f) =>
          game_files.locate_game_file(proc_args.base_url, f, proc_args.version),
        ),
    )
    .concat(["./src/html_vars.js"]);
  console.log("constructing game instance");
  console.debug("source files:\n%s", game_sources);
  const game_context = make_context(null, proc_args.base_url);
  game_context.io = io;
  game_context.bowser = {};
  await ev_files(game_sources, game_context);
  // JSDOM+vm breaks AL clone()'s instanceof checks — see docs/jsdom-vm-realm-clone.md
  apply_realm_safe_clone(game_context);
  game_context.VERSION = "" + game_context.G.version;
  game_context.Local = "";
  game_context.Dev = "";
  game_context.Place = "code";
  const realmHost = proc_args.realm_address ?? proc_args.realm_addr;
  // Browser uses bare host with location.protocol; Node/JSDOM socket.io needs an absolute ws(s) URL.
  // Always forcing wss:// breaks local HTTP gameservers.
  if (!realmHost) {
    throw new Error(
      "realm address missing from servers_and_characters (expected address/addr)",
    );
  }
  if (/^wss?:\/\//i.test(realmHost)) {
    game_context.server_address = realmHost;
  } else if ((proc_args.base_url || "").startsWith("http://")) {
    game_context.server_address = "ws://" + realmHost;
  } else {
    game_context.server_address = "wss://" + realmHost;
  }
  // Empty path must still fall back — `??` alone treats "" as intentional.
  game_context.server_path = proc_args.realm_path || "/socket.io/";
  if (proc_args.realm_port) {
    game_context.server_port = proc_args.realm_port;
  }
  game_context.user_id = proc_args.sess.split("-")[0];
  game_context.user_auth = proc_args.sess.split("-")[1];
  game_context.character_to_load = proc_args.cid;

  //expose the block under parent.caracAL
  const extensions = {};

  extensions.log = LogUtils.log;

  extensions.deploy = function (char_name, realm, script_file, game_version) {
    process.send({
      type: "deploy",
      ...(char_name && { character: char_name }),
      ...(realm && { realm }),
      ...(script_file && { script: script_file }),
      ...(game_version && { version: game_version }),
    });
  };
  extensions.shutdown = function (char_name) {
    process.send({
      type: "shutdown",
      character: char_name,
    });
  };
  extensions.map_enabled = function () {
    return proc_args.enable_map;
  };
  extensions.nodeCanvas = nodeCanvasModule;
  extensions.fetchUrlBytes = async function (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
  game_context.nodeCanvas = nodeCanvasModule;

  game_context.caracAL = extensions;

  /** Cleared in new_game_logic once the character is fully in-game. */
  let reload_task = null;
  /** Auth / ingame rejects must not spam 15s redeploys — coordinator owns backoff. */
  let auth_fail_handled = false;

  function clear_first_load_reload() {
    if (reload_task != null) {
      clearTimeout(reload_task);
      reload_task = null;
    }
  }

  function schedule_auth_fail_backoff(reason) {
    if (auth_fail_handled) {
      return;
    }
    auth_fail_handled = true;
    clear_first_load_reload();
    console.warn(
      `auth/login rejected (${reason}) — cancel first-load reload; coordinator will backoff`,
    );
    try {
      process.send({ type: "auth_fail", reason: String(reason || "unknown") });
    } catch (_) {}
  }

  function is_auth_reject_payload(data) {
    if (data == null) {
      return false;
    }
    if (typeof data === "string") {
      const s = data.toLowerCase();
      return (
        s.includes("authentication_failed") ||
        s.includes("characters_unconfirmed") ||
        s.includes("failed: password_issue") ||
        s.includes("failed: ingame") ||
        s.includes("wrong passphrase") ||
        s.includes("authorization_in_progress") ||
        s.includes("authorization in progress")
      );
    }
    if (typeof data === "object") {
      const phrase = typeof data.phrase === "string" ? data.phrase : "";
      const message =
        typeof data.message === "string"
          ? data.message
          : typeof data.reason === "string"
            ? data.reason
            : "";
      return is_auth_reject_payload(phrase) || is_auth_reject_payload(message);
    }
    return false;
  }

  const parsedRealm = parseRealmHost(realmHost);
  const probePort =
    proc_args.realm_port ||
    parsedRealm.port ||
    ((proc_args.base_url || "").startsWith("http://") ? 80 : 443);
  const probeTls = !(proc_args.base_url || "").startsWith("http://");
  const rttMs = await probeRealmRttMs(parsedRealm.host, {
    port: probePort,
    tls: probeTls,
  });
  const reload_timeout_ms = loadDeadlineMsFromRtt(rttMs);
  console.log(
    `realm RTT probe ${parsedRealm.host}:${probePort} ≈${rttMs}ms → load deadline ${Math.round(reload_timeout_ms / 1000)}s`,
  );

  const old_ng_logic = game_context.new_game_logic;
  game_context.new_game_logic = function () {
    old_ng_logic();
    clear_first_load_reload();
    //people reported bad performance when switching maps
    //and this allegedly fixes it.
    vm.runInContext("pause()", game_context);

    const is_typescript =
      proc_args.typescript_file && proc_args.typescript_file.length > 0;
    const target_script = is_typescript
      ? "./TYPECODE.out/" + proc_args.typescript_file
      : "./CODE/" + proc_args.script_file;
    (async function () {
      const runner_context = await make_runner(
        game_context,
        target_script,
        proc_args,
        is_typescript,
      );
      extensions.runner = runner_context;
    })();
  };
  const old_dc = game_context.disconnect;
  game_context.disconnect = function () {
    try {
      old_dc();
    } catch (e) {
      console.error("disconnect() error", e);
    }
    // AL auto_reload uses location.href / CLI kill — neither restarts caracAL.
    // Always ask the coordinator to softkill+respawn this client.
    extensions.deploy();
  };

  async function api_call_with_auth_cookie(method, args, r_args) {
    const session = `${game_context.user_id}-${game_context.user_auth}`;

    const url = `${game_context.location.origin}/api/${method}`;
    console.log("api_call", method, url, session);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Cookie: "auth=" + session,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(args ?? {}),
    });

    const json = await response.json();

    game_context.handle_information(json);
  }

  const old_api = game_context.api_call;
  game_context.api_call = function (method, args, r_args) {
    //servers and characters are handled centrally
    if (method != "servers_and_characters") {
      return api_call_with_auth_cookie(method, args, r_args);
      // return old_api(method, args, r_args);
    } else {
      console.debug("filtered s&c call", method, args, r_args);
    }
  };
  game_context.get_code_function = function (f_name) {
    return (extensions.runner && extensions.runner[f_name]) || function () {};
  };
  //call_code_function("trigger_character_event","cm",{name:data.name,message:JSON.parse(data.message)});

  vm.runInContext(
    `
  (function() {
    const old_add_log = add_log; 
    add_log = function(msg, col) {
      old_add_log(msg,col);
      for(let [msg, col] of game_logs) {
        caracAL.log.info({col:col, type:"game_logs"}, msg);
        try {
          if (typeof msg === "string" && (
            msg.indexOf("authentication_failed") !== -1 ||
            msg.indexOf("characters_unconfirmed") !== -1 ||
            msg.indexOf("authorization_in_progress") !== -1 ||
            msg.indexOf("Authorization in progress") !== -1 ||
            msg.indexOf("Wrong passphrase") !== -1
          )) {
            caracAL._onAuthReject && caracAL._onAuthReject(msg);
          }
        } catch (e) {}
      }
      game_logs = [];
    }
  })();
  `,
    game_context,
  );
  extensions._onAuthReject = schedule_auth_fail_backoff;
  //show_json causes a popup so it must be important
  //therefore we use warn level here
  vm.runInContext(
    'show_json = function(json) {caracAL.log.warn({data:json, type:"AL", func:"show_json"});}',
    game_context,
  );
  process.send({ type: "initialized" });
  process.on("message", (m) => {
    switch (m.type) {
      case "siblings_and_acc":
        extensions.siblings = m.siblings;
        game_context.handle_information([m.account]);
        break;
      case "receive_cm":
        game_context.call_code_function("trigger_character_event", "cm", {
          name: m.name,
          message: m.data,
          caracAL: true,
        });
        break;
      case "send_cm":
        game_context.send_code_message(m.to, m.data);
        break;
    }
  });
  vm.runInContext("the_game()", game_context);
  reload_task = setTimeout(
    function () {
      if (auth_fail_handled) {
        return;
      }
      console.warn(
        `game not loaded after ${Math.round(reload_timeout_ms / 1000)}s (rtt≈${rttMs}ms), reloading`,
      );
      extensions.deploy();
    },
    reload_timeout_ms + 100,
  );
  console.log("game instance constructed");

  game_context.socket.on("connect_error", (err) => {
    console.error(`connect_error due to ${err.message}`, err);
  });

  game_context.socket.on("game_error", (data) => {
    if (is_auth_reject_payload(data)) {
      schedule_auth_fail_backoff(
        typeof data === "string"
          ? data
          : (data && (data.phrase || data.message || data.reason)) ||
              "game_error",
      );
    }
  });

  game_context.socket.on("game_log", (data) => {
    if (is_auth_reject_payload(data)) {
      schedule_auth_fail_backoff(
        typeof data === "string"
          ? data
          : (data && (data.phrase || data.message || data.reason)) || "game_log",
      );
    }
  });

  // welcome.version is G.version / Version / game.js?v= — same stamp caracAL caches by.
  // Official client ignores it; we use a mismatch to refetch+redeploy unpinned bots.
  let reported_client_stale = false;
  function request_game_client_check(reason) {
    if (!proc_args.track_latest || reported_client_stale) {
      return;
    }
    reported_client_stale = true;
    console.warn(`game client check (${reason})`);
    process.send({ type: "game_client_check", reason });
  }

  game_context.socket.on("welcome", (data) => {
    if (!proc_args.track_latest) {
      return;
    }
    const server_version = data && data.version;
    if (server_version == null || server_version === "") {
      return;
    }
    const local = Number(proc_args.version);
    const remote = Number(server_version);
    if (!shouldRefreshClientForWelcome(local, remote)) {
      if (
        Number.isFinite(local) &&
        Number.isFinite(remote) &&
        remote < local
      ) {
        console.warn(
          `welcome version ${remote} behind local ${local} — keep local, skip client refresh`,
        );
      }
      return;
    }
    request_game_client_check(`welcome version ${remote} > local ${local}`);
  });

  // Live reload only hot-swaps data.js in-process; stock chat says refresh optionally.
  // Ask the coordinator whether HTML/game.js?v= moved — no periodic poll.
  game_context.socket.on("reloaded", () => {
    request_game_client_check("reloaded");
  });

  // Silent socket death: game may never call disconnect(); redeploy ourselves.
  let saw_socket_connected = false;
  let socket_down_since = null;
  setInterval(() => {
    const sock = game_context.socket;
    if (sock && sock.connected) {
      saw_socket_connected = true;
      socket_down_since = null;
      return;
    }
    if (!saw_socket_connected) {
      return;
    }
    if (socket_down_since == null) {
      socket_down_since = Date.now();
      return;
    }
    if (Date.now() - socket_down_since < 15_000) {
      return;
    }
    console.warn("socket down >15s after prior connect — redeploying");
    socket_down_since = Date.now() + 45_000;
    extensions.deploy();
  }, 2_000);

  return game_context;
}
//have to use on, localstorage may send messages
process.on("message", async (msg) => {
  if (msg.type == "process_args") {
    const { cname, clid } = msg.arguments;
    console.debug(
      "starting character thread with arguments: %O",
      msg.arguments,
    );
    const new_log = LogUtils.log.child({ cname, clid });
    LogUtils.log = new_log;
    await make_game(msg.arguments);
  }
});

process.send({
  type: "process_ready",
});
