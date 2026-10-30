-- Etiquetas (categorías) con subetiquetas ilimitadas vía parent_id.
CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE products (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  short_description TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  price             INTEGER NOT NULL DEFAULT 0,  -- en guaraníes
  stock             INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  featured          INTEGER NOT NULL DEFAULT 0,
  seo_title         TEXT NOT NULL DEFAULT '',
  seo_description   TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_categories (
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
CREATE INDEX idx_product_categories_category ON product_categories(category_id);

-- Fotos de cada producto. `url` apunta a /img/<id> (subida desde el panel)
-- o a un archivo estático de /public.
CREATE TABLE product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  alt        TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_images_product ON product_images(product_id);

-- Binarios de las fotos subidas (comprimidas a WebP en el navegador, < 2 MB).
CREATE TABLE images (
  id           TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data         BLOB NOT NULL,
  size         INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Sugerencias de semillas que la gente quiere que traigas.
CREATE TABLE suggestions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL DEFAULT '',
  contact    TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL,
  ip_hash    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'nueva',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_suggestions_ip ON suggestions(ip_hash, created_at);

-- Intentos de login fallidos (para frenar fuerza bruta).
CREATE TABLE login_attempts (
  ip_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_hash, created_at);
