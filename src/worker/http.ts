export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* cae al error de abajo */
  }
  throw new HttpError(400, "El cuerpo de la petición no es JSON válido.");
}

export function str(value: unknown, max: number, field: string, required = false): string {
  const s = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  if (required && !s) throw new HttpError(400, `Falta completar: ${field}.`);
  if (s.length > max) throw new HttpError(400, `${field}: máximo ${max} caracteres.`);
  return s;
}

export function int(value: unknown, min: number, max: number, field: string): number {
  const n = typeof value === "string" ? Number(value.replace(/\./g, "")) : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field}: número inválido.`);
  return n;
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash de la IP (no guardamos IPs en claro). */
export const ipHash = (request: Request) => sha256Hex(`luckmann|${clientIp(request)}`);
