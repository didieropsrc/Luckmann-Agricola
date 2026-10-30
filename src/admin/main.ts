import type { Catalog, Category, Product, ProductImage, Suggestion } from "../shared/types";
import { escapeHtml as e, formatGs } from "../shared/format";
import { childrenOf, descendantIds } from "../shared/render";
import { mountTurnstile, type Widget } from "../client/turnstile";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let catalog: Catalog = { categories: [], products: [] };
let suggestions: Suggestion[] = [];
let loginWidget: Widget | null = null;

// ---------- Utilidades ----------

let toastTimer: number | undefined;
function toast(message: string): void {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3000);
}

async function api<T = unknown>(path: string, init: { method?: string; json?: unknown; blob?: Blob } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.blob) {
    headers["Content-Type"] = init.blob.type;
    body = init.blob;
  }
  const res = await fetch(`/api/admin${path}`, { method: init.method ?? "GET", headers, body, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 && path !== "/login") showLogin();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function categoryPath(id: number): string {
  const byId = new Map(catalog.categories.map((c) => [c.id, c]));
  const names: string[] = [];
  let c = byId.get(id);
  while (c && names.length < 20) {
    names.unshift(c.name);
    c = c.parent_id === null ? undefined : byId.get(c.parent_id);
  }
  return names.join(" › ");
}

/** Lista plana del árbol de etiquetas con su profundidad, en orden. */
function flatTree(parentId: number | null = null, depth = 0): { cat: Category; depth: number }[] {
  return childrenOf(catalog, parentId).flatMap((cat) => [{ cat, depth }, ...flatTree(cat.id, depth + 1)]);
}

/** Comprime en el navegador: máx. 1600 px, WebP (o JPEG si el navegador no soporta WebP). */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const toBlob = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
  let maxSide = 1600;
  let quality = 0.85;
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob("image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg", quality);
    if (blob && blob.size <= 1_800_000) return blob;
    maxSide = Math.round(maxSide * 0.8);
    quality = Math.max(0.5, quality - 0.08);
  }
  throw new Error(`No se pudo optimizar ${file.name}.`);
}

// ---------- Sesión ----------

function showLogin(): void {
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
  if (!loginWidget) {
    fetch("/api/config")
      .then((r) => r.json() as Promise<{ turnstileSiteKey: string }>)
      .then((cfg) => mountTurnstile($("#login-turnstile"), cfg.turnstileSiteKey))
      .then((w) => (loginWidget = w));
  }
}

async function showApp(): Promise<void> {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  await Promise.all([loadCatalog(), loadSuggestions()]);
}

$<HTMLFormElement>("#login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget as HTMLFormElement;
  const msg = $("#login-msg");
  msg.className = "form-msg";
  const token = loginWidget?.token() ?? "";
  if (!token) {
    msg.textContent = "Esperá a que termine la verificación antibots.";
    msg.classList.add("error");
    return;
  }
  try {
    await api("/login", { method: "POST", json: { password: new FormData(form).get("password"), token } });
    form.reset();
    msg.textContent = "";
    await showApp();
  } catch (err) {
    msg.textContent = (err as Error).message;
    msg.classList.add("error");
  } finally {
    loginWidget?.reset();
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

// ---------- Pestañas ----------

document.querySelectorAll<HTMLElement>("[data-tab]").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    document.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
  })
);

// ---------- Productos ----------

async function loadCatalog(): Promise<void> {
  catalog = await api<Catalog>("/catalog");
  renderProducts();
  renderCategories();
}

