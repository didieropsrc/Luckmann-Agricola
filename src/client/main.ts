import type { Catalog, Product, SiteConfig } from "../shared/types";
import { escapeHtml as e, formatGs, whatsappLink } from "../shared/format";
import { resolveRoute, type Page } from "../shared/render";
import { loadCart, saveCart, type CartLine } from "./cart";
import { mountTurnstile, type Widget } from "./turnstile";

declare global {
  interface Window {
    __CATALOG__?: Catalog;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const app = $("#app");
const site: SiteConfig = {
  siteUrl: location.origin,
  whatsapp: document.body.dataset.whatsapp || "595983790927",
};
let catalog: Catalog = { categories: [], products: [] };
let cart: CartLine[] = loadCart();

// ---------- Utilidades ----------

let toastTimer: number | undefined;
function toast(message: string): void {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2600);
}

const productById = (id: number) => catalog.products.find((p) => p.id === id && p.active);

// ---------- Navegación sin recargar ----------

function setMeta(id: string, attr: string, value: string): void {
  document.getElementById(id)?.setAttribute(attr, value);
}

function applyPage(page: Page): void {
  app.innerHTML = page.html;
  document.title = page.title;
  const url = `${site.siteUrl}${page.path}`;
  const image = /^https?:/.test(page.image) ? page.image : `${site.siteUrl}${page.image}`;
  setMeta("meta-description", "content", page.description);
  setMeta("canonical", "href", url);
  setMeta("hreflang", "href", url);
  setMeta("og-title", "content", page.title);
  setMeta("og-description", "content", page.description);
  setMeta("og-url", "content", url);
  setMeta("og-image", "content", image);
}

function render(): void {
  applyPage(resolveRoute(location.pathname, catalog, site));
}

function navigate(href: string): void {
  const url = new URL(href, location.href);
  const samePage = url.pathname === location.pathname;
  if (!samePage || url.search !== location.search) {
    history.pushState(null, "", url.pathname + url.search + url.hash);
    render();
  } else if (url.hash !== location.hash) {
    history.pushState(null, "", url.hash || url.pathname);
  }
  const target = url.hash ? document.querySelector(url.hash) : null;
  if (target) target.scrollIntoView({ behavior: "smooth" });
  else if (!samePage) window.scrollTo({ top: 0 });
}

window.addEventListener("popstate", render);

// ---------- Carrito ----------

function cartLines(): { product: Product; qty: number }[] {
  return cart
    .map((l) => ({ product: productById(l.id), qty: l.qty }))
    .filter((l): l is { product: Product; qty: number } => !!l.product && l.product.stock > 0)
    .map((l) => ({ ...l, qty: Math.min(l.qty, l.product.stock) }));
}

function setCart(lines: CartLine[]): void {
  cart = lines.filter((l) => l.qty > 0);
  saveCart(cart);
  renderCart();
}

function addToCart(id: number, qty: number): void {
  const product = productById(id);
  if (!product) return;
  const current = cart.find((l) => l.id === id)?.qty ?? 0;
  const next = Math.min(current + qty, product.stock);
  if (next === current) {
    toast(`Ya tenés todo el stock disponible (${product.stock}) en el carrito.`);
    return;
  }
  setCart([...cart.filter((l) => l.id !== id), { id, qty: next }]);
  toast("Agregado al carrito ✔");
  openCart();
}

function renderCart(): void {
  const lines = cartLines();
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((n, l) => n + l.qty * l.product.price, 0);

  const badge = $("#cart-count");
  badge.textContent = String(count);
  badge.hidden = count === 0;

  $("#cart-items").innerHTML = lines
    .map(
      ({ product: p, qty }) => `<li class="cart-item">
  ${p.images[0] ? `<img src="${e(p.images[0].url)}" alt="" width="64" height="64">` : ""}
  <div class="cart-item-info">
    <p class="cart-item-name">${e(p.name)}</p>
    <p class="muted">${formatGs(p.price)} c/u</p>
    <div class="qty qty-sm">
      <button type="button" data-cart-step="-1" data-id="${p.id}" aria-label="Menos">−</button>
      <span>${qty}</span>
      <button type="button" data-cart-step="1" data-id="${p.id}" aria-label="Más" ${qty >= p.stock ? "disabled" : ""}>+</button>
    </div>
  </div>
  <div class="cart-item-side">
    <strong>${formatGs(p.price * qty)}</strong>
    <button type="button" class="btn-link" data-cart-remove="${p.id}">Quitar</button>
  </div>
</li>`
    )
    .join("");
  $("#cart-total").textContent = formatGs(total);
  $("#cart-empty").hidden = lines.length > 0;
  $("#cart-checkout").hidden = lines.length === 0;
}

function openCart(): void {
  const drawer = $("#cart");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  $(".drawer-backdrop").hidden = false;
  drawer.focus();
}

function closeCart(): void {
  const drawer = $("#cart");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  $(".drawer-backdrop").hidden = true;
}

function orderMessage(form: FormData): string {
  const lines = cartLines();
  const total = lines.reduce((n, l) => n + l.qty * l.product.price, 0);
  const field = (k: string) => String(form.get(k) ?? "").trim();
  const rows: (string | false)[] = [
    "¡Hola Luckmann Agrícola! 👋 Quiero hacer este pedido:",
    "",
    ...lines.map((l) => `• ${l.qty} x ${l.product.name} — ${formatGs(l.qty * l.product.price)}`),
    "",
    `*Total: ${formatGs(total)}*`,
    "",
    `Nombre: ${field("name")}`,
    !!field("city") && `Ciudad/barrio: ${field("city")}`,
    `Entrega: ${field("delivery")}`,
    !!field("note") && `Comentario: ${field("note")}`,
    "",
    `(Pedido hecho en ${location.host})`,
  ];
  return rows.filter((r): r is string => r !== false).join("\n");
}

// ---------- Página de producto ----------

function qtyInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>("#qty");
}

