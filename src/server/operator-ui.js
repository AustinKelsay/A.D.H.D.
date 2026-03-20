import fs from "node:fs";

const ASSET_ROOT = new URL("../ui/phase11/", import.meta.url);
const ASSET_CACHE = new Map();
const INDEX_FALLBACK = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ADHD Operator Console</title>
  </head>
  <body>
    <main>
      <h1>ADHD Operator Console</h1>
      <p>The Phase 11 UI assets could not be loaded on this host.</p>
    </main>
  </body>
</html>`;

function readCachedAsset(filename, {
  fallback = "",
  label = filename
} = {}) {
  if (ASSET_CACHE.has(filename)) {
    return ASSET_CACHE.get(filename);
  }

  let content = fallback;
  try {
    content = fs.readFileSync(new URL(filename, ASSET_ROOT), "utf8");
  } catch (error) {
    console.error(
      `[operator-ui] Failed to load ${label}: ${error?.message || "unknown error"}`
    );
  }

  ASSET_CACHE.set(filename, content);
  return content;
}

function getIndexTemplate() {
  return readCachedAsset("index.html", {
    fallback: INDEX_FALLBACK,
    label: "phase11 index template"
  });
}

function getAppScript() {
  return readCachedAsset("app.js", {
    fallback: "",
    label: "phase11 app script"
  });
}

function getAppStyles() {
  return readCachedAsset("styles.css", {
    fallback: "",
    label: "phase11 app styles"
  });
}

function escapeInlineJson(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => {
    if (character === "<") {
      return "\\u003c";
    }
    if (character === ">") {
      return "\\u003e";
    }
    return "\\u0026";
  });
}

function renderHtml(config) {
  return getIndexTemplate().replace(
    "__ADHD_UI_CONFIG__",
    escapeInlineJson(config)
  );
}

export function resolveOperatorUiAsset(reqUrl, {
  mode = "federation",
  apiBase = "",
  title = "ADHD Operator Console"
} = {}) {
  if (reqUrl.pathname === "/" || reqUrl.pathname === "/app" || reqUrl.pathname === "/index.html") {
    return {
      contentType: "text/html; charset=utf-8",
      cacheControl: "no-store",
      body: renderHtml({
        mode,
        apiBase,
        title,
        pollIntervalMs: 5000
      })
    };
  }

  if (reqUrl.pathname === "/ui/phase11/app.js") {
    return {
      contentType: "text/javascript; charset=utf-8",
      cacheControl: "public, max-age=300",
      body: getAppScript()
    };
  }

  if (reqUrl.pathname === "/ui/phase11/styles.css") {
    return {
      contentType: "text/css; charset=utf-8",
      cacheControl: "public, max-age=300",
      body: getAppStyles()
    };
  }

  return null;
}