function renderProducts(): void {
  const list = $("#products-list");
  if (!catalog.products.length) {
    list.innerHTML = `<p class="empty-box">Todavía no cargaste productos.</p>`;
    return;
  }
  list.innerHTML = `<div class="rows">${catalog.products
    .map(
      (p) => `<div class="row">
  <div class="row-thumb">${p.images[0] ? `<img src="${e(p.images[0].url)}" alt="">` : "🌱"}</div>
  <div class="row-main">
    <strong>${e(p.name)}</strong>
    <span class="muted">${p.category_ids.map((id) => e(categoryPath(id))).filter(Boolean).join(" · ") || "Sin etiqueta"}</span>
    <span class="row-tags">
      ${p.active ? "" : `<span class="tag tag-off">Oculto</span>`}
      ${p.featured ? `<span class="tag">Destacado</span>` : ""}
    </span>
  </div>
  <div class="row-num"><span class="muted">Precio</span><strong>${formatGs(p.price)}</strong></div>
  <div class="row-num"><span class="muted">Stock</span>
    <span class="qty qty-sm">
      <button type="button" data-stock="${p.id}" data-delta="-1" aria-label="Restar stock" ${p.stock <= 0 ? "disabled" : ""}>−</button>
      <strong class="${p.stock <= 0 ? "out" : ""}">${p.stock}</strong>
      <button type="button" data-stock="${p.id}" data-delta="1" aria-label="Sumar stock">+</button>
    </span>
  </div>
  <div class="row-actions">
    <a class="btn btn-sm" href="/producto/${e(p.slug)}" target="_blank" rel="noopener">Ver</a>
    <button type="button" class="btn btn-sm" data-edit-product="${p.id}">Editar</button>
    <button type="button" class="btn btn-sm btn-danger" data-delete-product="${p.id}">Eliminar</button>
  </div>
</div>`
    )
    .join("")}</div>`;
}

function productPayload(p: Product, overrides: Partial<Product> = {}) {
  const { images: _images, id: _id, ...rest } = { ...p, ...overrides };
  return rest;
}

// --- Editor ---

let editing: Product | null = null;
let images: ProductImage[] = [];
let pendingFiles: File[] = [];

function renderCategoryChecks(selected: number[]): void {
  const tree = flatTree();
  $("#product-categories").innerHTML = tree.length
    ? tree
        .map(
          ({ cat, depth }) =>
            `<label class="check" style="padding-left:${depth * 18}px"><input type="checkbox" name="category" value="${cat.id}" ${
              selected.includes(cat.id) ? "checked" : ""
            }> ${e(cat.name)}</label>`
        )
        .join("")
    : `<p class="muted">Creá etiquetas en la pestaña «Etiquetas».</p>`;
}

function renderImageGrid(): void {
  const saved = images
    .map(
      (img, i) => `<div class="image-tile">
  <img src="${e(img.url)}" alt="">
  ${i === 0 ? `<span class="tag tile-main">Principal</span>` : ""}
  <div class="tile-actions">
    <button type="button" data-move-image="${img.id}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Mover a la izquierda">←</button>
    <button type="button" data-move-image="${img.id}" data-dir="1" ${i === images.length - 1 ? "disabled" : ""} aria-label="Mover a la derecha">→</button>
    <button type="button" data-delete-image="${img.id}" aria-label="Eliminar foto">✕</button>
  </div>
  <input class="tile-alt" data-alt-image="${img.id}" value="${e(img.alt)}" placeholder="Descripción de la foto" maxlength="200" title="Texto alternativo (ayuda al SEO de Google Imágenes)">
</div>`
    )
    .join("");
  const pending = pendingFiles
    .map(
      (f, i) => `<div class="image-tile pending">
  <img src="${URL.createObjectURL(f)}" alt="">
  <span class="tag">Se sube al guardar</span>
  <div class="tile-actions"><button type="button" data-remove-pending="${i}" aria-label="Quitar">✕</button></div>
</div>`
    )
    .join("");
  $("#image-grid").innerHTML = saved + pending;
}

function openProductEditor(product: Product | null): void {
  editing = product;
  images = product ? [...product.images] : [];
  pendingFiles = [];
  const form = $<HTMLFormElement>("#product-form");
  form.reset();
  $("#product-dialog-title").textContent = product ? "Editar producto" : "Nuevo producto";
  $("#product-msg").textContent = "";
  const set = (name: string, value: string) => ((form.elements.namedItem(name) as HTMLInputElement).value = value);
  set("name", product?.name ?? "");
  set("price", product ? String(product.price) : "");
  set("stock", product ? String(product.stock) : "0");
  set("short_description", product?.short_description ?? "");
  set("description", product?.description ?? "");
  set("slug", product?.slug ?? "");
  set("seo_title", product?.seo_title ?? "");
  set("seo_description", product?.seo_description ?? "");
  (form.elements.namedItem("active") as HTMLInputElement).checked = product?.active ?? true;
  (form.elements.namedItem("featured") as HTMLInputElement).checked = product?.featured ?? false;
  renderCategoryChecks(product?.category_ids ?? []);
  renderImageGrid();
  $<HTMLDialogElement>("#product-dialog").showModal();
}

