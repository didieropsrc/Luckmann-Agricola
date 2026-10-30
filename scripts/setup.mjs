// Configuración inicial (una sola vez): crea la base D1 en tu cuenta de Cloudflare,
// escribe su ID en wrangler.jsonc y carga las tablas + el producto San Marzano.
// Uso: npm run setup   (antes: npx wrangler login)
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DB_NAME = "luckmann-agricola-db";
const CONFIG = "wrangler.jsonc";

const run = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });

function findDatabaseId() {
  const list = JSON.parse(run("npx wrangler d1 list --json"));
  return list.find((db) => db.name === DB_NAME)?.uuid;
}

let id = findDatabaseId();
if (id) {
  console.log(`✔ La base ${DB_NAME} ya existe (${id}).`);
} else {
  console.log(`Creando base de datos D1 «${DB_NAME}»…`);
  run(`npx wrangler d1 create ${DB_NAME} --location enam --update-config=false`);
  id = findDatabaseId();
  if (!id) throw new Error("No se pudo obtener el ID de la base recién creada.");
  console.log(`✔ Base creada (${id}).`);
}

const config = readFileSync(CONFIG, "utf8");
const updated = config.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${id}"`);
if (updated !== config) {
  writeFileSync(CONFIG, updated);
  console.log(`✔ database_id guardado en ${CONFIG}.`);
}

console.log("Aplicando migraciones en Cloudflare (tablas + datos iniciales)…");
execSync("npx wrangler d1 migrations apply DB --remote", { stdio: "inherit" });

console.log(`
Listo. Próximos pasos:
  1) npm run deploy
  2) npx wrangler secret put ADMIN_PASSWORD
  3) npx wrangler secret put TURNSTILE_SECRET_KEY
`);
