// Render de las páginas públicas. Se usa en el Worker (HTML inicial, para SEO)
// y en el navegador (navegación sin recargar), así ambos producen el mismo HTML.
import type { Catalog, Category, Product, SiteConfig } from "./types";
import { escapeHtml as e, formatGs, plainText, richText, whatsappLink } from "./format";
import { DEFAULT_IMAGE, FAQ, HOME_DESCRIPTION, HOME_TITLE, SITE_NAME } from "./site";

export interface Page {
  status: number;
  title: string;
  description: string;
  path: string;
  image: string;
  html: string;
  jsonLd: object[];
}

// ---------- Árbol de etiquetas ----------

export function sortCategories(list: Category[]): Category[] {
  return [...list].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"));
}

export function childrenOf(catalog: Catalog, parentId: number | null): Category[] {
  return sortCategories(catalog.categories.filter((c) => c.parent_id === parentId));
}

export function descendantIds(catalog: Catalog, id: number): Set<number> {
  const ids = new Set<number>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of catalog.categories) {
      if (c.parent_id !== null && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function ancestors(catalog: Catalog, id: number): Category[] {
  const byId = new Map(catalog.categories.map((c) => [c.id, c]));
  const chain: Category[] = [];
  let current = byId.get(id);
  while (current && chain.length < 20) {
    chain.unshift(current);
    current = current.parent_id === null ? undefined : byId.get(current.parent_id);
  }
  return chain;
}

/** Etiqueta más específica (la más profunda) de un producto. */
export function primaryCategory(catalog: Catalog, product: Product): Category | undefined {
  let best: Category | undefined;
  let depth = -1;
  for (const id of product.category_ids) {
    const d = ancestors(catalog, id).length;
    if (d > depth) {
      depth = d;
      best = catalog.categories.find((c) => c.id === id);
    }
  }
  return best;
}

function visibleProducts(catalog: Catalog): Product[] {
  return catalog.products
    .filter((p) => p.active)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name, "es"));
}

function productsInCategory(catalog: Catalog, id: number): Product[] {
  const ids = descendantIds(catalog, id);
  return visibleProducts(catalog).filter((p) => p.category_ids.some((c) => ids.has(c)));
}

// ---------- Componentes ----------

const productUrl = (p: Product) => `/producto/${p.slug}`;
const categoryUrl = (c: Category) => `/categoria/${c.slug}`;

function abs(site: SiteConfig, url: string): string {
  return /^https?:\/\//.test(url) ? url : `${site.siteUrl}${url}`;
}

function stockBadge(p: Product): string {
  if (p.stock <= 0) return `<span class="stock stock-out">Agotado</span>`;
  if (p.stock <= 10) return `<span class="stock stock-low">${p.stock === 1 ? "¡Queda 1!" : `Quedan ${p.stock}`}</span>`;
  return `<span class="stock">En stock</span>`;
}

function addButton(p: Product, label = "Agregar al carrito"): string {
  return p.stock > 0
    ? `<button type="button" class="btn btn-primary" data-add="${p.id}">${label}</button>`
    : `<button type="button" class="btn" disabled>Agotado</button>`;
}

export function productCard(catalog: Catalog, p: Product): string {
  const img = p.images[0];
  const cat = primaryCategory(catalog, p);
  const catLabel = cat ? ancestors(catalog, cat.id).map((c) => e(c.name)).join(" › ") : "";
  return `<article class="card">
  <a class="card-media" href="${productUrl(p)}" data-link>${
    img
      ? `<img src="${e(img.url)}" alt="${e(img.alt || p.name)}" loading="lazy" decoding="async">`
      : `<span class="card-noimg" aria-hidden="true">🌱</span>`
  }</a>
  <div class="card-body">
    ${catLabel ? `<p class="eyebrow">${catLabel}</p>` : ""}
    <h3 class="card-title"><a href="${productUrl(p)}" data-link>${e(p.name)}</a></h3>
    <p class="card-desc">${e(p.short_description)}</p>
    <div class="card-foot"><span class="price">${formatGs(p.price)}</span>${stockBadge(p)}</div>
    ${addButton(p)}
  </div>
</article>`;
}