function syncBuyNow(): void {
  const link = document.querySelector<HTMLAnchorElement>("#buy-now");
  const input = qtyInput();
  if (!link || !input) return;
  const product = productById(Number(link.dataset.buyNow));
  if (!product) return;
  const qty = Math.max(1, Math.min(Number(input.value) || 1, product.stock));
  link.href = whatsappLink(
    site.whatsapp,
    `¡Hola Luckmann Agrícola! Quiero pedir:\n• ${qty} x ${product.name} — ${formatGs(qty * product.price)}`
  );
}

// ---------- Eventos ----------

document.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;

  const link = target.closest<HTMLAnchorElement>("a[data-link]");
  if (link && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && link.origin === location.origin) {
    ev.preventDefault();
    closeCart();
    navigate(link.href);
    return;
  }

  const add = target.closest<HTMLElement>("[data-add]");
  if (add) {
    const id = Number(add.dataset.add);
    const onProductPage = add.closest(`[data-product="${id}"]`);
    const qty = onProductPage ? Math.max(1, Number(qtyInput()?.value) || 1) : 1;
    addToCart(id, qty);
    return;
  }

  const step = target.closest<HTMLElement>("[data-qty-step]");
  if (step) {
    const input = qtyInput();
    if (input) {
      const max = Number(input.max) || 1;
      input.value = String(Math.max(1, Math.min(max, (Number(input.value) || 1) + Number(step.dataset.qtyStep))));
      syncBuyNow();
    }
    return;
  }

  const thumb = target.closest<HTMLElement>("[data-thumb]");
  if (thumb) {
    const main = document.querySelector<HTMLImageElement>("#gallery-main");
    if (main) {
      main.src = thumb.dataset.thumb!;
      main.alt = thumb.dataset.alt ?? "";
    }
    document.querySelectorAll(".thumb").forEach((t) => t.classList.toggle("thumb-active", t === thumb));
    return;
  }

  if (target.closest("[data-open-cart]")) return openCart();
  if (target.closest("[data-close-cart]")) return closeCart();

  const cartStep = target.closest<HTMLElement>("[data-cart-step]");
  if (cartStep) {
    const id = Number(cartStep.dataset.id);
    const delta = Number(cartStep.dataset.cartStep);
    setCart(cart.map((l) => (l.id === id ? { ...l, qty: Math.min(l.qty + delta, productById(id)?.stock ?? 0) } : l)));
    return;
  }

  const remove = target.closest<HTMLElement>("[data-cart-remove]");
  if (remove) {
    setCart(cart.filter((l) => l.id !== Number(remove.dataset.cartRemove)));
  }
});

document.addEventListener("input", (ev) => {
  if ((ev.target as HTMLElement).id === "qty") syncBuyNow();
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeCart();
});

$("#cart-clear").addEventListener("click", () => {
  setCart([]);
  toast("Carrito vacío");
});

$<HTMLFormElement>("#checkout-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget as HTMLFormElement;
  if (!form.reportValidity() || !cartLines().length) return;
  const url = whatsappLink(site.whatsapp, orderMessage(new FormData(form)));
  // Con "noopener" window.open siempre devuelve null, así que cortamos el opener a mano.
  const win = window.open(url, "_blank");
  if (win) win.opener = null;
  else location.href = url; // ventana emergente bloqueada
  toast("Abrimos WhatsApp con tu pedido. ¡Solo tocá enviar!");
});

// ---------- Sugerencias de semillas ----------

let suggestWidget: Widget | null = null;

async function initSuggestions(): Promise<void> {
  const form = $<HTMLFormElement>("#suggest-form");
  const msg = $("#suggest-msg");
  const sitekey = document.body.dataset.turnstileSitekey;
  if (sitekey) {
    mountTurnstile($("#suggest-turnstile"), sitekey).then((w) => (suggestWidget = w));
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const message = String(data.get("message") ?? "").trim();
    msg.className = "form-msg";
    if (message.length < 3) {
      msg.textContent = "Contanos qué semillas te gustaría conseguir.";
      msg.classList.add("error");
      return;
    }
    const token = suggestWidget?.token() ?? "";
    if (!token) {
      msg.textContent = "Esperá un segundo a que se complete la verificación antibots y volvé a intentar.";
      msg.classList.add("error");
      return;
    }
    const button = form.querySelector("button")!;
    button.disabled = true;
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          name: data.get("name"),
          contact: data.get("contact"),
          website: data.get("website"),
          token,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "No se pudo enviar.");
      form.reset();
      msg.textContent = "¡Gracias! Recibimos tu sugerencia. 🌱";
      msg.classList.add("ok");
    } catch (err) {
      msg.textContent = (err as Error).message;
      msg.classList.add("error");
    } finally {
      button.disabled = false;
      suggestWidget?.reset();
    }
  });
}

// ---------- Inicio ----------

async function init(): Promise<void> {
  $("#year").textContent = String(new Date().getFullYear());
  if (window.__CATALOG__) {
    catalog = window.__CATALOG__;
  } else {
    catalog = await fetch("/api/catalog").then((r) => r.json() as Promise<Catalog>);
  }
  // Si el servidor ya pintó la página (SSR) no hace falta volver a renderizar.
  if (!app.dataset.ssr) render();
  renderCart();
  initSuggestions();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}

init();
