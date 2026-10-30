-- Quita de la descripción del San Marzano la frase "Hoy prácticamente no hay quien venda…".
-- Solo reemplaza esa oración; si ya la borraste desde el panel, no cambia nada.
UPDATE products
SET description = REPLACE(
      description,
      'Hoy prácticamente no hay quien venda semillas de tomate San Marzano en Paraguay: las traemos nosotros para que puedas cultivarlo en tu propia huerta.',
      ''
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE description LIKE '%Hoy prácticamente no hay quien venda%';
