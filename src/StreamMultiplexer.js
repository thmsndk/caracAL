//so much pain just because windows doesnt have bash ;-;
const { fork, spawn, execFile } = require("node:child_process");
const { PassThrough } = require("node:stream");
const cloneable = require("cloneable-readable");

function spawn_sink(command, ...args) {
  if (command === "node") {
    return fork(args[0], args.slice(1), {
      stdio: ["pipe", "inherit", "inherit", "ipc"],
    });
  } else {
    return spawn(command, args, {
      stdio: ["pipe", "inherit", "inherit", "ipc"],
    });
  }
}

/** Expected when a forked runner or log sink exits and closes its pipes. */
function is_benign_stream_error(err) {
  return (
    !err ||
    err.code === "ERR_STREAM_PREMATURE_CLOSE" ||
    err.code === "ERR_STREAM_DESTROYED" ||
    err.code === "EPIPE"
  );
}

function on_stream_settled(stream, callback) {
  let done = false;
  const mark = () => {
    if (done) {
      return;
    }
    done = true;
    callback();
  };
  stream.on("end", mark);
  stream.on("close", mark);
}

/**
 * Forward bytes without respecting backpressure.
 * `.pipe()` / `pipeline()` pause the producer when a sink stalls; that freezes
 * CharacterCoordinator (and its character threads) and looks like a permanent
 * disconnect with no reconnect.
 */
function pump_no_backpressure(src, dest) {
  if (!dest) {
    return;
  }
  src.on("data", (chunk) => {
    try {
      if (dest.writable) {
        dest.write(chunk);
      }
    } catch (_) {
      // sink died mid-write — drop rather than freeze the producer
    }
  });
  src.on("error", (err) => {
    if (!is_benign_stream_error(err)) {
      throw err;
    }
  });
}

function redirect_into_process(stdout, stderr, target_proc) {
  function err_handler(err) {
    if (is_benign_stream_error(err)) {
      return;
    }
    throw err;
  }
  if (target_proc) {
    // Merge stdout+stderr into one stdin. Two pipeline()s into the same
    // destination would end stdin when the first source finishes and
    // ERR_STREAM_PREMATURE_CLOSE the other.
    const merged = new PassThrough({ highWaterMark: 1024 * 1024 });
    let pending = 2;
    const on_source_done = () => {
      pending -= 1;
      if (pending === 0) {
        merged.end();
      }
    };
    pump_no_backpressure(stdout, merged);
    pump_no_backpressure(stderr, merged);
    on_stream_settled(stdout, on_source_done);
    on_stream_settled(stderr, on_source_done);
    pump_no_backpressure(merged, target_proc.stdin);
    merged.on("error", err_handler);
  } else {
    // Never end the process stdio streams.
    pump_no_backpressure(stdout, process.stdout);
    pump_no_backpressure(stderr, process.stderr);
  }
}

function safe_kill(proc, signal = "SIGKILL") {
  if (!proc || proc.killed || proc.exitCode != null) {
    return;
  }
  try {
    proc.kill(signal);
  } catch (_) {}
}

const COORDINATOR_RESTART_DELAY_MS = 2_500;
const COORDINATOR_RESTART_DELAY_MAX_MS = 60_000;
const COORDINATOR_STABLE_MS = 60_000;
const COORDINATOR_MAX_FAILURES = 20;

function is_coordinator_module(module_path) {
  return /CharacterCoordinator\.js$/i.test(
    String(module_path || "").replace(/\\/g, "/"),
  );
}

/**
 * Parse trailing options from setup_log_pipes(...args).
 * Legacy callers pass only path strings; fleet supervision is opt-in via
 * `{ superviseFleet: true }` or auto-detected CharacterCoordinator paths.
 */
function split_args_and_options(rest) {
  if (
    rest.length > 0 &&
    rest[rest.length - 1] &&
    typeof rest[rest.length - 1] === "object" &&
    !Array.isArray(rest[rest.length - 1])
  ) {
    return {
      args: rest.slice(0, -1),
      options: rest[rest.length - 1],
    };
  }
  return { args: rest, options: {} };
}

/**
 * Kill CharacterThreads left behind when CharacterCoordinator dies.
 * Prefer the coordinator's process group (forked with detached on Unix);
 * fall back to a cmdline pkill only for that sweep path.
 *
 * @param {number | null | undefined} coordinatorPid
 * @returns {Promise<void>}
 */