function grid(catalog: Catalog, products: Product[]): string {
  if (!products.length) {
    return `<p class="empty">Todavía no hay productos acá. ¡Pronto vamos a sumar más!</p>`;
  }
  return `<div class="grid">${products.map((p) => productCard(catalog, p)).join("")}</div>`;
}

function categoryChips(catalog: Catalog, parentId: number | null, activeId?: number): string {
  const top = childrenOf(catalog, parentId);
  if (!top.length) return "";
  const chip = (c: Category) =>
    `<a class="chip${c.id === activeId ? " chip-active" : ""}" href="${categoryUrl(c)}" data-link>${e(c.name)}</a>`;
  const items = top
    .map((c) => {
      const kids = parentId === null ? childrenOf(catalog, c.id) : [];
      return chip(c) + kids.map((k) => chip(k).replace('class="chip', 'class="chip chip-sub')).join("");
    })
    .join("");
  return `<nav class="chips" aria-label="Etiquetas">${items}</nav>`;
}

function breadcrumb(items: { name: string; url: string }[]): string {
  return `<nav class="breadcrumb" aria-label="Ruta"><ol>${items
    .map((it, i) =>
      i === items.length - 1
        ? `<li aria-current="page">${e(it.name)}</li>`
        : `<li><a href="${e(it.url)}" data-link>${e(it.name)}</a></li>`
    )
    .join("")}</ol></nav>`;
}

function breadcrumbLd(site: SiteConfig, items: { name: string; url: string }[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: abs(site, it.url),
    })),
  };
}

function storeLd(site: SiteConfig): object {
  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": `${site.siteUrl}/#store`,
    name: SITE_NAME,
    url: `${site.siteUrl}/`,
    logo: `${site.siteUrl}/logo.png`,
    image: `${site.siteUrl}${DEFAULT_IMAGE}`,
    description: HOME_DESCRIPTION,
    telephone: `+${site.whatsapp}`,
    areaServed: { "@type": "Country", name: "Paraguay" },
    address: { "@type": "PostalAddress", addressCountry: "PY" },
    contactPoint: {
      "@type": "ContactPoint",
      telephone: `+${site.whatsapp}`,
      contactType: "sales",
      areaServed: "PY",
      availableLanguage: ["es"],
    },
  };
}

// ---------- Páginas ----------

