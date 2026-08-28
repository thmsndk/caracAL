// Official HTML injects these before functions.js. The VM throws ReferenceError
// if they are missing (e.g. add_log("Last Update " + last_deploy)).
// Keep in sync with upstream PR #21 (feat/mongo-al) + base_script.html globals.
var last_deploy = "";
var is_tauri = "";
var update_notes = [];
var update_notes_more = false;
var discord_url = "";
var support_email = "";
var Prod = "";
var Staging = "";
