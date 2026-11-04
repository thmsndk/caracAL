const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { console } = require("./src/LogUtils");
const {
  noteAccountFetchOk,
  noteAccountFetchFail,
} = require("./src/network_health");
class Info {
  constructor() {}

  async updateInfo() {
    console.log("updating account info");
    try {
      const raw = await fetch(`${this.base_url}/api/servers_and_characters`, {
        method: "POST",
        headers: {
          Cookie: "auth=" + this.session,
          "Content-Type": "application/json",
        },
        // Hung API must not leave overlapping updateInfo forever.
        signal: AbortSignal.timeout(15_000),
      });
      if (!raw.ok) {
        const err = new Error(`failed to update account info: ${raw.statusText}`);
        noteAccountFetchFail(err);
        throw err;
      }
      const data = await raw.json();
      const res = data.infs ? data.infs[0] : data[0];
      console.log(
        `found ${res.servers.length} servers and ${res.characters.length} characters`,
      );
      noteAccountFetchOk();
      this.listeners.forEach((func) => func(res));
      return (this.response = res);
    } catch (e) {
      noteAccountFetchFail(e);
      throw e;
    }
  }

  add_listener(func) {
    this.listeners.push(func);
  }
  remove_listener(func) {
    const index = this.listeners.indexOf(func);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  static async build(base_url, session) {
    const result = new Info();
    result.base_url = base_url;
    result.session = session;
    result.listeners = [];
    result.auto_update = true;
    await result.updateInfo();
    result.task = setInterval(async () => {
      if (result.auto_update) {
        await result.updateInfo().catch((e) => {
          // noteAccountFetchFail already recorded inside updateInfo
          console.warn("failed to update account info: %s", e);
        });
      }
    }, 6e3);
    return result;
  }

  destroy() {
    if (this.task) {
      clearInterval(this.task);
    }
  }

  resolve_char(char_name) {
    return this.response.characters.find((char) => char.name == char_name);
  }

  resolve_realm(realm_key) {
    return this.response.servers.find((serv) => serv.key == realm_key);
  }
}
module.exports = Info.build;
