
const vm = require('vm');
const io = require("socket.io-client");
const fs = require('fs').promises;
const { JSDOM } = require( "jsdom" );
const node_query = require('jquery');
const game_files = require("./game_files");
const fetch = require('node-fetch');
const monitoring_util = require("./monitoring_util");
const ipc_storage = require("./ipcStorage");

// monkey patch console colors
// https://stackoverflow.com/a/50325607/28145
const colors = {
  Reset: "\x1b[0m",
  Bright: "\x1b[1m",
  Dim: "\x1b[2m",
  Underscore: "\x1b[4m",
  Blink: "\x1b[5m",
  Reverse: "\x1b[7m",
  Hidden: "\x1b[8m",
  
  FgBlack: "\x1b[30m",
  FgRed: "\x1b[31m",
  FgGreen: "\x1b[32m",
  FgYellow: "\x1b[33m",
  FgBlue: "\x1b[34m",
  FgMagenta: "\x1b[35m",
  FgCyan: "\x1b[36m",
  FgWhite: "\x1b[37m",
  FgGray: "\x1b[90m",
  
  BgBlack: "\x1b[40m",
  BgRed: "\x1b[41m",
  BgGreen: "\x1b[42m",
  BgYellow: "\x1b[43m",
  BgBlue: "\x1b[44m",
  BgMagenta: "\x1b[45m",
  BgCyan: "\x1b[46m",
  BgWhite: "\x1b[47m",
  FgGray: "\x1b[100m",
}
const cLog = console.log
console.log = function () {
  cLog.apply(this, [new Date().toISOString(),...arguments,colors.Reset]);
};

const cError = console.error
console.error = function () {
  cError.apply(this, [colors.FgRed,"🔴",new Date().toISOString(),...arguments,colors.Reset]);
};

const cWarn = console.warn
console.warn = function () {
  cWarn.apply(this, [colors.FgYellow,"⚠️",new Date().toISOString(),...arguments,colors.Reset]);
};

// const cInfo = console.info
// console.info = function () {
//   cInfo.apply(this, [colors.FgCyan,"ℹ️",...arguments,colors.Reset]);
// };

const cDebug = console.debug
console.debug = function () {
  cDebug.apply(this, [colors.FgCyan,"🛠️",new Date().toISOString(),...arguments,colors.Reset]);
};
// console.success = function () {
  
// };
// console.ok = function () {
  
// };


process.on('unhandledRejection', function (exception) {
  console.warn("promise rejected: \n",exception);
});

const html_spoof = `<!DOCTYPE html>
<html>
<head>
<title>Adventure Land</title>
</head>
<body>
</body>
</html>`

function make_context(upper = null) {
  const result = new JSDOM(html_spoof,
    {url: "https://adventure.land/"}).window;
  //jsdom maked globalThis point to Node global
  //but we want it to be window instead
  result.globalThis = result;
  result.fetch = fetch;
  result.$ = result.jQuery = node_query(result);
  result.require = require;
  if(upper) {
    Object.defineProperty(result, "parent", {value: upper});
    result._localStorage = upper._localStorage;
    result._sessionStorage = upper._sessionStorage;
  } else {
    result._localStorage = ipc_storage.make_IPC_storage("ls");;
    result._sessionStorage = ipc_storage.make_IPC_storage("ss");;
  }
  vm.createContext(result);

  result.eval = function(arg) {
    return vm.runInContext(arg, result);
  };
  
  return result;
}

async function ev_files(locations,context) {
  for(let location of locations) {
    let text = await fs.readFile(location,'utf8');
    vm.runInContext(text+"\n//# sourceURL=file://"+location, context);
  }
}

async function make_runner(upper,CODE_file,version) {

  const runner_sources = game_files.get_runner_files().map(f=>
    game_files.locate_game_file(f,version));
  console.log("constructing runner instance");
  console.debug("source files:\n%s",runner_sources);
  const runner_context = make_context(upper);
  //contents of adventure.land/runner
  //its an html file but not labeled as such
  //TODO in the future i should consider parsing the relevant parts out of the html files directly
  //for the runners as well as the instances
  vm.runInContext("var active=false,catch_errors=true,is_code=1,is_server=0,is_game=0,is_bot=parent.is_bot,is_cli=parent.is_cli,is_sdk=parent.is_sdk;", runner_context);
  await ev_files(runner_sources,runner_context);
  runner_context.send_cm = function(to, data) {
    process.send({
      type:"cm",
      to,
      data
    });
  }
  //we need to do this here because of scoping
  upper.caracAL.load_scripts = async function(locations) {
    return await ev_files(locations.map(x=>"./CODE/"+x),runner_context);
  }
  vm.runInContext("active = true;parent.code_active = true;set_message('Code Active');if (character.rip) character.trigger('death', {past: true});", runner_context);
  
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
  ['SIGINT', 'SIGTERM', 'SIGQUIT']
  .forEach(signal => process.on(signal, async () => {
    console.log(`Received ${signal} on client. Requesting termination`);
    process.send({
      type: "shutdown"
    });
  }));

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
  
  process.send({type: "connected"});
  
  console.log("runner instance constructed");
  monitoring_util.register_stat_beat(upper);
  //Fix a bug where parent.X is initially empty
  await connected_signoff;
  await ev_files([CODE_file],runner_context);
  //TODO put a process end handler here
  
  return runner_context;
}