async function uploadFiles(productId: number, files: File[]): Promise<void> {
  for (const [i, file] of files.entries()) {
    $("#product-msg").textContent = `Subiendo foto ${i + 1} de ${files.length}…`;
    const blob = await compressImage(file);
    const img = await api<ProductImage>(`/products/${productId}/images`, { method: "POST", blob });
    images.push(img);
  }
}

$<HTMLFormElement>("#product-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget as HTMLFormElement;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const msg = $("#product-msg");
  msg.className = "form-msg";
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  submit.disabled = true;
  try {
    const payload = {
      name: data.get("name"),
      price: String(data.get("price") ?? "").replace(/\D/g, ""),
      stock: data.get("stock"),
      short_description: data.get("short_description"),
      description: data.get("description"),
      slug: data.get("slug"),
      seo_title: data.get("seo_title"),
      seo_description: data.get("seo_description"),
      active: data.get("active") === "on",
      featured: data.get("featured") === "on",
      category_ids: data.getAll("category").map(Number),
    };
    let id = editing?.id;
    if (id) {
      await api(`/products/${id}`, { method: "PUT", json: payload });
    } else {
      id = (await api<{ id: number }>("/products", { method: "POST", json: payload })).id;
    }
    if (pendingFiles.length) await uploadFiles(id, pendingFiles);
    pendingFiles = [];
    $<HTMLDialogElement>("#product-dialog").close();
    toast("Producto guardado ✔");
    await loadCatalog();
  } catch (err) {
    msg.textContent = (err as Error).message;
    msg.classList.add("error");
  } finally {
    submit.disabled = false;
  }
});

async function addFiles(files: FileList | File[]): Promise<void> {
  const list = [...files].filter((f) => f.type.startsWith("image/"));
  if (!list.length) return;
  if (!editing) {
    pendingFiles.push(...list);
    renderImageGrid();
    return;
  }
  try {
    await uploadFiles(editing.id, list);
    $("#product-msg").textContent = "Fotos subidas ✔";
    renderImageGrid();
    loadCatalog();
  } catch (err) {
    $("#product-msg").textContent = (err as Error).message;
  }
}

$<HTMLInputElement>("#image-input").addEventListener("change", (ev) => {
  const input = ev.currentTarget as HTMLInputElement;
  if (input.files) addFiles(input.files).finally(() => (input.value = ""));
});