function kill_orphan_character_threads(coordinatorPid) {
  if (process.platform === "win32") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    const timer = setTimeout(done, 2_000);

    if (coordinatorPid && Number.isFinite(coordinatorPid)) {
      try {
        // Negative pid = process group (coordinator was group leader via detached).
        process.kill(-coordinatorPid, "SIGKILL");
      } catch (_) {
        /* group may already be gone */
      }
    }

    execFile(
      "pkill",
      ["-9", "-f", "src/CharacterThread\\.js"],
      { timeout: 5_000 },
      () => {
        clearTimeout(timer);
        done();
      },
    );
  });
}

function restart_delay_ms(failures) {
  const exp = Math.min(Math.max(failures, 1) - 1, 5);
  return Math.min(
    COORDINATOR_RESTART_DELAY_MAX_MS,
    COORDINATOR_RESTART_DELAY_MS * Math.pow(2, exp),
  );
}

/**
 * Start log sinks + a forked module (CharacterCoordinator or webpack watch).
 *
 * Fleet supervision (`superviseFleet` / CharacterCoordinator path only):
 * if the coordinator exits, tear down sinks, sweep orphan CharacterThreads,
 * and restart with backoff — otherwise main.js idles forever with zombies.
 *
 * Webpack / other modules keep historical behavior: no auto-restart, no pkill.
 */
function setup_log_pipes(log_sinks, module_path, ...rest) {
  const { args, options } = split_args_and_options(rest);
  const superviseFleet =
    options.superviseFleet === true ||
    (options.superviseFleet !== false && is_coordinator_module(module_path));

  let generation = 0;
  let runner = null;
  let failures = 0;
  let stableTimer = null;

  function clear_stable_timer() {
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
  }

  function start() {
    const gen = ++generation;
    clear_stable_timer();
    const sinks = (log_sinks || []).map((command) =>
      command ? spawn_sink(...command) : null,
    );
    if (sinks.length < 1) {
      sinks.push(null);
    }

    const forkOpts = {
      stdio: ["inherit", "pipe", "pipe", "ipc"],
    };
    // New process group so we can SIGKILL orphans via -pid when coordinator dies.
    if (superviseFleet && process.platform !== "win32") {
      forkOpts.detached = true;
    }

    runner = fork(module_path, args, forkOpts);
    const runnerPid = runner.pid;
    const stdout_clone = cloneable(runner.stdout);
    const stderr_clone = cloneable(runner.stderr);

    for (let i = 1; i < sinks.length; i++) {
      redirect_into_process(
        stdout_clone.clone(),
        stderr_clone.clone(),
        sinks[i],
      );
    }
    redirect_into_process(stdout_clone, stderr_clone, sinks[0]);

    if (superviseFleet) {
      stableTimer = setTimeout(() => {
        if (gen === generation) {
          failures = 0;
        }
      }, COORDINATOR_STABLE_MS);
    }

    runner.on("exit", (code, signal) => {
      if (gen !== generation) {
        return;
      }
      clear_stable_timer();
      for (const sink of sinks) {
        safe_kill(sink);
      }

      if (!superviseFleet) {
        console.error(
          `${module_path} exited code=${code} signal=${signal} (no auto-restart)`,
        );
        return;
      }

      failures += 1;
      if (failures > COORDINATOR_MAX_FAILURES) {
        console.error(
          `CharacterCoordinator exited code=${code} signal=${signal} — giving up after ${failures} failures`,
        );
        return;
      }

      const delay = restart_delay_ms(failures);
      console.error(
        `CharacterCoordinator exited code=${code} signal=${signal} — restarting in ${Math.round(delay / 1000)}s (failure ${failures}/${COORDINATOR_MAX_FAILURES})`,
      );

      Promise.resolve(kill_orphan_character_threads(runnerPid))
        .catch(() => {})
        .then(() => {
          setTimeout(() => {
            if (gen !== generation) {
              return;
            }
            start();
          }, delay);
        });
    });

    return runner;
  }

  return start();
}

module.exports = {
  setup_log_pipes,
  spawn_sink,
  kill_orphan_character_threads,
  is_coordinator_module,
  restart_delay_ms,
  COORDINATOR_RESTART_DELAY_MS,
  COORDINATOR_RESTART_DELAY_MAX_MS,
  COORDINATOR_MAX_FAILURES,
};
