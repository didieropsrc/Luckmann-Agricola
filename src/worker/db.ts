import type { Catalog, Category, Product, ProductImage } from "../shared/types";
import { slugify } from "../shared/format";
import type { Env } from "./env";

interface ProductRow extends Omit<Product, "active" | "featured" | "category_ids" | "images"> {
  active: number;
  featured: number;
}

export async function loadCatalog(db: D1Database, includeInactive = false): Promise<Catalog> {
  const [cats, prods, links, imgs] = await db.batch([
    db.prepare("SELECT id, parent_id, name, slug, description, position FROM categories ORDER BY position, name"),
    db.prepare(
      `SELECT id, name, slug, short_description, description, price, stock, active, featured, seo_title, seo_description
       FROM products ${includeInactive ? "" : "WHERE active = 1"} ORDER BY featured DESC, name`
    ),
    db.prepare("SELECT product_id, category_id FROM product_categories"),
    db.prepare("SELECT id, product_id, url, alt, position FROM product_images ORDER BY position, id"),
  ]);

  const categoryIds = new Map<number, number[]>();
  for (const l of links.results as { product_id: number; category_id: number }[]) {
    categoryIds.set(l.product_id, [...(categoryIds.get(l.product_id) ?? []), l.category_id]);
  }
  const images = new Map<number, ProductImage[]>();
  for (const i of imgs.results as (ProductImage & { product_id: number })[]) {
    const { product_id, ...img } = i;
    images.set(product_id, [...(images.get(product_id) ?? []), img]);
  }

  return {
    categories: cats.results as unknown as Category[],
    products: (prods.results as unknown as ProductRow[]).map((p) => ({
      ...p,
      active: p.active === 1,
      featured: p.featured === 1,
      category_ids: categoryIds.get(p.id) ?? [],
      images: images.get(p.id) ?? [],
    })),
  };
}

// ---------- Caché del catálogo público (60 s, se limpia al editar desde el panel) ----------

const CACHE_SECONDS = 60;
const cacheKey = (env: Env) => new Request(`${env.SITE_URL}/__cache/catalog-v1`);

export async function publicCatalog(env: Env, ctx: ExecutionContext): Promise<Catalog> {
  const cache = caches.default;
  const hit = await cache.match(cacheKey(env)).catch(() => undefined);
  if (hit) return hit.json();
  const catalog = await loadCatalog(env.DB);
  const res = new Response(JSON.stringify(catalog), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
  });
  ctx.waitUntil(cache.put(cacheKey(env), res).catch(() => {}));
  return catalog;
}

export async function purgeCatalogCache(env: Env): Promise<void> {
  await caches.default.delete(cacheKey(env)).catch(() => false);
}

/** Devuelve un slug libre en la tabla (agrega -2, -3… si ya existe). */
export async function uniqueSlug(
  db: D1Database,
  table: "categories" | "products",
  wanted: string,
  excludeId: number | null = null
): Promise<string> {
  const base = slugify(wanted) || (table === "products" ? "producto" : "etiqueta");
  const { results } = await db
    .prepare(`SELECT slug FROM ${table} WHERE (slug = ?1 OR slug LIKE ?1 || '-%') AND id IS NOT ?2`)
    .bind(base, excludeId)
    .all<{ slug: string }>();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
