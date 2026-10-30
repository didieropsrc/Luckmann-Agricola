import type { Catalog, SiteConfig } from "../shared/types";
import { resolveRoute } from "../shared/render";
import type { Env } from "./env";
import { SECURITY_HEADERS } from "./http";

/** JSON seguro para incrustar dentro de <script>. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const setAttr = (name: string, value: string): HTMLRewriterElementContentHandlers => ({
  element(el) {
    el.setAttribute(name, value);
  },
});

/**
 * Toma el index.html generado por Vite y le inyecta el contenido de la página,
 * título, descripción, canonical, Open Graph y datos estructurados (JSON-LD),
 * para que Google vea la página completa sin ejecutar JavaScript.
 */
export async function renderHtml(request: Request, env: Env, catalog: Catalog): Promise<Response> {
  const site: SiteConfig = { siteUrl: env.SITE_URL, whatsapp: env.WHATSAPP_NUMBER };
  const url = new URL(request.url);
  const page = resolveRoute(url.pathname, catalog, site);
  const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url)));

  const canonical = `${site.siteUrl}${page.path}`;
  const image = /^https?:/.test(page.image) ? page.image : `${site.siteUrl}${page.image}`;
  const head = [
    ...page.jsonLd.map((ld) => `<script type="application/ld+json">${scriptJson(ld)}</script>`),
    `<script>window.__CATALOG__=${scriptJson(catalog)}</script>`,
  ].join("");

  const rewriter = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(page.title) })
    .on("#meta-description", setAttr("content", page.description))
    .on("#canonical", setAttr("href", canonical))
    .on("#hreflang", setAttr("href", canonical))
    .on("#og-title", setAttr("content", page.title))
    .on("#og-description", setAttr("content", page.description))
    .on("#og-url", setAttr("content", canonical))
    .on("#og-image", setAttr("content", image))
    .on('meta[name="robots"]', setAttr("content", page.status === 200 ? "index, follow, max-image-preview:large" : "noindex"))
    .on("head", { element: (el) => void el.append(head, { html: true }) })
    .on("body", {
      element(el) {
        el.setAttribute("data-turnstile-sitekey", env.TURNSTILE_SITE_KEY);
        el.setAttribute("data-whatsapp", env.WHATSAPP_NUMBER);
      },
    })
    .on("#app", {
      element(el) {
        el.setInnerContent(page.html, { html: true });
        el.setAttribute("data-ssr", "1");
      },
    });

  return rewriter.transform(
    new Response(shell.body, {
      status: page.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Language": "es-PY",
        ...SECURITY_HEADERS,
      },
    })
  );
}

export function sitemap(env: Env, catalog: Catalog): Response {
  const urls = [
    { loc: "/", priority: "1.0" },
    ...catalog.categories.map((c) => ({ loc: `/categoria/${c.slug}`, priority: "0.7" })),
    ...catalog.products.filter((p) => p.active).map((p) => ({ loc: `/producto/${p.slug}`, priority: "0.9" })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${env.SITE_URL}${encodeURI(u.loc)}</loc><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