const dropzone = $(".dropzone");
dropzone.addEventListener("dragover", (ev) => {
  ev.preventDefault();
  dropzone.classList.add("over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", (ev) => {
  ev.preventDefault();
  dropzone.classList.remove("over");
  if (ev.dataTransfer?.files) addFiles(ev.dataTransfer.files);
});

$("#image-grid").addEventListener("change", async (ev) => {
  const input = (ev.target as HTMLElement).closest<HTMLInputElement>("[data-alt-image]");
  if (!input) return;
  await api(`/images/${input.dataset.altImage}`, { method: "PUT", json: { alt: input.value } }).catch((err) => toast(err.message));
  const img = images.find((i) => i.id === Number(input.dataset.altImage));
  if (img) img.alt = input.value;
});

// ---------- Etiquetas ----------

function renderCategories(): void {
  const counts = new Map<number, number>();
  for (const p of catalog.products) for (const c of p.category_ids) counts.set(c, (counts.get(c) ?? 0) + 1);
  const tree = flatTree();
  $("#categories-list").innerHTML = tree.length
    ? `<div class="rows">${tree
        .map(
          ({ cat, depth }) => `<div class="row row-cat" style="--depth:${depth}">
  <div class="row-main">
    <strong>${depth ? "↳ " : ""}${e(cat.name)}</strong>
    <span class="muted">/categoria/${e(cat.slug)} · ${counts.get(cat.id) ?? 0} producto(s)</span>
  </div>
  <div class="row-actions">
    <button type="button" class="btn btn-sm" data-new-subcategory="${cat.id}">+ Subetiqueta</button>
    <button type="button" class="btn btn-sm" data-edit-category="${cat.id}">Editar</button>
    <button type="button" class="btn btn-sm btn-danger" data-delete-category="${cat.id}">Eliminar</button>
  </div>
</div>`
        )
        .join("")}</div>`
    : `<p class="empty-box">Todavía no hay etiquetas.</p>`;
}

let editingCategory: Category | null = null;

function openCategoryEditor(category: Category | null, parentId: number | null = null): void {
  editingCategory = category;
  const form = $<HTMLFormElement>("#category-form");
  form.reset();
  $("#category-msg").textContent = "";
  $("#category-dialog-title").textContent = category ? "Editar etiqueta" : parentId ? "Nueva subetiqueta" : "Nueva etiqueta";
  const blocked = category ? descendantIds(catalog, category.id) : new Set<number>();
  const parent = category ? category.parent_id : parentId;
  const select = form.elements.namedItem("parent_id") as HTMLSelectElement;
  select.innerHTML =
    `<option value="">— Etiqueta principal —</option>` +
    flatTree()
      .filter(({ cat }) => !blocked.has(cat.id))
      .map(
        ({ cat, depth }) =>
          `<option value="${cat.id}" ${cat.id === parent ? "selected" : ""}>${"  ".repeat(depth)}${depth ? "↳ " : ""}${e(cat.name)}</option>`
      )
      .join("");
  const set = (name: string, value: string) => ((form.elements.namedItem(name) as HTMLInputElement).value = value);
  set("name", category?.name ?? "");
  set("description", category?.description ?? "");
  set("position", String(category?.position ?? 0));
  set("slug", category?.slug ?? "");
  $<HTMLDialogElement>("#category-dialog").showModal();
}

$<HTMLFormElement>("#category-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget as HTMLFormElement;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (editingCategory) await api(`/categories/${editingCategory.id}`, { method: "PUT", json: data });
    else await api("/categories", { method: "POST", json: data });
    $<HTMLDialogElement>("#category-dialog").close();
    toast("Etiqueta guardada ✔");
    await loadCatalog();
  } catch (err) {
    const msg = $("#category-msg");
    msg.textContent = (err as Error).message;
    msg.className = "form-msg error";
  }
});

// ---------- Sugerencias ----------

async function loadSuggestions(): Promise<void> {
  suggestions = await api<Suggestion[]>("/suggestions");
  renderSuggestions();
}

function contactLink(contact: string): string {
  const digits = contact.replace(/\D/g, "");
  if (/@/.test(contact)) return `<a href="mailto:${e(contact)}">${e(contact)}</a>`;
  if (digits.length >= 9) {
    const intl = digits.startsWith("0") ? `595${digits.slice(1)}` : digits;
    return `<a href="https://wa.me/${intl}" target="_blank" rel="noopener">${e(contact)}</a>`;
  }
  return e(contact);
}

function renderSuggestions(): void {
  const fresh = suggestions.filter((s) => s.status === "nueva").length;
  const badge = $("#new-suggestions");
  badge.textContent = String(fresh);
  badge.hidden = fresh === 0;

  $("#suggestions-list").innerHTML = suggestions.length
    ? `<div class="rows">${suggestions
        .map(
          (s) => `<div class="row row-suggestion ${s.status === "nueva" ? "is-new" : ""}">
  <div class="row-main">
    <p class="suggestion-text">${e(s.message)}</p>
    <span class="muted">${e(s.name || "Anónimo")}${s.contact ? ` · ${contactLink(s.contact)}` : ""} · ${e(
      new Date(`${s.created_at.replace(" ", "T")}Z`).toLocaleString("es-PY")
    )}</span>
  </div>
  <div class="row-actions">
    <select data-suggestion-status="${s.id}" aria-label="Estado">
      ${["nueva", "vista", "conseguida"].map((st) => `<option ${st === s.status ? "selected" : ""}>${st}</option>`).join("")}
    </select>
    <button type="button" class="btn btn-sm btn-danger" data-delete-suggestion="${s.id}">Eliminar</button>
  </div>
</div>`
        )
        .join("")}</div>`
    : `<p class="empty-box">Todavía no llegaron sugerencias.</p>`;
}

$("#suggestions-list").addEventListener("change", async (ev) => {
  const select = (ev.target as HTMLElement).closest<HTMLSelectElement>("[data-suggestion-status]");
  if (!select) return;
  await api(`/suggestions/${select.dataset.suggestionStatus}`, { method: "PUT", json: { status: select.value } }).catch((err) =>
    toast(err.message)
  );
  await loadSuggestions();
});

