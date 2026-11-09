-- Read-only inventory of stored document data.
SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'document_chunks', COUNT(*) FROM document_chunks
UNION ALL SELECT 'sections', COUNT(*) FROM sections
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'manual_regions', COUNT(*) FROM manual_regions
UNION ALL SELECT 'product_groups', COUNT(*) FROM product_groups
UNION ALL SELECT 'product_items', COUNT(*) FROM product_items
UNION ALL SELECT 'document_annotations', COUNT(*) FROM document_annotations
UNION ALL SELECT 'faq_entries', COUNT(*) FROM faq_entries
ORDER BY 1;
