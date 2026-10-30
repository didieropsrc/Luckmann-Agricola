import type { Env } from "./env";
import { HttpError } from "./http";

// Claves de prueba oficiales de Cloudflare (siempre aprueban). Solo para desarrollo.
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export async function verifyTurnstile(env: Env, token: unknown, ip: string): Promise<void> {
  let secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (env.TURNSTILE_SITE_KEY !== TEST_SITE_KEY) {
      throw new HttpError(500, "Falta configurar el secreto TURNSTILE_SECRET_KEY.");
    }
    secret = TEST_SECRET_KEY;
  }
  if (typeof token !== "string" || !token || token.length > 4096) {
    throw new HttpError(400, "Completá la verificación antibots.");
  }
  // La clave secreta de prueba siempre aprueba: no hace falta consultar a Cloudflare (sirve sin internet).
  if (secret === TEST_SECRET_KEY) return;

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  form.append("remoteip", ip);
  let data: { success?: boolean } = {};
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    data = await res.json();
  } catch (err) {
    console.error("Turnstile siteverify", err);
    throw new HttpError(503, "No pudimos verificar el antibots. Intentá de nuevo en un momento.");
  }
  if (!data.success) throw new HttpError(400, "La verificación antibots falló. Recargá la página e intentá de nuevo.");
}
