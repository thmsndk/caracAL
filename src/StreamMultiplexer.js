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

/**
 * CharacterThreads orphaned when CharacterCoordinator dies get reparented to
 * main and sit as zombies / hold auth slots. Best-effort sweep before restart
 * (Linux/docker; no-op on Windows / missing pkill).
 */
function kill_orphan_character_threads() {
  if (process.platform === "win32") {
    return;
  }
  try {
    execFile(
      "pkill",
      ["-9", "-f", "src/CharacterThread\\.js"],
      { timeout: 5_000 },
      () => {},
    );
  } catch (_) {}
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

/**
 * Start log sinks + CharacterCoordinator. If the coordinator exits, tear down
 * sinks/orphans and bring the stack back — otherwise main.js keeps idling with
 * dead character zombies and the fleet stays offline forever.
 */
function setup_log_pipes(log_sinks, module_path, ...args) {
  let generation = 0;
  let runner = null;

  function start() {
    const gen = ++generation;
    const sinks = (log_sinks || []).map((command) =>
      command ? spawn_sink(...command) : null,
    );
    if (sinks.length < 1) {
      // Preserve historical fallback: at least inherit to process stdio.
      sinks.push(null);
    }

    runner = fork(module_path, args, {
      stdio: ["inherit", "pipe", "pipe", "ipc"],
    });
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

    runner.on("exit", (code, signal) => {
      if (gen !== generation) {
        return;
      }
      console.error(
        `CharacterCoordinator exited code=${code} signal=${signal} — restarting in ${Math.round(COORDINATOR_RESTART_DELAY_MS / 1000)}s`,
      );
      for (const sink of sinks) {
        safe_kill(sink);
      }
      kill_orphan_character_threads();
      setTimeout(() => {
        if (gen !== generation) {
          return;
        }
        start();
      }, COORDINATOR_RESTART_DELAY_MS);
    });

    return runner;
  }

  return start();
}

module.exports = {
  setup_log_pipes,
  spawn_sink,
  kill_orphan_character_threads,
  COORDINATOR_RESTART_DELAY_MS,
};
