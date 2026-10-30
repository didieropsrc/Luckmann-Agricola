# Luckmann Agrícola · agro.luckmann.casa

Tienda online de semillas con **pedidos por WhatsApp** (0983 790 927), **panel de administración** (etiquetas, subetiquetas, productos, fotos y stock), **sugerencias de semillas** protegidas con **Cloudflare Turnstile**, y SEO pensado para posicionar *“San Marzano Paraguay”*.

Funciona sobre **Cloudflare Workers + Static Assets** (no Pages) con una base **D1** (gratis, sin tarjeta).

```
Navegador ──► Worker (src/worker)
               ├─ /, /categoria/*, /producto/*  → HTML renderizado en el servidor (SEO + JSON-LD)
               ├─ /api/*                         → catálogo, sugerencias, panel admin
               ├─ /img/*                         → fotos subidas desde el panel (D1 + caché)
               └─ /sitemap.xml
            Static Assets (./dist)               → JS, CSS, logo, /admin, robots.txt
```

## Estructura

```
├── wrangler.jsonc          Configuración de Cloudflare (Worker, assets, dominio, D1)
├── package.json            Scripts: dev, build, setup, deploy
├── vite.config.ts          Build del frontend → ./dist
├── index.html              Plantilla de la tienda
├── admin/index.html        Panel de administración (/admin)
├── public/                 Archivos estáticos (logo, íconos, foto del producto, robots.txt, _headers)
├── migrations/             Tablas de D1 + datos iniciales (Semillas › Tomates › San Marzano 2)
├── scripts/setup.mjs       Crea la base D1 y aplica las migraciones
└── src/
    ├── shared/             Render de páginas, formato (Gs.), tipos, textos SEO y FAQ
    ├── client/             Tienda: carrito, WhatsApp, navegación, sugerencias, estilos
    ├── admin/              Panel: productos, etiquetas, fotos, sugerencias
    └── worker/             Backend: API, sesión admin, Turnstile, SSR, imágenes
```

## Instalación y despliegue (primera vez)

Necesitás Node.js 20 o superior y una cuenta de Cloudflare con el dominio `luckmann.casa` agregado.

```bash
npm install
```

```bash
npx wrangler login
```

Crea la base de datos D1, guarda su ID en `wrangler.jsonc` y carga el producto San Marzano:

```bash
npm run setup
```

```bash
npm run deploy
```

Contraseña del panel (mínimo 8 caracteres):

```bash
npx wrangler secret put ADMIN_PASSWORD
```

### Antibots (Cloudflare Turnstile)

Cloudflare tiene su propio antibots, **Turnstile** (gratis, sin las molestias de reCAPTCHA), y es el que usa el proyecto en el formulario de sugerencias y en el login del panel.

1. En el panel de Cloudflare: **Turnstile → Add widget**, hostname `agro.luckmann.casa`, modo *Managed*.
2. Copiá la **Site Key** en `wrangler.jsonc` → `vars.TURNSTILE_SITE_KEY`.
3. Guardá la **Secret Key** como secreto:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

4. Volvé a desplegar con `npm run deploy`.

> Mientras `TURNSTILE_SITE_KEY` sea la clave de prueba (`1x00000000000000000000AA`), el antibots **no protege nada** (siempre aprueba). Si ponés una clave real y te olvidás el secreto, el formulario devuelve un error en vez de quedar desprotegido.

## Uso diario

- Tienda: https://agro.luckmann.casa
- Panel: https://agro.luckmann.casa/admin
  - **Productos**: nombre, precio en Gs., stock, descripciones, etiquetas, fotos (se comprimen solas en el navegador), visible/destacado y SEO opcional. Los botones − / + de la lista cambian el stock rápido.
  - **Etiquetas**: etiquetas y subetiquetas sin límite de niveles; cada una tiene su página `/categoria/…`.
  - **Sugerencias**: lo que la gente pidió que traigas, con enlace directo a su WhatsApp.
- Cuando confirmás una venta por WhatsApp, bajá el stock desde el panel.
- Formato de las descripciones: línea en blanco = párrafo nuevo, `- ` al inicio = viñeta, `**texto**` = negrita.

## Desarrollo local

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run dev
```

Abre http://localhost:8787 (panel en `/admin`, contraseña la de `.dev.vars`). Usa una D1 local con los mismos datos iniciales.

Despliegues siguientes: `npm run deploy` (hace el build, aplica migraciones nuevas y publica).

## Logo e isologo

Los archivos `public/logo.svg`, `public/isologo.svg` y `public/favicon.svg` son **provisorios**. Reemplazalos por los tuyos con el mismo nombre (si son PNG, cambiá la extensión en `index.html` y `admin/index.html`). También conviene regenerar `public/apple-touch-icon.png` (180×180) e `public/icon-512.png` (512×512) con tu isologo.

## SEO: cómo está hecho y qué te falta hacer

Lo que ya hace el sitio:

- Cada página se entrega **renderizada desde el servidor**, con título, descripción y URL canónica propios. Google la lee completa sin ejecutar JavaScript.
- Las palabras clave (*San Marzano Paraguay*, *tomate San Marzano*, *semillas de tomate San Marzano Paraguay*) están **en el texto visible**: el título principal, una sección “Tomate San Marzano en Paraguay” y preguntas frecuentes. **No hay texto oculto**: Google penaliza las palabras clave escondidas y te hundiría en vez de subirte.
- Datos estructurados (JSON-LD): `Product` con precio en PYG y stock, `OnlineStore` con área Paraguay, `BreadcrumbList` y `FAQPage`.
- `lang="es-PY"`, `hreflang es-PY`, metas `geo.region=PY`, `sitemap.xml` dinámico, `robots.txt`, imagen para compartir en WhatsApp y Facebook (`og-image.jpg`).

Lo que más te va a ayudar a salir primero (lo hacés vos, una vez):

1. **Google Search Console**: agregá `agro.luckmann.casa`, verificalo (es fácil con un registro DNS en Cloudflare) y enviá `https://agro.luckmann.casa/sitemap.xml`. Después pedí *Inspeccionar URL → Solicitar indexación* para la portada y el producto.
2. **Perfil de Empresa de Google** (Google Business Profile) con el sitio web y el WhatsApp. Es lo que más pesa para las búsquedas hechas desde Paraguay.
3. **Enlaces**: compartí el link del producto en grupos de Facebook de huerta y jardinería de Paraguay, Marketplace, Instagram y en tu estado de WhatsApp. Cada enlace hacia tu sitio suma.
4. Pedí a tus clientes fotos de sus plantas y subilas al producto: contenido real y nuevo ayuda mucho.

Nadie puede garantizar el primer puesto en Google, pero con poca competencia para “San Marzano Paraguay” y estos pasos, las probabilidades son muy buenas.
