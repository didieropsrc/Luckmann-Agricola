import type { Env } from "./env";
import { clearSessionCookie, isAuthenticated, passwordMatches, sessionCookie } from "./auth";
import { loadCatalog, purgeCatalogCache, uniqueSlug } from "./db";
import { HttpError, int, ipHash, json, readJson, str, clientIp } from "./http";
import { verifyTurnstile } from "./turnstile";
import { descendantIds } from "../shared/render";

const MAX_IMAGE_BYTES = 1_900_000; // D1 admite hasta 2 MB por valor
const IMAGE_TYPES = new Set(["image/webp", "image/jpeg", "image/png", "image/avif"]);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;

// ---------- Sesión ----------

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const ip = await ipHash(request);
  const since = Date.now() - LOGIN_WINDOW_MS;
  const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND created_at > ?")
    .bind(ip, since)
    .first<number>("n");
  if ((fails ?? 0) >= LOGIN_MAX_FAILS) {
    throw new HttpError(429, "Demasiados intentos. Probá de nuevo en 15 minutos.");
  }
  await verifyTurnstile(env, body.token, clientIp(request));

  if (!(await passwordMatches(env, str(body.password, 200, "Contraseña", true)))) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_attempts (ip_hash, created_at) VALUES (?, ?)").bind(ip, Date.now()),
      env.DB.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(Date.now() - 86_400_000),
    ]);
    throw new HttpError(401, "Contraseña incorrecta.");
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(ip).run();
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env) });
}

// ---------- Etiquetas ----------

async function categoryInput(env: Env, body: Record<string, unknown>, id: number | null) {
  const name = str(body.name, 60, "Nombre", true);
  const parentId = body.parent_id == null || body.parent_id === "" ? null : int(body.parent_id, 1, 1e9, "Etiqueta padre");
  if (parentId !== null) {
    const catalog = await loadCatalog(env.DB, true);
    if (!catalog.categories.some((c) => c.id === parentId)) throw new HttpError(400, "La etiqueta padre no existe.");
    if (id !== null && descendantIds(catalog, id).has(parentId)) {
      throw new HttpError(400, "Una etiqueta no puede estar dentro de sí misma ni de sus subetiquetas.");
    }
  }
  return {
    name,
    parentId,
    description: str(body.description, 500, "Descripción"),
    position: body.position == null || body.position === "" ? 0 : int(body.position, -1000, 1000, "Orden"),
    slug: await uniqueSlug(env.DB, "categories", str(body.slug, 80, "URL") || name, id),
  };
}

const createCategory: Handler = async (request, env) => {
  const c = await categoryInput(env, await readJson(request), null);
  const row = await env.DB.prepare(
    "INSERT INTO categories (parent_id, name, slug, description, position) VALUES (?, ?, ?, ?, ?) RETURNING id"
  )
    .bind(c.parentId, c.name, c.slug, c.description, c.position)
    .first<{ id: number }>();
  return json({ id: row!.id, slug: c.slug }, 201);
};

const updateCategory: Handler = async (request, env, [id]) => {
  const c = await categoryInput(env, await readJson(request), Number(id));
  const res = await env.DB.prepare(
    "UPDATE categories SET parent_id = ?, name = ?, slug = ?, description = ?, position = ? WHERE id = ?"
  )
    .bind(c.parentId, c.name, c.slug, c.description, c.position, Number(id))
    .run();
  if (!res.meta.changes) throw new HttpError(404, "La etiqueta no existe.");
  return json({ ok: true, slug: c.slug });
};

const deleteCategory: Handler = async (_request, env, [id]) => {
  // ON DELETE CASCADE borra también las subetiquetas; los productos quedan, solo sin esa etiqueta.
  await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(Number(id)).run();
  return json({ ok: true });
};

// ---------- Productos ----------

async function productInput(env: Env, body: Record<string, unknown>, id: number | null) {
  const name = str(body.name, 140, "Nombre", true);
  const ids = Array.isArray(body.category_ids) ? body.category_ids.map((v) => int(v, 1, 1e9, "Etiqueta")) : [];
  const existing = new Set(
    (await env.DB.prepare("SELECT id FROM categories").all<{ id: number }>()).results.map((r) => r.id)
  );
  return {
    name,
    slug: await uniqueSlug(env.DB, "products", str(body.slug, 80, "URL") || name, id),
    short_description: str(body.short_description, 300, "Descripción corta"),
    description: str(body.description, 8000, "Descripción"),
    price: int(body.price, 0, 10_000_000_000, "Precio"),
    stock: int(body.stock, 0, 1_000_000, "Stock"),
    active: body.active === false ? 0 : 1,
    featured: body.featured ? 1 : 0,
    seo_title: str(body.seo_title, 120, "Título SEO"),
    seo_description: str(body.seo_description, 300, "Descripción SEO"),
    category_ids: [...new Set(ids)].filter((c) => existing.has(c)),
  };
}

