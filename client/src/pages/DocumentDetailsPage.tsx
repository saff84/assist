import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Loader2, 
  ArrowLeft, 
  FileText, 
  Database, 
  Table, 
  Layers, 
  Package,
  CheckCircle2,
  XCircle,
  Info,
  Code,
  Eye,
  ExternalLink,
  Tag
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";

export default function DocumentDetailsPage() {
  const [, params] = useRoute("/documents/:id");
  const documentId = params ? parseInt(params.id) : null;
  const [, setLocation] = useLocation();
  const [selectedChunkIndex, setSelectedChunkIndex] = useState<number | null>(null);
  const [selectedSectionPath, setSelectedSectionPath] = useState<string | null>(null);
  const [selectedProductSku, setSelectedProductSku] = useState<string | null>(null);

  const { data: details, isLoading, error } = trpc.document.getDocumentProcessingDetails.useQuery(
    { id: documentId! },
    { enabled: !!documentId }
  );

  if (!documentId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Document ID not provided</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="ml-2">Loading document details...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-red-500">Error loading document details: {error?.message || "Document not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { document, chunks, sections, products, statistics } = details;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/documents")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Documents
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{document.filename}</h1>
            <p className="text-sm text-muted-foreground">
              {document.fileType.toUpperCase()} • {document.fileSize.toLocaleString()} bytes
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={document.status === "indexed" ? "default" : "secondary"}>
            {document.status}
          </Badge>
          <Badge variant="outline">{document.docType}</Badge>
          <Badge variant="outline">{document.processingType}</Badge>
          {document.status === "indexed" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/documents/${documentId}/annotate`)}
                title="Разметка документа"
              >
                <Tag className="w-4 h-4 mr-2" />
                Разметка
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/documents/${documentId}/visualize`)}
                title="Визуализация документа"
              >
                <Eye className="w-4 h-4 mr-2" />
                Визуализация
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Statistics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Total Chunks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statistics.totalChunks}</div>
            <p className="text-xs text-muted-foreground">
              {statistics.chunksWithEmbeddings} with embeddings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Table className="w-4 h-4" />
              Tables
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statistics.chunksWithTables}</div>
            <p className="text-xs text-muted-foreground">chunks with table data</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Sections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statistics.totalSections}</div>
            <p className="text-xs text-muted-foreground">document sections</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="w-4 h-4" />
              Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statistics.totalTokens.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">total tokens</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="chunks" className="space-y-4">
        <TabsList>
          <TabsTrigger value="chunks">
            Chunks ({chunks.length})
          </TabsTrigger>
          <TabsTrigger value="sections">
            Sections ({sections.length})
          </TabsTrigger>
          <TabsTrigger value="products">
            Products ({products.length})
          </TabsTrigger>
        </TabsList>

        {/* Chunks Tab */}
        <TabsContent value="chunks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Document Chunks</CardTitle>
              <CardDescription>
                Detailed information about each chunk, including embeddings, tables, and metadata
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                <div className="space-y-4">
                  {chunks.map((chunk) => (
                    <Card key={chunk.id} className="border-l-4 border-l-primary">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">
                            Chunk #{chunk.chunkIndex}
                          </CardTitle>
                          <div className="flex gap-2">
                            <Badge variant="outline">{chunk.elementType}</Badge>
                            {chunk.pageNumber && (
                              <Badge variant="secondary">Page {chunk.pageNumber}</Badge>
                            )}
                          </div>
                        </div>
                        {chunk.sectionPath && (
                          <CardDescription className="text-xs">
                            Section: {chunk.sectionPath}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Content Preview */}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="w-4 h-4" />
                            <span className="text-sm font-medium">Content</span>
                            <Badge variant="outline" className="ml-auto">
                              {chunk.tokenCount} tokens
                            </Badge>
                          </div>
                          <div className="p-3 bg-muted rounded-md text-sm font-mono max-h-32 overflow-auto">
                            {chunk.contentPreview}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() => setSelectedChunkIndex(chunk.chunkIndex)}
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            Просмотреть полное содержимое
                          </Button>
                        </div>

                        {/* Embedding Info */}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Database className="w-4 h-4" />
                            <span className="text-sm font-medium">Embedding</span>
                            {chunk.embedding?.hasEmbedding ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-500 ml-auto" />
                            )}
                          </div>
                          {chunk.embedding?.hasEmbedding ? (
                            <div className="p-3 bg-muted rounded-md text-sm space-y-1">
                              <div className="flex items-center justify-between">
                                <span>Dimensions:</span>
                                <Badge variant="outline">{chunk.embedding.dimensions}</Badge>
                              </div>
                              <div className="text-xs text-muted-foreground font-mono">
                                Sample: [{chunk.embedding.sample?.join(", ")}...]
                              </div>
                            </div>
                          ) : (
                            <div className="p-3 bg-muted rounded-md text-sm text-muted-foreground">
                              No embedding generated
                              {chunk.embedding?.error && (
                                <div className="text-xs text-red-500 mt-1">
                                  Error: {chunk.embedding.error}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Table Info */}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Table className="w-4 h-4" />
                            <span className="text-sm font-medium">Table Data</span>
                            {chunk.table?.hasTable ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />
                            ) : (
                              <XCircle className="w-4 h-4 text-gray-400 ml-auto" />
                            )}
                          </div>
                          {chunk.table?.hasTable ? (
                            <div className="p-3 bg-muted rounded-md text-sm space-y-2">
                              <div className="flex items-center justify-between">
                                <span>Rows:</span>
                                <Badge variant="outline">{chunk.table.rowCount}</Badge>
                              </div>
                              <div>
                                <span className="text-xs text-muted-foreground">Columns: </span>
                                <span className="text-xs font-mono">
                                  {chunk.table.columns.join(", ")}
                                </span>
                              </div>
                              {chunk.table.sampleRows && chunk.table.sampleRows.length > 0 && (
                                <div className="mt-2">
                                  <div className="text-xs text-muted-foreground mb-1">Sample rows (first 3):</div>
                                  <div className="space-y-1 max-h-48 overflow-auto">
                                    {chunk.table.sampleRows.map((row, idx) => (
                                      <div key={idx} className="text-xs bg-background p-2 rounded border">
                                        <div className="space-y-1">
                                          {Object.entries(row).map(([key, value]) => (
                                            <div key={key} className="flex gap-2">
                                              <span className="font-semibold text-muted-foreground min-w-[120px]">{key}:</span>
                                              <span className="font-mono">{String(value)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="p-3 bg-muted rounded-md text-sm text-muted-foreground">
                              No table data
                            </div>
                          )}
                        </div>

                        {/* Metadata */}
                        {chunk.metadata && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <Info className="w-4 h-4" />
                              <span className="text-sm font-medium">Metadata</span>
                            </div>
                            <div className="p-3 bg-muted rounded-md text-sm">
                              <div className="space-y-1">
                                {chunk.metadata.section && (
                                  <div>
                                    <span className="text-muted-foreground">Section:</span>{" "}
                                    {chunk.metadata.section}
                                  </div>
                                )}
                                {chunk.metadata.heading && (
                                  <div>
                                    <span className="text-muted-foreground">Heading:</span>{" "}
                                    {chunk.metadata.heading}
                                  </div>
                                )}
                                {chunk.metadata.category && (
                                  <div>
                                    <span className="text-muted-foreground">Category:</span>{" "}
                                    <Badge variant="outline">{chunk.metadata.category}</Badge>
                                  </div>
                                )}
                                {chunk.metadata.tags && Array.isArray(chunk.metadata.tags) && (
                                  <div>
                                    <span className="text-muted-foreground">Tags:</span>{" "}
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {chunk.metadata.tags.map((tag, idx) => (
                                        <Badge key={idx} variant="secondary" className="text-xs">
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* BM25 Terms */}
                        {chunk.hasBm25Terms && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <Code className="w-4 h-4" />
                              <span className="text-sm font-medium">BM25 Terms</span>
                              <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />
                            </div>
                            <div className="p-3 bg-muted rounded-md text-sm text-muted-foreground">
                              BM25 terms indexed
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sections Tab */}
        <TabsContent value="sections" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Document Sections</CardTitle>
              <CardDescription>Table of contents and document structure</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                <div className="space-y-2">
                  {sections.map((section) => (
                    <div
                      key={section.id}
                      className="p-3 border rounded-md hover:bg-muted/50"
                      style={{ marginLeft: `${(section.level - 1) * 20}px` }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{section.title}</div>
                          <div className="text-xs text-muted-foreground">
                            Path: {section.sectionPath}
                            {section.pageStart && section.pageEnd && (
                              <> • Pages: {section.pageStart}–{section.pageEnd}</>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Level {section.level}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedSectionPath(section.sectionPath ?? null)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Products Tab */}
        <TabsContent value="products" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
              <CardDescription>Extracted products from the document</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                {products.length > 0 ? (
                  <div className="space-y-2">
                    {products.map((product) => (
                      <div key={product.id} className="p-3 border rounded-md hover:bg-muted/50">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-medium">{product.name || "Unnamed Product"}</div>
                            <div className="text-xs text-muted-foreground">
                              SKU: {product.sku}
                              {product.sectionPath && <> • Section: {product.sectionPath}</>}
                              {product.pageNumber && <> • Page: {product.pageNumber}</>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Package className="w-5 h-5 text-muted-foreground" />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedProductSku(product.sku)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        {product.attributes && (
                          <div className="mt-2 text-xs">
                            <div className="text-muted-foreground mb-1">Attributes:</div>
                            <div className="font-mono bg-muted p-2 rounded">
                              {JSON.stringify(product.attributes, null, 2)}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    No products extracted from this document
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Chunk Content Dialog */}
      {selectedChunkIndex !== null && documentId && (
        <ChunkContentDialog
          documentId={documentId}
          chunkIndex={selectedChunkIndex}
          onClose={() => setSelectedChunkIndex(null)}
        />
      )}

      {/* Section Details Dialog */}
      {selectedSectionPath !== null && documentId && (
        <SectionDetailsDialog
          documentId={documentId}
          sectionPath={selectedSectionPath}
          onClose={() => setSelectedSectionPath(null)}
        />
      )}

      {/* Product Details Dialog */}
      {selectedProductSku !== null && documentId && (
        <ProductDetailsDialog
          documentId={documentId}
          productSku={selectedProductSku}
          onClose={() => setSelectedProductSku(null)}
        />
      )}
    </div>
  );
}

// Chunk Content Dialog Component
function ChunkContentDialog({
  documentId,
  chunkIndex,
  onClose,
}: {
  documentId: number;
  chunkIndex: number;
  onClose: () => void;
}) {
  const { data: chunk, isLoading } = trpc.document.getChunkContent.useQuery(
    { documentId, chunkIndex },
    { enabled: !!documentId && chunkIndex !== null }
  );

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[50vw] max-w-[50vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Полное содержимое чанка #{chunkIndex}</DialogTitle>
          <DialogDescription>
            Документ ID: {documentId}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : chunk ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Основное содержимое:</div>
              <div className="p-4 bg-muted rounded-md font-mono text-sm whitespace-pre-wrap max-h-96 overflow-auto">
                {chunk.fullContent}
              </div>
            </div>
            {chunk.tableData && chunk.tableData.rows.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">
                  Табличные данные ({chunk.tableData.rowCount} строк):
                </div>
                <div className="border rounded-md overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        {chunk.tableData.columns.map((col) => (
                          <th key={col} className="p-2 text-left border-b">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {chunk.tableData.rows.map((row, idx) => (
                        <tr key={idx} className="border-b">
                          {chunk.tableData.columns.map((col) => (
                            <td key={col} className="p-2">
                              {String(row[col] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Раздел:</span> {chunk.sectionPath || "не указан"}
              </div>
              <div>
                <span className="font-medium">Страница:</span> {chunk.pageNumber || "не указана"}
              </div>
              <div>
                <span className="font-medium">Тип:</span> {chunk.elementType}
              </div>
              <div>
                <span className="font-medium">Токены:</span> {chunk.tokenCount}
              </div>
            </div>
            {chunk.metadata && (
              <div>
                <div className="text-sm font-medium mb-2">Метаданные:</div>
                <div className="p-4 bg-muted rounded-md font-mono text-xs overflow-auto">
                  <pre>{JSON.stringify(chunk.metadata, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            Чанк не найден
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Section Details Dialog Component
function SectionDetailsDialog({
  documentId,
  sectionPath,
  onClose,
}: {
  documentId: number;
  sectionPath: string;
  onClose: () => void;
}) {
  const { data: sectionDetails, isLoading } = trpc.document.getSectionDetails.useQuery(
    { documentId, sectionPath },
    { enabled: !!documentId && !!sectionPath }
  );

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[50vw] max-w-[50vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Детали раздела: {sectionPath}</DialogTitle>
          <DialogDescription>
            {sectionDetails?.section.title || "Загрузка..."}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : sectionDetails ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Информация о разделе:</div>
              <div className="p-4 bg-muted rounded-md space-y-2 text-sm">
                <div><span className="font-medium">Название:</span> {sectionDetails.section.title}</div>
                <div><span className="font-medium">Путь:</span> {sectionDetails.section.sectionPath}</div>
                <div><span className="font-medium">Уровень:</span> {sectionDetails.section.level}</div>
                {sectionDetails.section.pageStart && sectionDetails.section.pageEnd && (
                  <div>
                    <span className="font-medium">Страницы:</span> {sectionDetails.section.pageStart}–{sectionDetails.section.pageEnd}
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">
                Чанки в разделе ({sectionDetails.chunks.length}):
              </div>
              <div className="space-y-2 max-h-96 overflow-auto">
                {sectionDetails.chunks.map((chunk) => (
                  <div key={chunk.id} className="p-3 border rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">Чанк #{chunk.chunkIndex}</span>
                      <Badge variant="outline">{chunk.elementType}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Страница: {chunk.pageNumber || "не указана"} • Токены: {chunk.tokenCount}
                    </div>
                    <div className="p-2 bg-muted rounded text-xs font-mono max-h-32 overflow-auto whitespace-pre-wrap">
                      {chunk.content}
                    </div>
                    {chunk.tableJson && Array.isArray(chunk.tableJson) && chunk.tableJson.length > 0 && (
                      <div className="mt-2 text-xs text-green-600">
                        ✓ Содержит таблицу ({chunk.tableJson.length} строк)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {sectionDetails.products.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">
                  Продукты в разделе ({sectionDetails.products.length}):
                </div>
                <div className="space-y-2">
                  {sectionDetails.products.map((product) => (
                    <div key={product.id} className="p-3 border rounded-md text-sm">
                      <div className="font-medium">{product.name || "Unnamed Product"}</div>
                      <div className="text-xs text-muted-foreground">SKU: {product.sku}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            Раздел не найден
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Product Details Dialog Component
function ProductDetailsDialog({
  documentId,
  productSku,
  onClose,
}: {
  documentId: number;
  productSku: string;
  onClose: () => void;
}) {
  const { data: productDetails, isLoading } = trpc.document.getProductDetails.useQuery(
    { documentId, productSku },
    { enabled: !!documentId && !!productSku }
  );

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[50vw] max-w-[50vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Детали продукта: {productSku}</DialogTitle>
          <DialogDescription>
            {productDetails?.product.name || "Загрузка..."}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : productDetails ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Информация о продукте:</div>
              <div className="p-4 bg-muted rounded-md space-y-2 text-sm">
                <div><span className="font-medium">Название:</span> {productDetails.product.name || "Unnamed Product"}</div>
                <div><span className="font-medium">SKU:</span> {productDetails.product.sku}</div>
                {productDetails.product.sectionPath && (
                  <div><span className="font-medium">Раздел:</span> {productDetails.product.sectionPath}</div>
                )}
                {productDetails.product.pageNumber && (
                  <div><span className="font-medium">Страница:</span> {productDetails.product.pageNumber}</div>
                )}
                {productDetails.product.attributes && (
                  <div>
                    <span className="font-medium">Атрибуты:</span>
                    <div className="mt-2 p-2 bg-background rounded font-mono text-xs overflow-auto">
                      <pre>{JSON.stringify(productDetails.product.attributes, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">
                Чанки с информацией о продукте ({productDetails.chunks.length}):
              </div>
              <div className="space-y-2 max-h-96 overflow-auto">
                {productDetails.chunks.map((chunk) => (
                  <div key={chunk.id} className="p-3 border rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">Чанк #{chunk.chunkIndex}</span>
                      <Badge variant="outline">{chunk.elementType}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Раздел: {chunk.sectionPath || "не указан"} • Страница: {chunk.pageNumber || "не указана"} • Токены: {chunk.tokenCount}
                    </div>
                    <div className="p-2 bg-muted rounded text-xs font-mono max-h-32 overflow-auto whitespace-pre-wrap">
                      {chunk.content}
                    </div>
                    {chunk.tableJson && Array.isArray(chunk.tableJson) && chunk.tableJson.length > 0 && (
                      <div className="mt-2 text-xs text-green-600">
                        ✓ Содержит таблицу ({chunk.tableJson.length} строк)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            Продукт не найден
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

