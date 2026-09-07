const fs = require("fs").promises;
const fs_sync = require("fs");
const { createWriteStream } = require("fs");
const { pipeline } = require("stream");
const { promisify } = require("util");
const streamPipeline = promisify(pipeline);
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const path = require("path");
const { console } = require("./LogUtils");
const { URL } = require("url");
const { extractPageGlobals } = require("./html_globals");
const {
  resolveGameFilesFromIndexHtml,
  resolveRunnerFilesFromRunnerHtml,
} = require("./client_scripts");

function checkFileExists(filepath) {
  let flag = true;
  try {
    fs_sync.accessSync(filepath, fs.constants.F_OK);
  } catch (e) {
    flag = false;
  }
  return flag;
}

function getHostname(base_url) {
  return new URL(base_url).hostname;
}

/** Config `version: 0` (or omitted) tracks the live client; anything else is pinned. */
function follows_latest_client(version) {
  return version == null || version === 0 || version === "0" || version === "";
}

/** Fallback when a version folder has no client_scripts.json (pre-hardening caches). */
function get_runner_files_fallback() {
  return [
    "/js/old_common_functions.js",
    "/js/common_functions.js",
    "/js/runner_functions.js",
    "/js/runner_compat.js",
  ];
}

function get_game_files_fallback() {
  return [
    "/js/pixi/fake/pixi.min.js",
    "/js/libraries/combined.js",
    "/js/codemirror/fake/codemirror.js",
    "/js/old_common_functions.js",
    "/js/common_functions.js",
    "/js/functions.js",
    "/js/game.js",
    "/js/html.js",
    "/js/merrit_stand_notice.js",
    "/js/payments.js",
    "/js/keyboard.js",
    "/data.js",
  ];
}

function locate_client_scripts_manifest(base_url, version) {
  const base_host_name = getHostname(base_url);
  return `./game_files/${base_host_name}/${version}/client_scripts.json`;
}

function read_client_scripts_manifest(base_url, version) {
  const manifest_path = locate_client_scripts_manifest(base_url, version);
  if (!checkFileExists(manifest_path)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs_sync.readFileSync(manifest_path, "utf8"));
    if (
      !raw ||
      !Array.isArray(raw.game) ||
      !Array.isArray(raw.runner) ||
      raw.game.length === 0 ||
      raw.runner.length === 0
    ) {
      return null;
    }
    return raw;
  } catch (e) {
    console.warn("invalid client_scripts.json for version " + version, e);
    return null;
  }
}

async function write_client_scripts_manifest(base_url, version, manifest) {
  const manifest_path = locate_client_scripts_manifest(base_url, version);
  await fs.writeFile(
    manifest_path,
    JSON.stringify(
      {
        version,
        generated_from: "official index + runner HTML",
        game: manifest.game,
        runner: manifest.runner,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return manifest_path;
}

/** Prefer HTML-derived manifest; fall back to the static list for old caches. */
function get_game_files(base_url, version) {
  if (base_url != null && version != null) {
    const manifest = read_client_scripts_manifest(base_url, version);
    if (manifest) return manifest.game;
  }
  return get_game_files_fallback();
}

function get_runner_files(base_url, version) {
  if (base_url != null && version != null) {
    const manifest = read_client_scripts_manifest(base_url, version);
    if (manifest) return manifest.runner;
  }
  return get_runner_files_fallback();
}

function get_all_client_files(base_url, version) {
  return get_game_files(base_url, version)
    .concat(get_runner_files(base_url, version))
    .filter(function (item, pos, self) {
      return self.indexOf(item) == pos;
    });
}

async function cull_versions(base_url, exclusions) {
  const base_host_name = getHostname(base_url);
  const all_versions = await available_versions(base_url);
  const target_culls = all_versions.filter(
    (x, i) => i >= 2 && !exclusions.includes(x),
  );
  for (let cull of target_culls) {
    try {
      console.log("culling version " + cull);
      await fs.rmdir(`./game_files/${base_host_name}/${cull}`, {
        recursive: true,
      });
    } catch (e) {
      console.warn("failed to cull version " + cull, e);
    }
  }
}

async function available_versions(base_url) {
  return (
    await fs.readdir("./game_files/" + getHostname(base_url), {
      withFileTypes: true,
    })
  )
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .filter((x) => x.match(/^\d+$/))
    .map((x) => parseInt(x))
    .sort()
    .reverse();
}

async function download_file(url, file_p) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`failed to download ${url}: ${response.statusText}`);
  }

  return await streamPipeline(response.body, createWriteStream(file_p));
}

