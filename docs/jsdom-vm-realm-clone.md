# JSDOM + `vm` realm vs Adventure Land `clone`

## Symptom

Bots log / sometimes die with:

```text
Error: Uncaught 'type not supported'
  at .../jsdom/.../runtime-script-errors.js
  at Timeout.task .../jsdom/.../Window.js
```

Throw site is Adventure Land `clone()` in `common_functions.js` / `old_common_functions.js` (`throw "type not supported"`).

It shows up a lot around `smart_move` / map travel, and also in combat. User scripts that only call `smart_move("bat")` are enough to trigger it — the script is not wrong.

## Cause

caracAL loads the game client like this ([`src/CharacterThread.js`](../src/CharacterThread.js)):

1. `new JSDOM(...).window`
2. `vm.createContext(window)`
3. `vm.runInContext(gameOrRunnerSource, window)`

After (2), plain `{...}` / `[...]` created inside the VM often fail `instanceof Object` / `instanceof Array` even though `Array.isArray` still works. AL’s `clone` uses those `instanceof` checks, so it throws on ordinary game objects (`G.*`, path structures, cosmetics, etc.).

Socket payloads from `JSON.parse` are usually Node-realm objects and still clone. That is why many paths “work” until travel/UI/item code clones a VM object.

In a real browser (one realm), the same `clone` is fine. JSDOM’s own `runScripts` / same-realm `eval` also keeps `instanceof` working. The break is specific to **JSDOM window + Node `vm.createContext`**.

## What we ship today (mitigation B)

After game and runner scripts load, caracAL replaces `clone` with a realm-safe overlay ([`src/realm_safe_clone.js`](../src/realm_safe_clone.js)):

- arrays via `Array.isArray`
- dates via `Object.prototype.toString`
- plain objects via `[object Object]` (and null-prototype)
- same `seen` / circular_attribute behaviour as upstream

Do **not** only rebind `window.Object` / `Array` to VM constructors: that tends to fix VM literals and break Node/socket objects (or the reverse).

## What to explore later (approach A)

Root fix: run game/runner code in **JSDOM’s realm** so `instanceof` matches the browser — e.g. avoid `vm.createContext` on the window, or load scripts through JSDOM `runScripts` / equivalent same-realm execution.

Worth exploring because:

- Every other AL helper that assumes single-realm `instanceof` stays fragile under the current model.
- Overlay B only patches the known throw site.

Hard parts to design carefully:

- caracAL hangs Node `require`, `Buffer`, `process`, `fetch`, parent/runner bridging on the same window.
- Game and runner are separate contexts with `parent` links.
- Behaviour regressions need the same red checks as B (VM literal clone, Node JSON clone, `smart_move` smoke).

Until A lands, keep B applied on both game and runner contexts after `ev_files` of first-party scripts.