async function make_game(version,addr,port,sess,cid,script_file,enable_map) {
  const game_sources = game_files.get_game_files().map(f=>
    game_files.locate_game_file(f,version))
    .concat(["./html_vars.js"]);
  console.log("constructing game instance");
  console.debug("source files:\n%s",game_sources);
  const game_context = make_context();
  game_context.io = io;
  game_context.bowser = {};
  await ev_files(game_sources,game_context);
  game_context.VERSION = ""+game_context.G.version;
  game_context.server_addr = addr;
  game_context.server_port = port;
  game_context.user_id = sess.split("-")[0];
  game_context.user_auth = sess.split("-")[1];
  game_context.character_to_load = cid;
  
  //expose the block under parent.caracAL
  const extensions = {};
  extensions.deploy = function(char_name, realm, script_file, game_version) {
    
      process.send({
        type: "deploy",
          ...(char_name && {character:char_name}),
          ...(realm && {realm}),
          ...(script_file && {script:script_file}),
          ...(game_version && {version:game_version})
      });
    
  }
  extensions.shutdown = function(char_name) {
    process.send({
      type: "shutdown",
      character: char_name
    });
  }
  extensions.map_enabled = function() {
    return enable_map;
  }
  
  game_context.caracAL = extensions;
  
  const old_ng_logic = game_context.new_game_logic;
  game_context.new_game_logic = function() {
    old_ng_logic();
    clearTimeout(reload_task);
    (async function() {
      const runner_context = await make_runner(game_context,"./CODE/"+script_file,version);
      extensions.runner = runner_context;
    })();
  }
  const old_dc = game_context.disconnect;
  game_context.disconnect = function() {
    old_dc();
    extensions.deploy();
  }
  const old_api = game_context.api_call;
  game_context.api_call = function(method,args,r_args) {
    //servers and characters are handled centrally
    if(method != "servers_and_characters") {
      return old_api(method,args,r_args);
    } else {
      console.debug("filtered s&c call");
    }
  }
  game_context.get_code_function = function(f_name) {
    return extensions.runner && extensions.runner[f_name] || function(){}; 
  }
  //call_code_function("trigger_character_event","cm",{name:data.name,message:JSON.parse(data.message)});

  const add_log = function (message, color) {
    let fgColorString = "";
    
    if (color) {
      if (color.startsWith("#")) {
        // https://stackoverflow.com/a/59395813/28145
        const hex = color.substring(1);

        let red = parseInt(hex.substr(0, 2), 16);
        let green = parseInt(hex.substr(2, 2), 16);
        let blue = parseInt(hex.substr(4, 2), 16);

        fgColorString = `\x1b[38;2;${red};${green};${blue}m`;
        // bgColorString = `\x1b[48;2;${red};${green};${blue}m`;
      } else {
        switch (color) {
          case "white":
            fgColorString = colors.FgWhite;
            break;
          case "grey":
            fgColorString = colors.FgGray;
            break;
        }
      }
    }

    console.log(
      fgColorString,
      character ? character.name + ' | ' : "",
      message
    );
  };

  vm.runInContext(`add_log = ${add_log.toString()}`, game_context);

  vm.runInContext("show_json = function(json) {console.log('show_json',json);}",game_context);

  vm.runInContext(`set_message = ${add_log.toString()}`,game_context);

  process.send({type: "initialized"});
  process.on("message", (m) => {
    switch (m.type) {
      case "siblings_and_acc":
        extensions.siblings = m.siblings;
        game_context.handle_information([m.account]);
        break;
      case "receive_cm":
        game_context.call_code_function("trigger_character_event","cm",
          {name:m.name,message:m.data,caracAL:true});
        break;
      case "send_cm":
        game_context.send_code_message(m.to,m.data);
        break;
    }
  });
  vm.runInContext("the_game()",game_context);
  const reload_timeout = 14;
  const reload_task = setTimeout(function(){
    console.warn(`game not loaded after ${reload_timeout} seconds, reloading`);
    extensions.deploy();
  },reload_timeout * 1000 + 100);
  console.log("game instance constructed");
  return game_context;
}

async function caracal_start() {
  console.debug = function(){};
  let args = process.argv.slice(2);
  const version = args[0];
  const realm_addr = args[1];
  const realm_port = args[2];
  const sess = args[3];
  const cid = args[4];
  const script_file = args[5];
  const enable_map = args[6]=="yesmap";
  await make_game(version,realm_addr,realm_port,sess,cid, script_file,enable_map);
}

caracal_start();
