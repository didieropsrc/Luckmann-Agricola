export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_URL: string;
  WHATSAPP_NUMBER: string;
  TURNSTILE_SITE_KEY: string;
  /** Secretos (wrangler secret put …) */
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_PASSWORD?: string;
}
