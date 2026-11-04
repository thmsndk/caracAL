const fs = require("node:fs");
const { entries } = Object;
//TODO skip unchanged keys on client layer directly
class FileStoredKeyValues {
  #main_path;
  #replacer_path;
  #backend;
  #handle;
  #refactorTask;

  constructor(
    main_path = "garage.jsonl",
    replacer_path = "garage.new.jsonl",
    refactor_interval = 30e3,
  ) {
    if (main_path === replacer_path) {
      throw new Error(
        `Please choose different main path and replacer path: ${main_path}`,
      );
    }
    this.#main_path = main_path;
    this.#replacer_path = replacer_path;
    this.#backend = new Map();
    this.#initializeHandle();
    this.#refactorTask = setInterval(() => this.refactor(), refactor_interval);
    this.refactor();
  }

  #checkFileExistence(path) {
    let handle = null;
    try {
      handle = fs.openSync(path, "r");
    } catch (err) {
      return false;
    } finally {
      if (handle !== null) {
        fs.closeSync(handle);
      }
    }
    return true;
  }

  #ingestLine(line) {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      const [key, value] = entries(JSON.parse(trimmed))[0];
      if (value === null) {
        this.#backend.delete(key);
      } else {
        this.#backend.set(key, value);
      }
    } catch (err) {
      console.error(
        `FileStoredKeyValues: skipping corrupt line (${err.message}): ${trimmed.slice(0, 120)}`,
      );
    }
  }

  #initializeHandle() {
    if (
      this.#checkFileExistence(this.#replacer_path) &&
      !this.#checkFileExistence(this.#main_path)
    ) {
      fs.renameSync(this.#replacer_path, this.#main_path);
    }
    // Stream line-by-line — readFileSync OOMs / ERR_STRING_TOO_LONG once the
    // append log grows past ~512MiB (seen live at 590MiB before compact).
    this.#handle = fs.openSync(this.#main_path, "a+");
    const buf = Buffer.alloc(1024 * 1024);
    let leftover = "";
    for (;;) {
      const n = fs.readSync(this.#handle, buf, 0, buf.length, null);
      if (n === 0) break;
      leftover += buf.toString("utf8", 0, n);
      let nl;
      while ((nl = leftover.indexOf("\n")) >= 0) {
        this.#ingestLine(leftover.slice(0, nl));
        leftover = leftover.slice(nl + 1);
      }
    }
    if (leftover.length > 0) {
      this.#ingestLine(leftover);
    }
  }

  refactor() {
    //this method writes the current contents without history
    //it writes to a temp file then replaces original
    //this guarantees that data will never be lost
    const k_v_list = [];
    for (let [key, value] of this.#backend.entries()) {
      k_v_list.push(JSON.stringify({ [key]: value }) + "\n");
    }
    const fd = fs.openSync(this.#replacer_path, "w");
    fs.writeFileSync(fd, k_v_list.join(""), { encoding: "utf8" });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.closeSync(this.#handle);
    fs.unlinkSync(this.#main_path);
    fs.renameSync(this.#replacer_path, this.#main_path);
    this.#handle = fs.openSync(this.#main_path, "a");
  }

  close() {
    clearInterval(this.#refactorTask);
    fs.closeSync(this.#handle);
  }

  shutdown() {
    clearInterval(this.#refactorTask);
    this.refactor();
  }

  //i dont guarantee functionality if you set values that are not strings
  set(key, value) {
    if (this.get(key) !== value) {
      fs.writeFileSync(this.#handle, JSON.stringify({ [key]: value }) + "\n", {
        encoding: "utf8",
      });
      this.#backend.set(key, value);
      // Large cstore values (loot/history) append multi-MB lines; don't wait for
      // the 30s timer or the jsonl balloons past 100MB and starves the event loop.
      try {
        const st = fs.fstatSync(this.#handle);
        if (st.size > 32 * 1024 * 1024) {
          this.refactor();
        }
      } catch (_) {}
    }
    return this;
  }

  delete(key) {
    fs.writeFileSync(this.#handle, JSON.stringify({ [key]: null }) + "\n", {
      encoding: "utf8",
    });
    return this.#backend.delete(key);
  }

  get(key) {
    return this.#backend.get(key);
  }

  entries() {
    return this.#backend.entries();
  }
}

module.exports = FileStoredKeyValues;
