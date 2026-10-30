export interface CartLine {
  id: number;
  qty: number;
}

const KEY = "la_cart_v1";

export function loadCart(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw)
      ? raw.filter((l) => Number.isInteger(l?.id) && Number.isInteger(l?.qty) && l.qty > 0)
      : [];
  } catch {
    return [];
  }
}

export function saveCart(lines: CartLine[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* modo privado: el carrito vive solo en memoria */
  }
}