// ---------- Clicks (delegación) ----------

document.addEventListener("click", async (ev) => {
  const t = ev.target as HTMLElement;
  const data = (sel: string) => t.closest<HTMLElement>(sel);
  try {
    if (data("[data-close-dialog]")) {
      t.closest("dialog")?.close();
    } else if (data("[data-new-product]")) {
      openProductEditor(null);
    } else if (data("[data-edit-product]")) {
      const id = Number(data("[data-edit-product]")!.dataset.editProduct);
      openProductEditor(catalog.products.find((p) => p.id === id) ?? null);
    } else if (data("[data-delete-product]")) {
      const id = Number(data("[data-delete-product]")!.dataset.deleteProduct);
      const p = catalog.products.find((x) => x.id === id);
      if (p && confirm(`¿Eliminar «${p.name}» y sus fotos? No se puede deshacer.`)) {
        await api(`/products/${id}`, { method: "DELETE" });
        toast("Producto eliminado");
        await loadCatalog();
      }
    } else if (data("[data-stock]")) {
      const btn = data("[data-stock]")!;
      const p = catalog.products.find((x) => x.id === Number(btn.dataset.stock));
      if (p) {
        await api(`/products/${p.id}`, { method: "PUT", json: productPayload(p, { stock: Math.max(0, p.stock + Number(btn.dataset.delta)) }) });
        await loadCatalog();
      }
    } else if (data("[data-move-image]") && editing) {
      const btn = data("[data-move-image]")!;
      const i = images.findIndex((img) => img.id === Number(btn.dataset.moveImage));
      const j = i + Number(btn.dataset.dir);
      if (i < 0 || j < 0 || j >= images.length) return;
      [images[i], images[j]] = [images[j], images[i]];
      renderImageGrid();
      await api(`/products/${editing.id}/images/order`, { method: "PUT", json: { ids: images.map((img) => img.id) } });
      loadCatalog();
    } else if (data("[data-delete-image]")) {
      const id = Number(data("[data-delete-image]")!.dataset.deleteImage);
      if (confirm("¿Eliminar esta foto?")) {
        await api(`/images/${id}`, { method: "DELETE" });
        images = images.filter((img) => img.id !== id);
        renderImageGrid();
        loadCatalog();
      }
    } else if (data("[data-remove-pending]")) {
      pendingFiles.splice(Number(data("[data-remove-pending]")!.dataset.removePending), 1);
      renderImageGrid();
    } else if (data("[data-new-category]")) {
      openCategoryEditor(null);
    } else if (data("[data-new-subcategory]")) {
      openCategoryEditor(null, Number(data("[data-new-subcategory]")!.dataset.newSubcategory));
    } else if (data("[data-edit-category]")) {
      const id = Number(data("[data-edit-category]")!.dataset.editCategory);
      openCategoryEditor(catalog.categories.find((c) => c.id === id) ?? null);
    } else if (data("[data-delete-category]")) {
      const id = Number(data("[data-delete-category]")!.dataset.deleteCategory);
      const c = catalog.categories.find((x) => x.id === id);
      const subs = descendantIds(catalog, id).size - 1;
      const warn = subs ? ` También se eliminarán sus ${subs} subetiqueta(s).` : "";
      if (c && confirm(`¿Eliminar la etiqueta «${c.name}»?${warn} Los productos no se borran.`)) {
        await api(`/categories/${id}`, { method: "DELETE" });
        toast("Etiqueta eliminada");
        await loadCatalog();
      }
    } else if (data("[data-delete-suggestion]")) {
      const id = Number(data("[data-delete-suggestion]")!.dataset.deleteSuggestion);
      if (confirm("¿Eliminar esta sugerencia?")) {
        await api(`/suggestions/${id}`, { method: "DELETE" });
        await loadSuggestions();
      }
    }
  } catch (err) {
    toast((err as Error).message);
  }
});

// ---------- Inicio ----------

api<{ authenticated: boolean }>("/me")
  .then((r) => (r.authenticated ? showApp() : showLogin()))
  .catch((err) => {
    showLogin();
    $("#login-msg").textContent = (err as Error).message;
  });
