/**
 * Extract `var` / `function` declarations from the official adventure.land page
 * HTML and cache them for the game VM. Avoids hand-maintaining html_prelude.js
 * when upstream adds new page globals (e.g. proximity_guides in v5821).
 */

const PAGE_GLOBALS_MARKER = /var\s+inside\s*=\s*["']login["']/;

/**
 * @param {string} html Full index page HTML.
 * @returns {string} JS prelude safe to eval before functions.js.
 */
function extractPageGlobals(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  const block = scripts.map((m) => m[1]).find((s) => PAGE_GLOBALS_MARKER.test(s));
  if (!block) {
    throw new Error("could not find official page globals script block");
  }

  const lines = block.split("\n");
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^if\s*\(/.test(trimmed)) break;
    if (
      trimmed === "" ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("var ") ||
      trimmed.startsWith("function ")
    ) {
      out.push(line);
      continue;
    }
    if (out.length) break;
  }

  if (!out.length) {
    throw new Error("page globals script block was empty after extraction");
  }

  return out.join("\n") + "\n";
}

module.exports = { extractPageGlobals, PAGE_GLOBALS_MARKER };
