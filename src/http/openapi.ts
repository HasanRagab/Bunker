import type { Router } from "./router";

type OpenApiRouter = Router<any, any, any>;

/** Fetch-compatible OpenAPI JSON and an in-browser documentation page. */
/**
 * Serve a generated OpenAPI document and a compact documentation page.
 * @example
 * ```ts
 * const docs = openAPIDocs(api, { title: "Users", version: "1.0.0" });
 * ```
 */
export function openAPIDocs(
  router: OpenApiRouter,
  options: { title?: string; version?: string; specPath?: string; docsPath?: string } = {},
): (req: Request) => Promise<Response> {
  const { title = "API", version = "1.0.0", specPath = "/openapi.json", docsPath = "/docs" } = options;
  const escapedSpecPath = JSON.stringify(specPath).replace(/</g, "\\u003c");
  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname === specPath) return Response.json(router.openAPI({ title, version }));
    if (url.pathname === docsPath) {
      return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} docs</title></head>` +
          `<body><h1>${escapeHtml(title)} API</h1><pre id="spec">Loading OpenAPI document…</pre>` +
          `<script>fetch(${escapedSpecPath}).then(r=>{if(!r.ok)throw new Error(r.statusText);return r.json()})` +
          `.then(x=>document.querySelector("#spec").textContent=JSON.stringify(x,null,2))` +
          `.catch(e=>document.querySelector("#spec").textContent=e.message)</script></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    return new Response("Not Found", { status: 404 });
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
