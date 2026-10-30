import type { Env } from "./env";
import { HttpError } from "./http";

const COOKIE = "la_admin";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(value: string): Uint8Array {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function adminPassword(env: Env): string {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 8) {
    throw new HttpError(503, "Configurá el secreto ADMIN_PASSWORD (mínimo 8 caracteres) para usar el panel.");
  }
  return env.ADMIN_PASSWORD;
}

// La firma de la sesión deriva de la contraseña: si la cambiás, se cierran todas las sesiones.
function signingKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(`luckmann-session-v1|${adminPassword(env)}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function passwordMatches(env: Env, input: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(adminPassword(env))),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function sessionCookie(env: Env): Promise<string> {
  const payload = String(Date.now() + SESSION_SECONDS * 1000);
  const sig = await crypto.subtle.sign("HMAC", await signingKey(env), enc.encode(payload));
  return `${COOKIE}=${payload}.${b64url(sig)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export const clearSessionCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const cookie = request.headers.get("Cookie") ?? "";
  const value = cookie
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value || !env.ADMIN_PASSWORD) return false;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || !(Number(payload) > Date.now())) return false;
  try {
    return await crypto.subtle.verify("HMAC", await signingKey(env), fromB64url(sig), enc.encode(payload));
  } catch {
    return false;
  }
}
