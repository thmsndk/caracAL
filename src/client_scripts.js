/**
 * Resolve which official client scripts caracAL should download and eval.
 *
 * Hardcoded lists lag the live index/runner and crash when game.js calls a new
 * helper unguarded (e.g. show_merrit_stand_notice). Parse the official HTML and
 * keep first-party scripts; rewrite/skip browser-only vendors.
 */

/** Official script path → caracAL resource path (fake/stub). */
const REWRITE = {
  "/js/pixi/": "/js/pixi/fake/pixi.min.js",
  "/js/codemirror/": "/js/codemirror/fake/codemirror.js",
};

/**
 * First-party / headless-safe prefixes to keep. Anything else under /js/ is
 * treated as browser chrome unless rewritten above.
 */
const KEEP_EXACT = new Set(["/data.js", "/js/libraries/combined.js"]);

const KEEP_PREFIX = ["/js/"];

/** Subpaths under /js/ that are browser-only (graphics, audio, UI chrome). */
const SKIP_PREFIX = [
  "/js/pixi/",
  "/js/pixi-layers/",
  "/js/pixi-filters/",
  "/js/socket.io/",
  "/js/jquery/",
  "/js/howler/",
  "/js/libraries/",
  "/js/codemirror/",
  "/js/ios-drag-drop",
];

/**
 * @param {string} html
 * @returns {string[]} Absolute site paths without query string, in document order.
 */
function extractScriptSrcs(html) {
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    let src = match[1].trim();
    if (!src || src.startsWith("http://") || src.startsWith("https://")) {
      continue;
    }
    const q = src.indexOf("?");
    if (q >= 0) src = src.slice(0, q);
    if (!src.startsWith("/")) src = "/" + src;
    out.push(src);
  }
  return out;
}

function rewriteOrSkip(src) {
  for (const [prefix, fake] of Object.entries(REWRITE)) {
    if (src === prefix || src.startsWith(prefix)) {
      return fake;
    }
  }
  if (KEEP_EXACT.has(src)) {
    return src;
  }
  for (const skip of SKIP_PREFIX) {
    if (src === skip || src.startsWith(skip)) {
      return null;
    }
  }
  for (const keep of KEEP_PREFIX) {
    if (src.startsWith(keep) && src.endsWith(".js")) {
      // Top-level /js/foo.js only — not nested vendor trees (already skipped).
      const rest = src.slice("/js/".length);
      if (!rest.includes("/")) {
        return src;
      }
    }
  }
  return null;
}

/**
 * Dedupe while preserving first occurrence order.
 * @param {string[]} items
 */
function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Map official index HTML script tags to caracAL game load order.
 * Always starts with pixi + combined + codemirror fakes so the VM boots even
 * if the page omits or reorders vendor tags.
 * @param {string} indexHtml
 * @returns {string[]}
 */
function resolveGameFilesFromIndexHtml(indexHtml) {
  const mapped = extractScriptSrcs(indexHtml)
    .map(rewriteOrSkip)
    .filter(Boolean);
  const requiredHead = [
    "/js/pixi/fake/pixi.min.js",
    "/js/libraries/combined.js",
    "/js/codemirror/fake/codemirror.js",
  ];
  return unique(requiredHead.concat(mapped));
}

/**
 * Map official /runner HTML script tags to caracAL runner load order.
 * @param {string} runnerHtml
 * @returns {string[]}
 */
function resolveRunnerFilesFromRunnerHtml(runnerHtml) {
  return unique(
    extractScriptSrcs(runnerHtml)
      .map(rewriteOrSkip)
      .filter(Boolean),
  );
}

module.exports = {
  extractScriptSrcs,
  rewriteOrSkip,
  resolveGameFilesFromIndexHtml,
  resolveRunnerFilesFromRunnerHtml,
  REWRITE,
  KEEP_EXACT,
  SKIP_PREFIX,
};
