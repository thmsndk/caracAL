/**
 * Adventure Land's clone() uses `instanceof Array` / `instanceof Object`.
 * Under caracAL (JSDOM window + vm.createContext) those checks fail for
 * ordinary object/array literals created in the VM — clone then throws
 * "type not supported". See docs/jsdom-vm-realm-clone.md.
 *
 * This overlay replaces clone after game/runner scripts load. It keeps AL's
 * seen/circular behaviour but detects arrays/dates/plain objects in a
 * realm-safe way so both VM literals and Node/JSON socket payloads clone.
 */

"use strict";

const OVERLAY_SOURCE = `
(function () {
  function caracAL_tag(value) {
    return Object.prototype.toString.call(value);
  }

  function caracAL_is_date(value) {
    return caracAL_tag(value) === "[object Date]";
  }

  function caracAL_is_plain_object(value) {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value) || caracAL_is_date(value)) return false;
    var tag = caracAL_tag(value);
    if (tag === "[object Object]") return true;
    // Null-prototype dictionaries (rare in AL; original clone threw on these).
    try {
      return Object.getPrototypeOf(value) === null;
    } catch (e) {
      return false;
    }
  }

  function clone(obj, args) {
    if (!args) args = {};
    if (!args.seen && args.seen !== []) args.seen = [];
    if (null == obj) return obj;
    if (args.simple_functions && typeof is_function === "function" && is_function(obj)) {
      return "[clone]:" + obj.toString().substring(0, 40);
    }
    if ("object" != typeof obj) return obj;
    if (caracAL_is_date(obj)) {
      var date_copy = new Date();
      date_copy.setTime(obj.getTime());
      return date_copy;
    }
    if (Array.isArray(obj)) {
      args.seen.push(obj);
      var array_copy = [];
      for (var i = 0; i < obj.length; i++) {
        array_copy[i] = clone(obj[i], args);
      }
      return array_copy;
    }
    if (caracAL_is_plain_object(obj) || (typeof obj === "object" && obj instanceof Object)) {
      args.seen.push(obj);
      var object_copy = {};
      for (var attr in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, attr)) {
          if (args.seen.indexOf(obj[attr]) !== -1) {
            object_copy[attr] = "circular_attribute[clone]";
            continue;
          }
          object_copy[attr] = clone(obj[attr], args);
        }
      }
      return object_copy;
    }
    throw "type not supported";
  }

  clone.__caracAL_realm_safe = true;
  globalThis.clone = clone;
})();
`;

/**
 * Replace Adventure Land clone() on a character/game vm context.
 * @param {object} context contextified JSDOM window
 */
function apply_realm_safe_clone(context) {
  const vm = require("vm");
  vm.runInContext(OVERLAY_SOURCE + "\n//# sourceURL=caracAL://realm_safe_clone.js", context);
}

exports.apply_realm_safe_clone = apply_realm_safe_clone;
exports.OVERLAY_SOURCE = OVERLAY_SOURCE;