async function fetch_index_html(base_url) {
  const raw = await fetch(base_url);
  if (!raw.ok) {
    throw new Error(`failed to fetch index html: ${raw.statusText}`);
  }
  return await raw.text();
}

async function fetch_runner_html(base_url) {
  const url = base_url.replace(/\/?$/, "/") + "runner";
  const raw = await fetch(url);
  if (!raw.ok) {
    throw new Error(`failed to fetch runner html: ${raw.statusText}`);
  }
  return await raw.text();
}

async function get_latest_version(base_url) {
  const html = await fetch_index_html(base_url);
  const match = /game\.js\?v=([0-9]+)"/.exec(html);
  if (!match) {
    throw new Error(`malformed version response`);
  }
  return { version: parseInt(match[1]), html };
}

function locate_html_globals(base_url, version) {
  return locate_game_file(base_url, "/html_globals.js", version);
}

async function write_html_globals(base_url, version, html) {
  const globals_path = locate_html_globals(base_url, version);
  const script =
    "// Auto-extracted from official page HTML — do not edit.\n" +
    extractPageGlobals(html);
  await fs.writeFile(globals_path, script, "utf8");
  return globals_path;
}

async function ensure_html_globals(base_url, version, html) {
  const globals_path = locate_html_globals(base_url, version);
  if (checkFileExists(globals_path)) {
    return globals_path;
  }
  const page_html = html ?? (await fetch_index_html(base_url));
  return await write_html_globals(base_url, version, page_html);
}

function resolve_html_globals_source(base_url, version) {
  const cached = locate_html_globals(base_url, version);
  if (checkFileExists(cached)) {
    return cached;
  }
  console.warn(
    "html_globals.js missing for version " +
      version +
      "; falling back to src/html_prelude.js",
  );
  return "./src/html_prelude.js";
}

function locate_game_file(base_url, resource, version) {
  const base_host_name = getHostname(base_url);
  const file_name = path.posix.basename(resource);
  return `./game_files/${base_host_name}/${version}/${file_name}`;
}

/**
 * Download URL for a caracAL resource path. Fakes are also hosted upstream
 * under /js/.../fake/ and are fetched like any other client file.
 */
function official_download_url(base_url, resource) {
  return base_url.replace(/\/?$/, "") + resource;
}

async function ensure_latest(base_url) {
  const base_host_name = getHostname(base_url);
  const { version, html } = await get_latest_version(base_url);
  const runner_html = await fetch_runner_html(base_url);
  const game = resolveGameFilesFromIndexHtml(html);
  const runner = resolveRunnerFilesFromRunnerHtml(runner_html);

  const fpath = `./game_files/${base_host_name}/${version}`;
  await fs.mkdir(fpath, { recursive: true });
  await write_client_scripts_manifest(base_url, version, { game, runner });
  // Refresh page globals every ensure so new injects (proximity_guides, etc.) land.
  await write_html_globals(base_url, version, html);

  const target_files = get_all_client_files(base_url, version).filter(
    (resource) =>
      !checkFileExists(locate_game_file(base_url, resource, version)),
  );
  if (target_files.length == 0) {
    console.log("all files for version " + version + " are present");
  } else {
    console.log("downloading game files for version " + version, target_files);
  }
  const tasks = target_files.map((itm) =>
    download_file(
      official_download_url(base_url, itm),
      locate_game_file(base_url, itm, version),
    ),
  );
  await Promise.all(tasks);

  return version;
}

exports.follows_latest_client = follows_latest_client;
exports.cull_versions = cull_versions;
exports.available_versions = available_versions;
exports.ensure_latest = ensure_latest;
exports.ensure_html_globals = ensure_html_globals;
exports.resolve_html_globals_source = resolve_html_globals_source;
exports.locate_game_file = locate_game_file;
exports.locate_html_globals = locate_html_globals;
exports.locate_client_scripts_manifest = locate_client_scripts_manifest;
exports.get_runner_files = get_runner_files;
exports.get_game_files = get_game_files;
exports.get_game_files_fallback = get_game_files_fallback;
exports.get_runner_files_fallback = get_runner_files_fallback;
