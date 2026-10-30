-- Datos iniciales: Semillas > Tomates > San Marzano 2.
INSERT INTO categories (id, parent_id, name, slug, description, position) VALUES
  (1, NULL, 'Semillas', 'semillas',
   'Semillas importadas y poco comunes en Paraguay, para huerta y cultivo.', 0),
  (2, 1, 'Tomates', 'semillas-de-tomate',
   'Semillas de tomate italiano originales, entre ellas el tomate San Marzano, la variedad usada para el San Marzano D.O.P.', 0);

INSERT INTO products (id, name, slug, short_description, description, price, stock, active, featured, seo_title, seo_description) VALUES
  (1,
   'Semillas de Tomate San Marzano 2 – Variedad D.O.P.',
   'semillas-tomate-san-marzano-2',
   'Sobre original importado de Italia con 350 a 400 semillas. La variedad que se usa para el Pomodoro San Marzano D.O.P.',
   'Semillas originales de tomate **San Marzano 2**, la variedad utilizada para la producción del **Pomodoro San Marzano dell''Agro Sarnese-Nocerino D.O.P.**, el tomate italiano más famoso para salsas y pizza napolitana.

- Sobre original sellado de La Semiorto, traído directamente desde Italia.
- Cada sobre trae entre 350 y 400 semillas.
- Variedad tradicional, sin modificación genética: para los puristas del tomate italiano.
- Tomate de crecimiento indeterminado (necesita tutorado), de fruto alargado, pulpa densa y pocas semillas.
- Ideal para salsa de tomate, pelati, pizza napoletana y conservas.

Hacé tu pedido por WhatsApp y coordinamos la entrega.',
   70000, 8, 1, 1,
   'Semillas de Tomate San Marzano 2 D.O.P. en Paraguay | Luckmann Agrícola',
   'Comprá semillas de tomate San Marzano 2 originales de Italia en Paraguay. La variedad del San Marzano D.O.P., sin modificación genética. 350–400 semillas por sobre a Gs. 70.000.');

INSERT INTO product_categories (product_id, category_id) VALUES (1, 1), (1, 2);

INSERT INTO product_images (product_id, url, alt, position) VALUES
  (1, '/productos/san-marzano-2.webp',
   'Sobres de semillas de tomate San Marzano 2 de La Semiorto, importados de Italia y disponibles en Paraguay', 0);
