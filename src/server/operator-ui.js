import fs from "node:fs";

const ASSET_ROOT = new URL("../ui/phase11/", import.meta.url);
const INDEX_TEMPLATE = fs.readFileSync(new URL("index.html", ASSET_ROOT), "utf8");
const APP_SCRIPT = fs.readFileSync(new URL("app.js", ASSET_ROOT), "utf8");
const APP_STYLES = fs.readFileSync(new URL("styles.css", ASSET_ROOT), "utf8");

const ASSET_MAP = new Map([
  ["/ui/phase11/app.js", { contentType: "text/javascript; charset=utf-8", body: APP_SCRIPT }],
  ["/ui/phase11/styles.css", { contentType: "text/css; charset=utf-8", body: APP_STYLES }]
]);

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
  return INDEX_TEMPLATE.replace(
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

  const asset = ASSET_MAP.get(reqUrl.pathname);
  if (!asset) {
    return null;
  }

  return {
    ...asset,
    cacheControl: "public, max-age=300"
  };
}
