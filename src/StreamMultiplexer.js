//so much pain just because windows doesnt have bash ;-;
const { fork, spawn } = require("node:child_process");
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

function setup_log_pipes(log_sinks, module_path, ...args) {
  const log_sink_processes = log_sinks.map((command) =>
    command ? spawn_sink(...command) : null,
  );

  const runner = fork(module_path, args, {
    stdio: ["inherit", "pipe", "pipe", "ipc"],
  });
  const stdout_clone = cloneable(runner.stdout);
  const stderr_clone = cloneable(runner.stderr);

  if (log_sink_processes.length < 1) {
    log_sink_processes = [null];
  }

  for (let i = 1; i < log_sink_processes.length; i++) {
    redirect_into_process(
      stdout_clone.clone(),
      stderr_clone.clone(),
      log_sink_processes[i],
    );
  }
  redirect_into_process(stdout_clone, stderr_clone, log_sink_processes[0]);
  return runner;
}

module.exports = { setup_log_pipes, spawn_sink };
