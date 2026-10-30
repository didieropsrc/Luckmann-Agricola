export function formatGs(value: number): string {
  const n = Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Gs. ${n}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Texto plano para meta descriptions: sin **negritas**, viñetas ni saltos. */
export function plainText(value: string, max = 160): string {
  const text = value.replace(/\*\*/g, "").replace(/^\s*-\s+/gm, "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Mini formato para descripciones cargadas desde el panel:
 * párrafos separados por línea en blanco, líneas que empiezan con "- " son viñetas
 * y **texto** es negrita. Todo se escapa antes, así que es seguro.
 */
export function richText(value: string): string {
  const inline = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return value
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => l.startsWith("- "))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