function categoryLinks(env: Env, productId: number, categoryIds: number[]): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM product_categories WHERE product_id = ?").bind(productId),
    ...categoryIds.map((c) =>
      env.DB.prepare("INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)").bind(productId, c)
    ),
  ];
}

const createProduct: Handler = async (request, env) => {
  const p = await productInput(env, await readJson(request), null);
  const row = await env.DB.prepare(
    `INSERT INTO products (name, slug, short_description, description, price, stock, active, featured, seo_title, seo_description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  )
    .bind(p.name, p.slug, p.short_description, p.description, p.price, p.stock, p.active, p.featured, p.seo_title, p.seo_description)
    .first<{ id: number }>();
  await env.DB.batch(categoryLinks(env, row!.id, p.category_ids));
  return json({ id: row!.id, slug: p.slug }, 201);
};

const updateProduct: Handler = async (request, env, [idParam]) => {
  const id = Number(idParam);
  const p = await productInput(env, await readJson(request), id);
  const [res] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE products SET name = ?, slug = ?, short_description = ?, description = ?, price = ?, stock = ?,
       active = ?, featured = ?, seo_title = ?, seo_description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(p.name, p.slug, p.short_description, p.description, p.price, p.stock, p.active, p.featured, p.seo_title, p.seo_description, id),
    ...categoryLinks(env, id, p.category_ids),
  ]);
  if (!res.meta.changes) throw new HttpError(404, "El producto no existe.");
  return json({ ok: true, slug: p.slug });
};

const uploadedImageId = (url: string) => url.match(/^\/img\/([a-f0-9]{32})$/)?.[1];

const deleteProduct: Handler = async (_request, env, [idParam]) => {
  const id = Number(idParam);
  const { results } = await env.DB.prepare("SELECT url FROM product_images WHERE product_id = ?").bind(id).all<{ url: string }>();
  const blobs = results.map((r) => uploadedImageId(r.url)).filter((v): v is string => !!v);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id),
    ...blobs.map((b) => env.DB.prepare("DELETE FROM images WHERE id = ?").bind(b)),
  ]);
  return json({ ok: true });
};

// ---------- Fotos ----------

const uploadImage: Handler = async (request, env, [idParam]) => {
  const productId = Number(idParam);
  const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
  if (!IMAGE_TYPES.has(type)) throw new HttpError(415, "Formato de imagen no soportado (usá JPG, PNG o WebP).");
  const data = await request.arrayBuffer();
  if (!data.byteLength) throw new HttpError(400, "La imagen está vacía.");
  if (data.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, "La imagen pesa más de 1,9 MB.");

  const product = await env.DB.prepare("SELECT name FROM products WHERE id = ?").bind(productId).first<{ name: string }>();
  if (!product) throw new HttpError(404, "El producto no existe.");

  const id = crypto.randomUUID().replace(/-/g, "");
  const url = `/img/${id}`;
  const position =
    ((await env.DB.prepare("SELECT MAX(position) AS p FROM product_images WHERE product_id = ?").bind(productId).first<number>("p")) ?? -1) + 1;
  const alt = position === 0 ? product.name : `${product.name} – foto ${position + 1}`;

  const [, inserted] = await env.DB.batch([
    env.DB.prepare("INSERT INTO images (id, content_type, data, size) VALUES (?, ?, ?, ?)").bind(id, type, data, data.byteLength),
    env.DB.prepare("INSERT INTO product_images (product_id, url, alt, position) VALUES (?, ?, ?, ?) RETURNING id").bind(
      productId,
      url,
      alt,
      position
    ),
  ]);
  const imageId = (inserted.results[0] as { id: number }).id;
  return json({ id: imageId, url, alt, position }, 201);
};

const reorderImages: Handler = async (request, env, [idParam]) => {
  const body = await readJson(request);
  const ids = Array.isArray(body.ids) ? body.ids.map((v) => int(v, 1, 1e12, "Foto")) : [];
  if (ids.length) {
    await env.DB.batch(
      ids.map((imgId, position) =>
        env.DB.prepare("UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?").bind(position, imgId, Number(idParam))
      )
    );
  }
  return json({ ok: true });
};

const updateImage: Handler = async (request, env, [imgId]) => {
  const body = await readJson(request);
  await env.DB.prepare("UPDATE product_images SET alt = ? WHERE id = ?")
    .bind(str(body.alt, 200, "Texto alternativo"), Number(imgId))
    .run();
  return json({ ok: true });
};

const deleteImage: Handler = async (_request, env, [imgId]) => {
  const row = await env.DB.prepare("SELECT url FROM product_images WHERE id = ?").bind(Number(imgId)).first<{ url: string }>();
  if (!row) throw new HttpError(404, "La foto no existe.");
  const blob = uploadedImageId(row.url);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM product_images WHERE id = ?").bind(Number(imgId)),
    ...(blob ? [env.DB.prepare("DELETE FROM images WHERE id = ?").bind(blob)] : []),
  ]);
  return json({ ok: true });
};

// ---------- Sugerencias ----------

const listSuggestions: Handler = async (_request, env) => {
  const { results } = await env.DB.prepare(
    "SELECT id, name, contact, message, status, created_at FROM suggestions ORDER BY created_at DESC, id DESC LIMIT 1000"
  ).all();
  return json(results);
};

const updateSuggestion: Handler = async (request, env, [id]) => {
  const body = await readJson(request);
  const status = str(body.status, 20, "Estado");
  if (!["nueva", "vista", "conseguida"].includes(status)) throw new HttpError(400, "Estado inválido.");
  await env.DB.prepare("UPDATE suggestions SET status = ? WHERE id = ?").bind(status, Number(id)).run();
  return json({ ok: true });
};

const deleteSuggestion: Handler = async (_request, env, [id]) => {
  await env.DB.prepare("DELETE FROM suggestions WHERE id = ?").bind(Number(id)).run();
  return json({ ok: true });
};

// ---------- Router ----------

const routes: [string, RegExp, Handler, boolean][] = [
  // [método, ruta, handler, ¿modifica el catálogo público?]
  ["GET", /^\/catalog$/, async (_r, env) => json(await loadCatalog(env.DB, true)), false],
  ["POST", /^\/categories$/, createCategory, true],
  ["PUT", /^\/categories\/(\d+)$/, updateCategory, true],
  ["DELETE", /^\/categories\/(\d+)$/, deleteCategory, true],
  ["POST", /^\/products$/, createProduct, true],
  ["PUT", /^\/products\/(\d+)$/, updateProduct, true],
  ["DELETE", /^\/products\/(\d+)$/, deleteProduct, true],
  ["POST", /^\/products\/(\d+)\/images$/, uploadImage, true],
  ["PUT", /^\/products\/(\d+)\/images\/order$/, reorderImages, true],
  ["PUT", /^\/images\/(\d+)$/, updateImage, true],
  ["DELETE", /^\/images\/(\d+)$/, deleteImage, true],
  ["GET", /^\/suggestions$/, listSuggestions, false],
  ["PUT", /^\/suggestions\/(\d+)$/, updateSuggestion, false],
  ["DELETE", /^\/suggestions\/(\d+)$/, deleteSuggestion, false],
];

export async function handleAdmin(request: Request, env: Env, subpath: string): Promise<Response> {
  const url = new URL(request.url);

  // Protección CSRF: las peticiones que modifican datos deben venir del mismo sitio.
  if (request.method !== "GET") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) throw new HttpError(403, "Origen no permitido.");
  }

  if (subpath === "/login" && request.method === "POST") return login(request, env);
  if (subpath === "/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie });
  }
  if (subpath === "/me") return json({ authenticated: await isAuthenticated(request, env) });

  if (!(await isAuthenticated(request, env))) throw new HttpError(401, "Iniciá sesión para continuar.");

  for (const [method, pattern, handler, mutatesCatalog] of routes) {
    const match = subpath.match(pattern);
    if (match && request.method === method) {
      const res = await handler(request, env, match.slice(1));
      if (mutatesCatalog) await purgeCatalogCache(env);
      return res;
    }
  }
  throw new HttpError(404, "Ruta no encontrada.");
}