function homePage(catalog: Catalog, site: SiteConfig): Page {
  const products = visibleProducts(catalog);
  const hero = products.find((p) => p.featured) ?? products[0];
  const heroImg = hero?.images[0];
  const askText = "¡Hola Luckmann Agrícola! Quiero consultar por las semillas de tomate San Marzano.";

  const html = `
<section class="hero">
  <div class="hero-text">
    <p class="eyebrow">Semillas importadas de Italia</p>
    <h1>Semillas de Tomate San Marzano en Paraguay</h1>
    <p class="lead">El auténtico <strong>San Marzano 2</strong>, la variedad que se usa para el tomate <strong>San Marzano D.O.P.</strong>
    Sobres originales traídos directamente desde Italia, sin modificación genética. Pedís desde acá y lo confirmamos por WhatsApp.</p>
    <div class="hero-actions">
      ${hero ? `<a class="btn btn-primary btn-lg" href="${productUrl(hero)}" data-link>Ver semillas · ${formatGs(hero.price)}</a>` : ""}
      <a class="btn btn-ghost btn-lg" href="${whatsappLink(site.whatsapp, askText)}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
    </div>
  </div>
  ${
    heroImg && hero
      ? `<a class="hero-media" href="${productUrl(hero)}" data-link><img src="${e(heroImg.url)}" alt="${e(heroImg.alt || hero.name)}" fetchpriority="high"></a>`
      : ""
  }
</section>

<section class="section" id="productos">
  <div class="section-head">
    <h2>Productos</h2>
    ${categoryChips(catalog, null)}
  </div>
  ${grid(catalog, products)}
</section>

<section class="section steps" aria-labelledby="como-comprar">
  <h2 id="como-comprar">Cómo comprar</h2>
  <ol class="steps-list">
    <li><strong>Elegí</strong> tus semillas y agregalas al carrito.</li>
    <li><strong>Tocá «Pedir por WhatsApp»</strong>: se arma el mensaje con tu pedido.</li>
    <li><strong>Coordinamos</strong> pago y entrega por WhatsApp al 0983 790 927.</li>
  </ol>
</section>

<section class="section prose" aria-labelledby="san-marzano-paraguay">
  <h2 id="san-marzano-paraguay">Tomate San Marzano en Paraguay</h2>
  <p>El <strong>tomate San Marzano</strong> es el tomate italiano por excelencia: fruto alargado, pulpa densa, poca acidez y pocas semillas.
  Es el preferido para la salsa de tomate y la pizza napolitana. En Luckmann Agrícola vendemos
  <strong>semillas de tomate San Marzano en Paraguay</strong>, traídas directamente desde Italia.</p>
  <p>Nuestras semillas son de la variedad <strong>San Marzano 2</strong>, la utilizada para producir el Pomodoro San Marzano
  dell'Agro Sarnese-Nocerino D.O.P. Vienen en su sobre original sellado, importadas desde Italia y sin modificación genética,
  para quienes buscan el tomate italiano auténtico en su huerta, en cualquier parte del país.</p>
  <h3>Preguntas frecuentes</h3>
  <div class="faq">${FAQ.map((f) => `<details><summary>${e(f.q)}</summary><p>${e(f.a)}</p></details>`).join("")}</div>
</section>`;

  return {
    status: 200,
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    path: "/",
    image: DEFAULT_IMAGE,
    html,
    jsonLd: [
      storeLd(site),
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: `${site.siteUrl}/`,
        inLanguage: "es-PY",
        publisher: { "@id": `${site.siteUrl}/#store` },
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
}

function categoryPage(catalog: Catalog, site: SiteConfig, cat: Category): Page {
  const trail = [{ name: "Inicio", url: "/" }, ...ancestors(catalog, cat.id).map((c) => ({ name: c.name, url: categoryUrl(c) }))];
  const products = productsInCategory(catalog, cat.id);
  const html = `
${breadcrumb(trail)}
<section class="section">
  <div class="section-head">
    <h1>${e(cat.name)}</h1>
    ${cat.description ? `<p class="lead">${e(cat.description)}</p>` : ""}
    ${categoryChips(catalog, cat.id)}
  </div>
  ${grid(catalog, products)}
</section>`;
  const title = `${cat.name} en Paraguay | ${SITE_NAME}`;
  return {
    status: 200,
    title,
    description: plainText(cat.description || `${cat.name} disponibles en Paraguay. Pedidos por WhatsApp.`),
    path: categoryUrl(cat),
    image: products[0]?.images[0]?.url ?? DEFAULT_IMAGE,
    html,
    jsonLd: [breadcrumbLd(site, trail)],
  };
}

function productPage(catalog: Catalog, site: SiteConfig, p: Product): Page {
  const cat = primaryCategory(catalog, p);
  const trail = [
    { name: "Inicio", url: "/" },
    ...(cat ? ancestors(catalog, cat.id).map((c) => ({ name: c.name, url: categoryUrl(c) })) : []),
    { name: p.name, url: productUrl(p) },
  ];
  const main = p.images[0];
  const orderText = `¡Hola Luckmann Agrícola! Quiero pedir:\n• 1 x ${p.name} (${formatGs(p.price)})`;
  const related = cat
    ? productsInCategory(catalog, cat.parent_id ?? cat.id).filter((x) => x.id !== p.id).slice(0, 4)
    : [];

  const html = `
${breadcrumb(trail)}
<article class="product" data-product="${p.id}">
  <div class="gallery">
    <div class="gallery-main">${
      main
        ? `<img id="gallery-main" src="${e(main.url)}" alt="${e(main.alt || p.name)}" fetchpriority="high">`
        : `<span class="card-noimg" aria-hidden="true">🌱</span>`
    }</div>
    ${
      p.images.length > 1
        ? `<div class="gallery-thumbs">${p.images
            .map(
              (img, i) =>
                `<button type="button" class="thumb${i === 0 ? " thumb-active" : ""}" data-thumb="${e(img.url)}" data-alt="${e(img.alt || p.name)}" aria-label="Ver foto ${i + 1}"><img src="${e(img.url)}" alt="" loading="lazy"></button>`
            )
            .join("")}</div>`
        : ""
    }
  </div>
  <div class="product-info">
    ${cat ? `<p class="eyebrow">${ancestors(catalog, cat.id).map((c) => e(c.name)).join(" › ")}</p>` : ""}
    <h1>${e(p.name)}</h1>
    <p class="product-price"><span class="price">${formatGs(p.price)}</span> ${stockBadge(p)}</p>
    <p class="lead">${e(p.short_description)}</p>
    ${
      p.stock > 0
        ? `<div class="buy">
      <div class="qty" role="group" aria-label="Cantidad">
        <button type="button" data-qty-step="-1" aria-label="Menos">−</button>
        <input id="qty" type="number" inputmode="numeric" min="1" max="${p.stock}" value="1" aria-label="Cantidad">
        <button type="button" data-qty-step="1" aria-label="Más">+</button>
      </div>
      ${addButton(p)}
    </div>
    <a class="btn btn-whatsapp btn-block" id="buy-now" href="${whatsappLink(site.whatsapp, orderText)}" target="_blank" rel="noopener" data-buy-now="${p.id}">Pedir ahora por WhatsApp</a>`
        : `<p class="notice">Sin stock por el momento. <a href="${whatsappLink(site.whatsapp, `¡Hola! Avisame cuando vuelvan a tener: ${p.name}`)}" target="_blank" rel="noopener">Avisame cuando vuelva por WhatsApp</a>.</p>`
    }
    <div class="prose description">${richText(p.description)}</div>
  </div>
</article>
${
  related.length
    ? `<section class="section"><h2>También te puede interesar</h2>${grid(catalog, related)}</section>`
    : ""
}`;

  const brand = /semiorto/i.test(`${p.name} ${p.description}`) ? "La Semiorto" : SITE_NAME;
  return {
    status: 200,
    title: p.seo_title || `${p.name} en Paraguay | ${SITE_NAME}`,
    description: p.seo_description || plainText(`${p.short_description} ${formatGs(p.price)}. Pedidos por WhatsApp en Paraguay.`),
    path: productUrl(p),
    image: main?.url ?? DEFAULT_IMAGE,
    html,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.name,
        sku: `LA-${p.id}`,
        description: plainText(p.description, 5000),
        image: p.images.map((img) => abs(site, img.url)),
        brand: { "@type": "Brand", name: brand },
        ...(cat ? { category: ancestors(catalog, cat.id).map((c) => c.name).join(" > ") } : {}),
        offers: {
          "@type": "Offer",
          url: abs(site, productUrl(p)),
          priceCurrency: "PYG",
          price: p.price,
          availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
          areaServed: { "@type": "Country", name: "Paraguay" },
          seller: { "@id": `${site.siteUrl}/#store` },
        },
      },
      breadcrumbLd(site, trail),
      storeLd(site),
    ],
  };
}

function notFoundPage(path: string): Page {
  return {
    status: 404,
    title: `Página no encontrada | ${SITE_NAME}`,
    description: "La página que buscás no existe.",
    path,
    image: DEFAULT_IMAGE,
    html: `<section class="section notfound"><h1>No encontramos esta página</h1>
<p>Puede que el producto ya no esté disponible.</p><a class="btn btn-primary" href="/" data-link>Volver al inicio</a></section>`,
    jsonLd: [],
  };
}

export function resolveRoute(pathname: string, catalog: Catalog, site: SiteConfig): Page {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/index.html") return homePage(catalog, site);

  const cat = path.match(/^\/categoria\/([^/]+)$/);
  if (cat) {
    const found = catalog.categories.find((c) => c.slug === decodeURIComponent(cat[1]));
    return found ? categoryPage(catalog, site, found) : notFoundPage(path);
  }

  const prod = path.match(/^\/producto\/([^/]+)$/);
  if (prod) {
    const found = catalog.products.find((p) => p.active && p.slug === decodeURIComponent(prod[1]));
    return found ? productPage(catalog, site, found) : notFoundPage(path);
  }

  return notFoundPage(path);
}
