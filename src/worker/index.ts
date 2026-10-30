import type { Env } from "./env";
import { handleAdmin } from "./admin";
import { publicCatalog } from "./db";
import { HttpError, clientIp, ipHash, json, readJson, str } from "./http";
import { renderHtml, sitemap } from "./ssr";
import { verifyTurnstile } from "./turnstile";

async function createSuggestion(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  // Campo trampa: si un bot lo completa, respondemos "ok" sin guardar nada.
  if (typeof body.website === "string" && body.website.trim()) return json({ ok: true });

  const message = str(body.message, 1000, "Sugerencia", true);
  if (message.length < 3) throw new HttpError(400, "Contanos un poco más.");
  const name = str(body.name, 80, "Nombre");
  const contact = str(body.contact, 120, "Contacto");

  await verifyTurnstile(env, body.token, clientIp(request));

  const ip = await ipHash(request);
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM suggestions WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')"
  )
    .bind(ip)
    .first<number>("n");
  if ((recent ?? 0) >= 5) throw new HttpError(429, "Recibimos varias sugerencias tuyas recién. ¡Gracias! Probá más tarde.");

  await env.DB.prepare("INSERT INTO suggestions (name, contact, message, ip_hash) VALUES (?, ?, ?, ?)")
    .bind(name, contact, message, ip)
    .run();
  return json({ ok: true }, 201);
}

async function serveImage(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const cache = caches.default;
  const cached = await cache.match(request).catch(() => undefined);
  if (cached) return cached;

  const row = await env.DB.prepare("SELECT content_type, data FROM images WHERE id = ?")
    .bind(id)
    .first<{ content_type: string; data: ArrayBuffer | number[] }>();
  if (!row) return new Response("Imagen no encontrada", { status: 404 });

  const bytes = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
  const res = new Response(bytes, {
    headers: {
      "Content-Type": row.content_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
  ctx.waitUntil(cache.put(request, res.clone()).catch(() => {}));
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith("/api/admin/")) return await handleAdmin(request, env, path.slice("/api/admin".length));

      if (path === "/api/catalog" && request.method === "GET") {
        return json(await publicCatalog(env, ctx), 200, { "Cache-Control": "public, max-age=30" });
      }
      if (path === "/api/config" && request.method === "GET") {
        return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY, whatsapp: env.WHATSAPP_NUMBER });
      }
      if (path === "/api/suggestions" && request.method === "POST") return await createSuggestion(request, env);
      if (path.startsWith("/api/")) throw new HttpError(404, "Ruta no encontrada.");

      const img = path.match(/^\/img\/([a-f0-9]{32})$/);
      if (img && request.method === "GET") return await serveImage(request, env, ctx, img[1]);

      if (path === "/sitemap.xml") return sitemap(env, await publicCatalog(env, ctx));

      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Método no permitido", { status: 405 });
      }
      // Portada, /categoria/*, /producto/* y cualquier otra ruta (404) se renderizan en el servidor.
      return await renderHtml(request, env, await publicCatalog(env, ctx));
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Error interno. Intentá de nuevo." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
