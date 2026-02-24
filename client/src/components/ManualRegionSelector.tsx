import { useState, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Trash2, Square, Move, FileText, Table, Image, List, Tag, X, ZoomIn, ZoomOut, Grid3x3, Layers, Plus } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import * as pdfjsLib from "pdfjs-dist";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Configure PDF.js worker - use local worker from public directory (avoids CORS issues)
// Worker is copied to public directory during build by Vite plugin
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface Point {
  x: number;
  y: number;
}

interface RegionBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Region {
  id?: number;
  points: Point[];
  normalizedPoints?: Point[];
  bbox?: RegionBoundingBox;
  normalizedBBox?: RegionBoundingBox;
  pageDimensions?: {
    width: number;
    height: number;
  };
  scaleAtCapture?: number;
  type:
    | "text"
    | "table"
    | "technical_table"
    | "table_with_articles"
    | "figure"
    | "list"
    | "faq_question"
    | "faq_answer"
    | "certificate_answer";
  isNomenclatureTable?: boolean;
  productGroupId?: number | null;
  productItemId?: number | null;
  qaPairId?: number | null;
  notes?: string;
  pageNumber: number;
}

interface PageMetrics {
  displayWidth: number;
  displayHeight: number;
  baseWidth: number;
  baseHeight: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

interface ManualRegionSelectorProps {
  documentId: number;
  filename: string;
  onRegionsCreated?: () => void;
}

export default function ManualRegionSelector({ documentId, filename, onRegionsCreated }: ManualRegionSelectorProps) {
  // Fetch document to get page count
  const { data: document } = trpc.document.getDocument.useQuery(
    { id: documentId },
    { enabled: documentId > 0 }
  );

  const docType = document?.docType ?? "general";
  const isWarrantyFaqMode = docType === "warranty_faq";
  const isCertificateMode = docType === "certificate";
  const isPassportMode = docType === "passport";
  const requireProductGroupForChunk = !(isWarrantyFaqMode || isCertificateMode || isPassportMode);

  const [docTitle, setDocTitle] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(document?.pages || 1);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [drawingMode, setDrawingMode] = useState<"rectangle" | "polygon" | "none">("rectangle");
  const [regionType, setRegionType] = useState<
    | "text"
    | "table"
    | "technical_table"
    | "table_with_articles"
    | "figure"
    | "list"
    | "faq_question"
    | "faq_answer"
    | "certificate_answer"
  >("text");
  const [isNomenclatureTable, setIsNomenclatureTable] = useState(false);
  const [productGroupId, setProductGroupId] = useState<number | null>(null);
  const [productItemId, setProductItemId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [passportSubheading, setPassportSubheading] = useState("");
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [scale, setScale] = useState(1);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageMetrics, setPageMetrics] = useState<PageMetrics | null>(null);
  const [selectedRegionIdsForChunk, setSelectedRegionIdsForChunk] = useState<number[]>([]);
  const [chunkTitle, setChunkTitle] = useState("");
  const [chunkProductGroupId, setChunkProductGroupId] = useState<number | null>(null);
  const [chunkProductItemId, setChunkProductItemId] = useState<number | null>(null);
  const [faqCurrentPairId, setFaqCurrentPairId] = useState<number>(1);
  const [faqRole, setFaqRole] = useState<"question" | "answer">("question");
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [isCreateItemDialogOpen, setIsCreateItemDialogOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemDescription, setNewItemDescription] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // Sync total pages from document metadata when available
  useEffect(() => {
    if (document?.pages && document.pages > 0) {
      setTotalPages(document.pages);
    }
  }, [document?.pages]);

  // Fetch manual regions
  const { data: savedRegions, refetch: refetchRegions } = trpc.document.getDocumentManualRegions.useQuery(
    { documentId },
    { enabled: documentId > 0 }
  );

  const passportSubheadings = useMemo(() => {
    if (!savedRegions) return [];
    const set = new Set<string>();
    for (const r of savedRegions) {
      const value = (r.notes ?? "").trim();
      if (value) set.add(value);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [savedRegions]);

  // Fetch product groups
  const { data: productGroups, refetch: refetchProductGroups } = trpc.document.getDocumentProductGroups.useQuery(
    { documentId },
    { enabled: documentId > 0 }
  );
  const hasProductGroups = (productGroups?.length ?? 0) > 0;

  // Fetch product items for selected group (catalog manual flow)
  const selectedGroupForItems = chunkProductGroupId ?? productGroupId;
  const { data: productItems, refetch: refetchProductItems } =
    trpc.document.getProductItemsByGroup.useQuery(
      {
        documentId,
        groupId: selectedGroupForItems ?? 0,
      },
      { enabled: documentId > 0 && typeof selectedGroupForItems === "number" && selectedGroupForItems > 0 }
    );
  const hasProductItems = (productItems?.length ?? 0) > 0;

  useEffect(() => {
    if (!productGroups) {
      if (chunkProductGroupId !== null) {
        setChunkProductGroupId(null);
      }
      return;
    }
    if (productGroups.length === 1 && !chunkProductGroupId) {
      setChunkProductGroupId(productGroups[0].id);
      return;
    }
    if (chunkProductGroupId && !productGroups.some((group) => group.id === chunkProductGroupId)) {
      setChunkProductGroupId(null);
    }
  }, [productGroups, chunkProductGroupId]);

  const totalSavedRegions = savedRegions?.length ?? 0;

  const updateTitleMutation = trpc.document.updateDocumentTitle.useMutation({
    onSuccess: () => {
      toast.success("Название сохранено");
    },
    onError: (error) => {
      toast.error(error.message || "Не удалось сохранить название");
    },
  });

  useEffect(() => {
    const title = document?.title ? String(document.title) : "";
    setDocTitle((prev) => (prev.trim().length > 0 ? prev : title));
    // Prefill chunk title from document title only for certificate (passport uses subheadings)
    if (isCertificateMode && (!chunkTitle || chunkTitle.trim().length === 0) && title.trim().length > 0) {
      setChunkTitle(title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.title, isCertificateMode]);

  // Create region mutation
  const createRegionMutation = trpc.document.createManualRegion.useMutation({
    onSuccess: () => {
      toast.success("Область сохранена");
      refetchRegions();
      setSelectedRegion(null);
      setCurrentPoints([]);
      setIsDrawing(false);
    },
    onError: (error) => {
      toast.error(error.message || "Ошибка сохранения области");
    },
  });

  // Update region mutation
  const updateRegionMutation = trpc.document.updateManualRegion.useMutation({
    onSuccess: () => {
      toast.success("Область обновлена");
      refetchRegions();
      setSelectedRegion(null);
    },
    onError: (error) => {
      toast.error(error.message || "Ошибка обновления области");
    },
  });

  // Delete region mutation
  const deleteRegionMutation = trpc.document.deleteManualRegion.useMutation({
    onSuccess: () => {
      toast.success("Область удалена");
      refetchRegions();
      setSelectedRegion(null);
    },
    onError: (error) => {
      toast.error(error.message || "Ошибка удаления области");
    },
  });

  const generateChunksMutation = trpc.document.generateChunksFromManualRegions.useMutation({
    onSuccess: (result) => {
      toast.success(`Создано чанков: ${result.createdChunks}`);
      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach((warning) => toast.warning(warning));
      }
      refetchRegions();
      onRegionsCreated?.();
    },
    onError: (error) => {
      toast.error(error.message || "Не удалось создать чанки");
    },
  });

  const generateProductItemChunksMutation =
    trpc.document.generateChunksFromManualProductItems.useMutation({
      onSuccess: (result) => {
        toast.success(`Создано товарных чанков: ${result.createdChunks}`);
        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach((warning: string) => toast.warning(warning));
        }
        refetchRegions();
        onRegionsCreated?.();
      },
      onError: (error) => {
        toast.error(error.message || "Не удалось создать товарные чанки");
      },
    });

  const generateWarrantyFaqChunksMutation = trpc.document.generateWarrantyFaqChunksFromManualRegions.useMutation({
    onSuccess: (result) => {
      toast.success(`Создано FAQ-чанков: ${result.createdChunks}`);
      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach((warning: string) => toast.warning(warning));
      }
      refetchRegions();
      onRegionsCreated?.();
    },
    onError: (error) => {
      toast.error(error.message || "Не удалось создать FAQ-чанки");
    },
  });

  const generateSelectedChunkMutation = trpc.document.generateChunkFromSelectedRegions.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.createdChunkIndex !== undefined
          ? `Создан чанк #${result.createdChunkIndex}`
          : "Чанк создан"
      );
      setSelectedRegionIdsForChunk([]);
      setChunkTitle("");
      setChunkProductGroupId((prev) => {
        if (productGroups && productGroups.length === 1) {
          return productGroups[0].id;
        }
        return null;
      });
      refetchRegions();
      onRegionsCreated?.();
      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach((warning: string) => toast.warning(warning));
      }
    },
    onError: (error) => {
      toast.error(error.message || "Не удалось создать чанк из выбранных областей");
    },
  });

  const createGroupMutation = trpc.document.createProductGroup.useMutation({
    onSuccess: (result) => {
      toast.success("Товарная группа создана");
      refetchProductGroups();
      setChunkProductGroupId(result.groupId);
      setIsCreateGroupDialogOpen(false);
      setNewGroupName("");
      setNewGroupDescription("");
    },
    onError: (error) => {
      toast.error(error.message || "Ошибка создания группы");
    },
  });

  const createItemMutation = trpc.document.createProductItem.useMutation({
    onSuccess: (result) => {
      toast.success("Товар создан");
      refetchProductItems();
      setChunkProductItemId(result.itemId);
      setProductItemId(result.itemId);
      setIsCreateItemDialogOpen(false);
      setNewItemName("");
      setNewItemDescription("");
    },
    onError: (error) => {
      toast.error(error.message || "Ошибка создания товара");
    },
  });

  const computeRegionGeometry = (points: Point[]) => {
    if (!points.length) {
      return {};
    }

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    const bbox: RegionBoundingBox = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    if (!pageMetrics) {
      return { bbox };
    }

    const normalizedPoints = points.map((point) => ({
      x: clamp(point.x / pageMetrics.displayWidth, 0, 1),
      y: clamp(point.y / pageMetrics.displayHeight, 0, 1),
    }));

    const normalizedBBox: RegionBoundingBox = {
      x: clamp(bbox.x / pageMetrics.displayWidth, 0, 1),
      y: clamp(bbox.y / pageMetrics.displayHeight, 0, 1),
      width: clamp(bbox.width / pageMetrics.displayWidth, 0, 1),
      height: clamp(bbox.height / pageMetrics.displayHeight, 0, 1),
    };

    return {
      bbox,
      normalizedPoints,
      normalizedBBox,
      pageDimensions: {
        width: pageMetrics.baseWidth,
        height: pageMetrics.baseHeight,
      },
      scaleAtCapture: scale,
    };
  };

  // Load saved regions
  useEffect(() => {
    if (savedRegions) {
      const pageRegions = savedRegions
        .filter((r) => r.pageNumber === currentPage)
        .map((r) => ({
          id: r.id,
          points: (r.coordinates as any)?.points || [],
          normalizedPoints: (r.coordinates as any)?.normalizedPoints,
          bbox: (r.coordinates as any)?.bbox,
          normalizedBBox: (r.coordinates as any)?.normalizedBBox,
          pageDimensions: (r.coordinates as any)?.pageDimensions,
          scaleAtCapture: (r.coordinates as any)?.scaleAtCapture,
          type: r.regionType,
          isNomenclatureTable: r.isNomenclatureTable,
          productGroupId: r.productGroupId,
          productItemId: (r as any).productItemId ?? null,
          qaPairId: r.qaPairId ?? null,
          notes: r.notes || "",
          pageNumber: r.pageNumber,
        }));
      setRegions(pageRegions);
    }
  }, [savedRegions, currentPage]);

  useEffect(() => {
    if (!isWarrantyFaqMode || !savedRegions) return;
    const maxPair = Math.max(
      0,
      ...savedRegions.map((r) => (typeof r.qaPairId === "number" ? r.qaPairId : 0))
    );
    setFaqCurrentPairId((prev) => (prev > 0 ? prev : 1));
    if (maxPair >= faqCurrentPairId) {
      setFaqCurrentPairId(maxPair + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWarrantyFaqMode, savedRegions]);

  useEffect(() => {
    if (!savedRegions) {
      setSelectedRegionIdsForChunk([]);
      return;
    }
    const validIds = new Set(
      savedRegions
        .map((region) => region.id)
        .filter((id): id is number => typeof id === "number")
    );
    setSelectedRegionIdsForChunk((prev) =>
      prev.filter((id) => validIds.has(id))
    );
  }, [savedRegions]);

  const selectedRegionsForChunk = useMemo(() => {
    if (!savedRegions || selectedRegionIdsForChunk.length === 0) return [];
    const selectionSet = new Set(selectedRegionIdsForChunk);
    return savedRegions.filter(
      (region) => region.id && selectionSet.has(region.id)
    );
  }, [savedRegions, selectedRegionIdsForChunk]);

  // Draw regions on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw all regions (scale by 2 for high DPI canvas)
      regions.forEach((region, index) => {
        // Check if selected by comparing both id and reference (for new regions without id)
        const isSelected =
          selectedRegion === region ||
          Boolean(selectedRegion?.id && region.id && selectedRegion.id === region.id);
        drawRegion(ctx, region, isSelected, getRegionColor(region.type), 2);
      });

      // Draw current drawing (polygon doesn't toggle isDrawing reliably on some browsers)
      if (currentPoints.length > 0 && (isDrawing || drawingMode === "polygon")) {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 4; // 2x for high DPI
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        currentPoints.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        if (drawingMode === "rectangle" && currentPoints.length === 2) {
          const [p1, p2] = currentPoints;
          ctx.rect(
            Math.min(p1.x, p2.x),
            Math.min(p1.y, p2.y),
            Math.abs(p2.x - p1.x),
            Math.abs(p2.y - p1.y)
          );
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
  }, [regions, selectedRegion, isDrawing, currentPoints, drawingMode]);

  const drawRegion = (
    ctx: CanvasRenderingContext2D,
    region: Region,
    isSelected: boolean,
    color: string,
    scaleFactor: number = 1
  ) => {
    if (region.points.length < 2) return;

    ctx.strokeStyle = color;
    ctx.fillStyle = color + "40"; // Add transparency
    ctx.lineWidth = (isSelected ? 3 : 2) * scaleFactor;

    ctx.beginPath();
    // Always draw as polygon (works for both rectangle and polygon)
    region.points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x * scaleFactor, point.y * scaleFactor);
      } else {
        ctx.lineTo(point.x * scaleFactor, point.y * scaleFactor);
      }
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw label
    if (region.points.length > 0) {
      const firstPoint = region.points[0];
      ctx.fillStyle = color;
      ctx.font = `${12 * scaleFactor}px sans-serif`;
      ctx.fillText(
        getRegionTypeLabel(region.type),
        firstPoint.x * scaleFactor + 5 * scaleFactor,
        firstPoint.y * scaleFactor - 5 * scaleFactor
      );
    }
  };

  const toggleRegionForChunk = (regionId: number, shouldSelect: boolean) => {
    setSelectedRegionIdsForChunk((prev) => {
      const next = new Set(prev);
      if (shouldSelect) {
        next.add(regionId);
      } else {
        next.delete(regionId);
      }
      return Array.from(next);
    });
  };

  const handleGenerateChunkFromSelection = () => {
    if (selectedRegionIdsForChunk.length === 0) return;

    if (isPassportMode) {
      const passportName = docTitle.trim();
      if (passportName.length === 0) {
        toast.error("Укажите название паспорта (вверху) перед созданием чанков");
        return;
      }

      const subheadingSet = new Set<string>();
      let hasMissingSubheading = false;
      for (const region of selectedRegionsForChunk) {
        const sub = (region.notes ?? "").trim();
        if (!sub) {
          hasMissingSubheading = true;
          continue;
        }
        subheadingSet.add(sub);
      }

      if (hasMissingSubheading) {
        toast.error("Для паспорта у каждой выбранной области должен быть подзаголовок");
        return;
      }
      if (subheadingSet.size === 0) {
        toast.error("Выберите области с подзаголовком");
        return;
      }
      if (subheadingSet.size > 1) {
        toast.error("Выберите области только одного подзаголовка для одного чанка");
        return;
      }

      const [subheading] = Array.from(subheadingSet);
      generateSelectedChunkMutation.mutate({
        documentId,
        regionIds: selectedRegionIdsForChunk,
        // For passports, pass only the subheading; backend will combine with passport title.
        chunkTitle: subheading,
      });
      return;
    }

    if (isCertificateMode && chunkTitle.trim().length === 0) {
      toast.error("Укажите название сертификата перед созданием чанка");
      return;
    }
    generateSelectedChunkMutation.mutate({
      documentId,
      regionIds: selectedRegionIdsForChunk,
      chunkTitle: chunkTitle.trim() || undefined,
      productGroupId: requireProductGroupForChunk ? chunkProductGroupId ?? undefined : undefined,
    });
  };

  const handleCreateProductGroup = () => {
    if (!newGroupName.trim()) {
      toast.error("Введите название группы");
      return;
    }
    createGroupMutation.mutate({
      documentId,
      name: newGroupName.trim(),
      description: newGroupDescription.trim() || undefined,
    });
  };

  const getRegionColor = (type: string): string => {
    switch (type) {
      case "table":
      case "technical_table":
      case "table_with_articles":
        return "#3b82f6"; // blue
      case "figure":
        return "#a855f7"; // purple
      case "list":
        return "#f97316"; // orange
      case "faq_question":
        return "#0ea5e9"; // sky
      case "faq_answer":
        return "#22c55e"; // green
      case "certificate_answer":
        return "#f59e0b"; // amber
      default:
        return "#6b7280"; // gray
    }
  };

  const getRegionTypeLabel = (type: string): string => {
    switch (type) {
      case "table":
        return "Таблица";
      case "technical_table":
        return "Таблица тех. характеристик";
      case "table_with_articles":
        return "Таблица с артикулами";
      case "figure":
        return "Рисунок";
      case "list":
        return "Список";
      case "faq_question":
        return "FAQ: Вопрос";
      case "faq_answer":
        return "FAQ: Ответ";
      case "certificate_answer":
        return "Сертификат: Ответ";
      default:
        return "Текст";
    }
  };

  // Check if point is inside region (using ray casting algorithm)
  const isPointInRegion = (point: Point, points: Point[]): boolean => {
    if (points.length < 3) return false;

    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;

      const intersect =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const finalizePolygon = () => {
    if (currentPoints.length < 3) {
      toast.error("Для многоугольника нужно минимум три точки");
      setCurrentPoints([]);
      setIsDrawing(false);
      return;
    }

    const polygonPoints = currentPoints.map((p) => ({ x: p.x / 2, y: p.y / 2 }));
    const geometry = computeRegionGeometry(polygonPoints);
    const effectiveType: Region["type"] = isWarrantyFaqMode
      ? (faqRole === "question" ? "faq_question" : "faq_answer")
      : isCertificateMode
        ? "certificate_answer"
        : regionType;

    const newRegion: Region = {
      points: polygonPoints,
      normalizedPoints: geometry.normalizedPoints,
      bbox: geometry.bbox,
      normalizedBBox: geometry.normalizedBBox,
      pageDimensions: geometry.pageDimensions,
      scaleAtCapture: geometry.scaleAtCapture,
      type: effectiveType,
      isNomenclatureTable,
      productGroupId,
      productItemId: isWarrantyFaqMode || isCertificateMode || isPassportMode ? null : productItemId,
      qaPairId: isWarrantyFaqMode ? faqCurrentPairId : null,
      notes: isPassportMode ? passportSubheading : notes,
      pageNumber: currentPage,
    };

    setRegions([...regions, newRegion]);
    setSelectedRegion(newRegion);
    setIsDrawing(false);
    setCurrentPoints([]);
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Account for scale and DPI (canvas is rendered at 2x DPI)
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    if (drawingMode === "none") {
      e.preventDefault();
      e.stopPropagation();
      // Check if clicking on a region
      // Find clicked region (reverse order to get topmost)
      for (let i = regions.length - 1; i >= 0; i--) {
        const region = regions[i];
        // Convert region points to canvas coordinates (multiply by 2 for DPI scaling)
        // Region points are stored at display resolution, canvas is at 2x DPI
        const scaledPoints = region.points.map(p => ({ 
          x: p.x * 2, 
          y: p.y * 2 
        }));
        if (isPointInRegion({ x, y }, scaledPoints)) {
          setSelectedRegion(region);
          return;
        }
      }
      // Clicked outside any region
      setSelectedRegion(null);
      return;
    }

    if (drawingMode === "rectangle") {
      if (!isDrawing) {
        setIsDrawing(true);
        setCurrentPoints([{ x, y }]);
      } else {
        // Complete rectangle
        const [p1] = currentPoints;
        const p2 = { x, y };
        // Store coordinates at actual canvas resolution (divide by 2 for display)
        const rectanglePoints: Point[] = [
          { x: p1.x / 2, y: p1.y / 2 },
          { x: p2.x / 2, y: p1.y / 2 },
          { x: p2.x / 2, y: p2.y / 2 },
          { x: p1.x / 2, y: p2.y / 2 },
        ];
        const geometry = computeRegionGeometry(rectanglePoints);
        const effectiveType: Region["type"] = isWarrantyFaqMode
          ? (faqRole === "question" ? "faq_question" : "faq_answer")
          : isCertificateMode
            ? "certificate_answer"
            : regionType;

        const newRegion: Region = {
          points: rectanglePoints,
          normalizedPoints: geometry.normalizedPoints,
          bbox: geometry.bbox,
          normalizedBBox: geometry.normalizedBBox,
          pageDimensions: geometry.pageDimensions,
          scaleAtCapture: geometry.scaleAtCapture,
          type: effectiveType,
          isNomenclatureTable,
          productGroupId,
          productItemId: isWarrantyFaqMode || isCertificateMode || isPassportMode ? null : productItemId,
          qaPairId: isWarrantyFaqMode ? faqCurrentPairId : null,
          notes: isPassportMode ? passportSubheading : notes,
          pageNumber: currentPage,
        };
        setRegions([...regions, newRegion]);
        setSelectedRegion(newRegion);
        setIsDrawing(false);
        setCurrentPoints([]);
      }
    } else if (drawingMode === "polygon") {
      if (!isDrawing) {
        setIsDrawing(true);
      }
      // Close polygon if user clicked near the first point (canvas is 2x DPI)
      if (currentPoints.length >= 3) {
        const first = currentPoints[0];
        const dist = Math.hypot(x - first.x, y - first.y);
        const CLOSE_THRESHOLD = 28; // ~14px in display coords (x2 DPI)
        if (dist <= CLOSE_THRESHOLD) {
          finalizePolygon();
          return;
        }
      }
      setCurrentPoints((prev) => [...prev, { x, y }]);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || drawingMode !== "rectangle") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    if (currentPoints.length === 1) {
      setCurrentPoints([currentPoints[0], { x, y }]);
    }
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (drawingMode !== "polygon") {
      return;
    }
    finalizePolygon();
  };

  const handleSaveRegion = () => {
    if (!selectedRegion) return;

    if (isPassportMode) {
      const passportName = docTitle.trim();
      if (passportName.length === 0) {
        toast.error("Укажите название паспорта (вверху) перед сохранением областей");
        return;
      }
      const sub = (selectedRegion.notes ?? "").trim();
      if (sub.length === 0) {
        toast.error("Для паспорта укажите подзаголовок (например: «Область применения»)");
        return;
      }
    }

    if (selectedRegion.id) {
      // Update existing
      updateRegionMutation.mutate({
        regionId: selectedRegion.id,
        regionType: selectedRegion.type,
        coordinates: {
          points: selectedRegion.points,
          bbox: selectedRegion.bbox,
          normalizedPoints: selectedRegion.normalizedPoints,
          normalizedBBox: selectedRegion.normalizedBBox,
          pageDimensions: selectedRegion.pageDimensions,
          scaleAtCapture: selectedRegion.scaleAtCapture,
        },
        isNomenclatureTable: selectedRegion.isNomenclatureTable,
        productGroupId: selectedRegion.productGroupId,
        productItemId: (selectedRegion as any).productItemId ?? null,
        qaPairId: selectedRegion.qaPairId,
        notes: selectedRegion.notes,
      });
    } else {
      // Create new
      createRegionMutation.mutate({
        documentId,
        pageNumber: selectedRegion.pageNumber,
        regionType: selectedRegion.type,
        coordinates: {
          points: selectedRegion.points,
          bbox: selectedRegion.bbox,
          normalizedPoints: selectedRegion.normalizedPoints,
          normalizedBBox: selectedRegion.normalizedBBox,
          pageDimensions: selectedRegion.pageDimensions,
          scaleAtCapture: selectedRegion.scaleAtCapture,
        },
        isNomenclatureTable: selectedRegion.isNomenclatureTable ?? false,
        productGroupId: selectedRegion.productGroupId,
        productItemId: (selectedRegion as any).productItemId ?? null,
        qaPairId: selectedRegion.qaPairId,
        notes: selectedRegion.notes,
      });
    }
  };

  const handleDeleteRegion = () => {
    if (!selectedRegion) return;

    // If region has id, delete from server
    if (selectedRegion.id) {
      deleteRegionMutation.mutate({ regionId: selectedRegion.id });
    } else {
      // If region is new (no id), remove from local state
      setRegions(regions.filter((r) => r !== selectedRegion));
      setSelectedRegion(null);
      toast.success("Область удалена");
    }
  };

  // Load PDF document
  useEffect(() => {
    if (!filename.toLowerCase().endsWith('.pdf') || !documentId) return;

    const loadPdf = async () => {
      try {
        setPdfLoading(true);
        setPdfError(null);

        const response = await fetch(`/api/documents/${documentId}/file`);
        if (!response.ok) {
          throw new Error(`Failed to load PDF: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setPdfLoading(false);
      } catch (error) {
        console.error("Error loading PDF:", error);
        setPdfError(error instanceof Error ? error.message : "Ошибка загрузки PDF");
        setPdfLoading(false);
      }
    };

    loadPdf();
  }, [documentId, filename]);

  // Render PDF page on canvas
  useEffect(() => {
    if (!pdfDoc || !pdfCanvasRef.current || currentPage < 1) return;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(currentPage);
        const pdfCanvas = pdfCanvasRef.current;
        if (!pdfCanvas) return;

        const container = containerRef.current;
        if (!container) return;

        // Calculate viewport with scale
        const viewport = page.getViewport({ scale: scale * 2 }); // Higher DPI for better quality
        
        // Set canvas size
        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;
        pdfCanvas.style.width = `${viewport.width / 2}px`;
        pdfCanvas.style.height = `${viewport.height / 2}px`;
        setPageMetrics({
          displayWidth: viewport.width / 2,
          displayHeight: viewport.height / 2,
          baseWidth: (viewport.width / 2) / scale,
          baseHeight: (viewport.height / 2) / scale,
        });

        // Render PDF page
        const context = pdfCanvas.getContext("2d");
        if (!context) return;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        await page.render(renderContext).promise;

        // Update overlay canvas size to match PDF canvas
        const overlayCanvas = canvasRef.current;
        if (overlayCanvas) {
          overlayCanvas.width = viewport.width;
          overlayCanvas.height = viewport.height;
          overlayCanvas.style.width = `${viewport.width / 2}px`;
          overlayCanvas.style.height = `${viewport.height / 2}px`;
          
          // Redraw regions
          const ctx = overlayCanvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            regions.forEach((region) => {
              const isSelected =
                selectedRegion === region ||
                Boolean(selectedRegion?.id && region.id && selectedRegion.id === region.id);
              drawRegion(ctx, region, isSelected, getRegionColor(region.type), 2); // Scale factor 2
            });
          }
        }
      } catch (error) {
        console.error("Error rendering PDF page:", error);
        toast.error("Ошибка отображения страницы PDF");
      }
    };

    renderPage();
  }, [pdfDoc, currentPage, scale]);

  // Update canvas size and redraw regions when scale changes
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    const overlayCanvas = canvasRef.current;
    const ctx = overlayCanvas.getContext("2d");
    if (!ctx) return;

    // Redraw regions with new scale
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    regions.forEach((region) => {
      const isSelected =
        selectedRegion === region ||
        Boolean(selectedRegion?.id && region.id && selectedRegion.id === region.id);
      drawRegion(ctx, region, isSelected, getRegionColor(region.type), 2);
    });
  }, [scale, regions, selectedRegion, pdfDoc]);

  // Handle keyboard shortcuts (Delete/Backspace to remove selected region)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedRegion && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleDeleteRegion();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRegion, regions]);

  return (
    <div className="space-y-4">
      {(isCertificateMode || isPassportMode) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isCertificateMode ? "Название сертификата" : "Название паспорта / модели"}
            </CardTitle>
            <CardDescription className="text-xs">
              Укажите название после загрузки — оно будет сохранено в документе.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder={
                  isCertificateMode
                    ? "Например: Сертификат соответствия (SANEXT)"
                    : "Например: Паспорт изделия — SANEXT DN15"
                }
                disabled={updateTitleMutation.isPending}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const trimmed = docTitle.trim();
                  if (isCertificateMode && trimmed.length === 0) {
                    toast.error("Для сертификата нужно указать название");
                    return;
                  }
                  updateTitleMutation.mutate({
                    documentId,
                    title: trimmed.length > 0 ? trimmed : null,
                  });
                  if (trimmed.length > 0 && (!chunkTitle || chunkTitle.trim().length === 0)) {
                    setChunkTitle(trimmed);
                  }
                }}
                disabled={updateTitleMutation.isPending}
              >
                {updateTitleMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Сохранить"
                )}
              </Button>
            </div>
            {isCertificateMode && (
              <p className="text-xs text-muted-foreground">
                Название сертификата будет использоваться как заголовок чанка.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h3 className="font-semibold mb-2">Инструкция по использованию:</h3>
              <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
                <li>Выберите режим выделения: <strong>Прямоугольник</strong> или <strong>Многоугольник</strong></li>
                <li>
                  {isWarrantyFaqMode
                    ? "Для каждой пары выберите роль (вопрос/ответ) и номер пары, затем выделяйте области по документу."
                    : isCertificateMode
                      ? "Введите название сертификата и выделите область(и), которая должна попадать в ответ."
                      : isPassportMode
                        ? "Укажите подзаголовок (например: «Область применения»), затем выделяйте соответствующий фрагмент текста. Все данные будут привязаны к названию паспорта."
                        : "Выберите тип области (текст, таблица, рисунок и т.д.)"}
                </li>
                <li>Нажмите на документе и перетащите для создания прямоугольника, или кликайте для создания многоугольника</li>
                <li>Чтобы завершить многоугольник: дважды кликните или кликните рядом с первой точкой (замыкание)</li>
                <li>Выберите область для редактирования свойств</li>
                <li>Сохраните область, чтобы она была доступна для создания чанков</li>
                {!isWarrantyFaqMode && !isCertificateMode && !isPassportMode && (
                  <li>
                    Перед генерацией чанка дайте ему понятное название (вариант товара) и выберите товарную группу. Например: «Труба SANEXT “Универсальная”» или «Труба SANEXT без кислородного барьера».
                  </li>
                )}
              </ol>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {!isWarrantyFaqMode ? (
                  <Button
                    variant="default"
                    onClick={() => generateChunksMutation.mutate({ documentId })}
                    disabled={generateChunksMutation.isPending || totalSavedRegions === 0}
                  >
                    {generateChunksMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Создание чанков...
                      </>
                    ) : (
                      <>
                        <Grid3x3 className="w-4 h-4 mr-2" />
                        Создать чанки из областей
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    onClick={() => generateWarrantyFaqChunksMutation.mutate({ documentId })}
                    disabled={generateWarrantyFaqChunksMutation.isPending || totalSavedRegions === 0}
                  >
                    {generateWarrantyFaqChunksMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Создание FAQ-чанков...
                      </>
                    ) : (
                      <>
                        <Grid3x3 className="w-4 h-4 mr-2" />
                        Создать FAQ-чанки
                      </>
                    )}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={handleGenerateChunkFromSelection}
                  disabled={
                    generateSelectedChunkMutation.isPending ||
                    selectedRegionIdsForChunk.length === 0 ||
                    (requireProductGroupForChunk && (!hasProductGroups || !chunkProductGroupId))
                  }
                >
                  {generateSelectedChunkMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Генерация чанка...
                    </>
                  ) : (
                    <>
                      <Layers className="w-4 h-4 mr-2" />
                      {selectedRegionIdsForChunk.length > 0
                        ? `Чанк из выбранных (${selectedRegionIdsForChunk.length})`
                        : "Выберите области для чанка"}
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedRegionIdsForChunk([])}
                  disabled={
                    selectedRegionIdsForChunk.length === 0 ||
                    generateSelectedChunkMutation.isPending
                  }
                >
                  Очистить выбор
                </Button>
                <p className="text-xs text-muted-foreground">
                  {selectedRegionIdsForChunk.length > 0
                    ? `Выбрано областей: ${selectedRegionIdsForChunk.length}`
                    : totalSavedRegions > 0
                      ? `Сохранённых областей: ${totalSavedRegions}`
                      : "Сохраните хотя бы одну область, чтобы создать чанки"}
                </p>
              </div>

              {selectedRegionsForChunk.length > 0 && (
                <div className="mt-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">
                    Выбранные области для следующего чанка:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    {selectedRegionsForChunk.map((region) => (
                      <li key={region.id}>
                        Стр. {region.pageNumber} • {getRegionTypeLabel(region.regionType)}{" "}
                        {region.notes ? `— ${region.notes}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!isWarrantyFaqMode && !isPassportMode && (
                <div className="mt-4 space-y-2 max-w-xl">
                  <Label htmlFor="chunkTitle">
                    {isCertificateMode
                      ? "Название сертификата"
                        : "Заголовок чанка"}
                  </Label>
                <Input
                  id="chunkTitle"
                  placeholder={
                    isCertificateMode
                      ? "Например: Сертификат соответствия (SANEXT)"
                        : "Например: Труба SANEXT DN15 — описание и характеристики"
                  }
                  value={chunkTitle}
                  onChange={(e) => setChunkTitle(e.target.value)}
                  disabled={generateSelectedChunkMutation.isPending}
                />
                  {!isCertificateMode && !isPassportMode && (
                    <p className="text-xs text-muted-foreground">
                      Используйте это поле для обозначения конкретного варианта товара. Чем точнее формулировка («Фитинг LH2, угловой», «Труба SANEXT “Универсальная”»), тем проще ассистенту не смешивать характеристики.
                    </p>
                  )}
                </div>
              )}

              {requireProductGroupForChunk && (
                <div className="mt-4 space-y-2 max-w-xl">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Группа товаров</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsCreateGroupDialogOpen(true)}
                      disabled={createGroupMutation.isPending}
                    >
                      {createGroupMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-1" />
                          Создать группу
                        </>
                      )}
                    </Button>
                  </div>
                <Select
                  value={chunkProductGroupId ? chunkProductGroupId.toString() : undefined}
                  onValueChange={(value) =>
                    (setChunkProductGroupId(value ? Number(value) : null),
                    setChunkProductItemId(null),
                    setProductItemId(null))
                  }
                  disabled={
                    generateSelectedChunkMutation.isPending || !hasProductGroups
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        hasProductGroups
                          ? "Выберите товарную группу"
                          : "Сначала создайте товарную группу"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {productGroups?.map((group) => (
                      <SelectItem key={group.id} value={group.id.toString()}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Товар (один товар = один чанк)</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsCreateItemDialogOpen(true)}
                      disabled={!chunkProductGroupId || createItemMutation.isPending}
                    >
                      {createItemMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-1" />
                          Создать товар
                        </>
                      )}
                    </Button>
                  </div>

                  <Select
                    value={chunkProductItemId ? String(chunkProductItemId) : undefined}
                    onValueChange={(v) => {
                      const next = v ? Number(v) : null;
                      setChunkProductItemId(next);
                      setProductItemId(next);
                    }}
                    disabled={!chunkProductGroupId || !hasProductItems}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          chunkProductGroupId
                            ? hasProductItems
                              ? "Выберите товар"
                              : "Создайте первый товар"
                            : "Сначала выберите группу"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {productItems?.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() =>
                        generateProductItemChunksMutation.mutate({
                          documentId,
                          regenerateEmbeddings: true,
                        })
                      }
                      disabled={!hasProductItems || generateProductItemChunksMutation.isPending}
                      className="gap-2"
                    >
                      {generateProductItemChunksMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Генерация…
                        </>
                      ) : (
                        "Сгенерировать чанки по товарам"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => refetchProductItems()}
                      disabled={!chunkProductGroupId}
                    >
                      Обновить товары
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Логика: сначала выбираете группу, затем товар. Все выделения сохраняйте с выбранным товаром — потом генерация создаст ровно один чанк на каждый товар.
                  </p>
                </div>
                </div>
              )}

              {isWarrantyFaqMode && (
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <div className="space-y-2">
                    <Label>Роль</Label>
                    <Select value={faqRole} onValueChange={(v) => setFaqRole(v as any)}>
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="question">Вопрос</SelectItem>
                        <SelectItem value="answer">Ответ</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Номер пары</Label>
                    <Input
                      className="w-32"
                      value={String(faqCurrentPairId)}
                      onChange={(e) => {
                        const next = parseInt(e.target.value || "0", 10);
                        setFaqCurrentPairId(Number.isFinite(next) && next > 0 ? next : 1);
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setFaqCurrentPairId((v) => v + 1)}
                  >
                    Новая пара
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar */}
      <Card>
        <CardHeader>
          <CardTitle>Инструменты выделения</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label>Режим:</Label>
              <RadioGroup value={drawingMode} onValueChange={(v) => {
                setDrawingMode(v as any);
                setIsDrawing(false);
                setCurrentPoints([]);
              }}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="rectangle" id="rect" />
                  <Label htmlFor="rect" className="cursor-pointer">Прямоугольник</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="polygon" id="poly" />
                  <Label htmlFor="poly" className="cursor-pointer">Многоугольник</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="none" id="none" />
                  <Label htmlFor="none" className="cursor-pointer">Выбор</Label>
                </div>
              </RadioGroup>
            </div>

            <Separator orientation="vertical" className="h-8" />

            <div className="flex items-center gap-2">
              {!isWarrantyFaqMode && !isCertificateMode && (
                <>
                  <Label>Тип области:</Label>
                  <Select value={regionType} onValueChange={(v) => setRegionType(v as any)}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Текст
                        </div>
                      </SelectItem>
                      <SelectItem value="table">
                        <div className="flex items-center gap-2">
                          <Table className="w-4 h-4" />
                          Таблица
                        </div>
                      </SelectItem>
                      <SelectItem value="technical_table">
                        <div className="flex items-center gap-2">
                          <Table className="w-4 h-4" />
                          Таблица тех. характеристик
                        </div>
                      </SelectItem>
                      <SelectItem value="table_with_articles">
                        <div className="flex items-center gap-2">
                          <Table className="w-4 h-4" />
                          Таблица с артикулами
                        </div>
                      </SelectItem>
                      <SelectItem value="figure">
                        <div className="flex items-center gap-2">
                          <Image className="w-4 h-4" />
                          Рисунок
                        </div>
                      </SelectItem>
                      <SelectItem value="list">
                        <div className="flex items-center gap-2">
                          <List className="w-4 h-4" />
                          Список
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>

            {isPassportMode && (
              <div className="flex items-center gap-2">
                <Label htmlFor="passport-subheading" className="whitespace-nowrap">
                  Подзаголовок:
                </Label>
                <Input
                  id="passport-subheading"
                  className="w-72"
                  value={passportSubheading}
                  onChange={(e) => setPassportSubheading(e.target.value)}
                  placeholder="Например: Область применения"
                  list="passport-subheadings-list"
                />
                <datalist id="passport-subheadings-list">
                  {passportSubheadings.map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
              </div>
            )}

            {!isWarrantyFaqMode && !isCertificateMode && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="nomenclature"
                  checked={isNomenclatureTable}
                  onCheckedChange={(checked) => setIsNomenclatureTable(checked === true)}
                />
                <Label htmlFor="nomenclature" className="cursor-pointer flex items-center gap-1">
                  <Tag className="w-4 h-4" />
                  Номенклатурная таблица
                </Label>
              </div>
            )}

            <Separator orientation="vertical" className="h-8" />

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setScale(Math.max(0.5, scale - 0.1))}
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-sm w-16 text-center">{Math.round(scale * 100)}%</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setScale(Math.min(2, scale + 0.1))}
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PDF Viewer and Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4" style={{ minHeight: "calc(100vh - 300px)" }}>
        {/* PDF Viewer */}
        <div className="lg:col-span-4" style={{ minHeight: "calc(100vh - 300px)" }}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Страница {currentPage} из {totalPages}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                  >
                    Назад
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Вперед
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div
                ref={containerRef}
                className="relative border rounded-lg overflow-auto bg-gray-100"
                style={{ minHeight: "1200px", maxHeight: "95vh", height: "95vh" }}
                onWheel={(e) => {
                  // Ensure scrolling works even when canvas is on top
                  e.stopPropagation();
                }}
              >
                {/* PDF Canvas */}
                {filename.toLowerCase().endsWith('.pdf') ? (
                  <>
                    {pdfError ? (
                      <div className="flex flex-col items-center justify-center h-full bg-white p-8">
                        <p className="text-destructive mb-2">Ошибка загрузки PDF</p>
                        <p className="text-sm text-muted-foreground mb-4">{pdfError}</p>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setPdfError(null);
                            setPdfLoading(true);
                            // Reload PDF
                            const loadPdf = async () => {
                              try {
                                const response = await fetch(`/api/documents/${documentId}/file`);
                                if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
                                const arrayBuffer = await response.arrayBuffer();
                                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                                const pdf = await loadingTask.promise;
                                setPdfDoc(pdf);
                                setTotalPages(pdf.numPages);
                                setPdfError(null);
                              } catch (error) {
                                setPdfError(error instanceof Error ? error.message : "Ошибка");
                              }
                            };
                            loadPdf();
                          }}
                        >
                          Попробовать снова
                        </Button>
                      </div>
                    ) : pdfLoading ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-20">
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">Загрузка PDF...</p>
                        </div>
                      </div>
                    ) : (
                      <div className="relative w-full h-full flex items-center justify-center p-4">
                        {/* PDF Canvas */}
                        <canvas
                          ref={pdfCanvasRef}
                          className="absolute top-0 left-0"
                          style={{ 
                            maxWidth: '100%',
                            height: 'auto',
                            display: 'block',
                            pointerEvents: drawingMode !== "none" && isDrawing ? "none" : "auto"
                          }}
                        />
                        
                        {/* Overlay canvas for drawing regions */}
                        <canvas
                          ref={canvasRef}
                          className={`absolute top-0 left-0 ${
                            drawingMode !== "none" ? "cursor-crosshair" : "cursor-pointer"
                          }`}
                          style={{ 
                            maxWidth: '100%',
                            height: 'auto',
                            display: 'block',
                            zIndex: 10,
                            pointerEvents: "auto"
                          }}
                          onMouseDown={(e) => {
                            handleCanvasMouseDown(e);
                            // Prevent default only when drawing
                            if (drawingMode !== "none") {
                              e.preventDefault();
                              e.stopPropagation();
                            }
                          }}
                          onMouseMove={handleCanvasMouseMove}
                          onDoubleClick={handleCanvasDoubleClick}
                          onWheel={(e) => {
                            // Always allow scrolling PDF - pass through to container
                            const container = containerRef.current;
                            if (container && (drawingMode === "none" || !isDrawing)) {
                              e.preventDefault();
                              container.scrollBy({
                                top: e.deltaY,
                                behavior: 'auto'
                              });
                            }
                          }}
                          onContextMenu={(e) => {
                            // Prevent context menu when drawing
                            if (drawingMode !== "none") {
                              e.preventDefault();
                            }
                          }}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-white shadow-lg p-8 flex items-center justify-center h-full">
                    <div className="text-center">
                      <p className="text-muted-foreground">
                        Просмотр файла доступен только для PDF. Используйте инструменты для выделения областей.
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Файл: {filename}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Region Properties Panel */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Свойства области</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedRegion ? (
                <>
                  <div>
                    <Label>Тип области</Label>
                    <Select
                      value={selectedRegion.type}
                      onValueChange={(v) =>
                        setSelectedRegion({ ...selectedRegion, type: v as any })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                      <SelectItem value="text">Текст</SelectItem>
                      {!isWarrantyFaqMode && !isCertificateMode && (
                        <>
                          <SelectItem value="table">Таблица</SelectItem>
                          <SelectItem value="technical_table">Таблица тех. характеристик</SelectItem>
                          <SelectItem value="table_with_articles">Таблица с артикулами</SelectItem>
                          <SelectItem value="figure">Рисунок</SelectItem>
                          <SelectItem value="list">Список</SelectItem>
                        </>
                      )}
                      {isWarrantyFaqMode && (
                        <>
                          <SelectItem value="faq_question">FAQ: Вопрос</SelectItem>
                          <SelectItem value="faq_answer">FAQ: Ответ</SelectItem>
                        </>
                      )}
                      {isCertificateMode && (
                        <SelectItem value="certificate_answer">Сертификат: Ответ</SelectItem>
                      )}
                      </SelectContent>
                    </Select>
                  </div>

                {!isWarrantyFaqMode && !isCertificateMode && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="selected-nomenclature"
                      checked={selectedRegion.isNomenclatureTable}
                      onCheckedChange={(checked) =>
                        setSelectedRegion({
                          ...selectedRegion,
                          isNomenclatureTable: checked === true,
                        })
                      }
                    />
                    <Label htmlFor="selected-nomenclature" className="cursor-pointer">
                      Номенклатурная таблица
                    </Label>
                  </div>
                )}

                {requireProductGroupForChunk && productGroups && productGroups.length > 0 && (
                    <div>
                      <Label>Товарная группа</Label>
                <Select
                  value={selectedRegion.productGroupId?.toString() ?? "none"}
                        onValueChange={(v) =>
                          setSelectedRegion({
                            ...selectedRegion,
                      productGroupId: v === "none" ? null : parseInt(v),
                          })
                        }
                      >
                        <SelectTrigger>
                    <SelectValue placeholder="Не выбрана" />
                        </SelectTrigger>
                        <SelectContent>
                    <SelectItem value="none">Не выбрана</SelectItem>
                          {productGroups.map((group) => (
                            <SelectItem key={group.id} value={group.id.toString()}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                {isWarrantyFaqMode && (
                  <div className="space-y-2">
                    <Label>Номер пары (qaPairId)</Label>
                    <Input
                      value={String(selectedRegion.qaPairId ?? faqCurrentPairId)}
                      onChange={(e) => {
                        const next = parseInt(e.target.value || "0", 10);
                        setSelectedRegion({
                          ...selectedRegion,
                          qaPairId: Number.isFinite(next) && next > 0 ? next : 1,
                        });
                      }}
                    />
                  </div>
                )}

                  {isPassportMode ? (
                    <div className="space-y-2">
                      <Label htmlFor="passport-region-subheading">Подзаголовок *</Label>
                      <Input
                        id="passport-region-subheading"
                        value={selectedRegion.notes || ""}
                        onChange={(e) => {
                          setSelectedRegion({ ...selectedRegion, notes: e.target.value });
                          setPassportSubheading(e.target.value);
                        }}
                        placeholder="Например: Область применения"
                        list="passport-subheadings-list"
                      />
                      <p className="text-xs text-muted-foreground">
                        Для паспорта подзаголовок обязателен: по нему будут группироваться данные внутри паспорта.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <Label>Заметки</Label>
                      <Textarea
                        value={selectedRegion.notes || ""}
                        onChange={(e) =>
                          setSelectedRegion({ ...selectedRegion, notes: e.target.value })
                        }
                        placeholder="Дополнительные заметки..."
                        rows={3}
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      onClick={handleSaveRegion}
                      disabled={createRegionMutation.isPending || updateRegionMutation.isPending}
                      className="flex-1"
                    >
                      {createRegionMutation.isPending || updateRegionMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Сохранить
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteRegion}
                      disabled={deleteRegionMutation.isPending}
                      title="Удалить область"
                    >
                      {deleteRegionMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Выберите область на документе или создайте новую
                </p>
              )}
            </CardContent>
          </Card>

          {/* Regions List */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Выделенные области</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {regions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Нет выделенных областей
                    </p>
                  ) : (
                    regions.map((region, index) => {
                      const isSelected = selectedRegion === region || (selectedRegion?.id && region.id && selectedRegion.id === region.id);
                      return (
                        <div
                          key={region.id || `temp-${index}`}
                          className={`p-2 rounded border cursor-pointer transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border hover:bg-muted"
                          }`}
                          onClick={() => setSelectedRegion(region)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {region.id ? (
                                <Checkbox
                                  id={`select-region-${region.id}`}
                                  checked={selectedRegionIdsForChunk.includes(region.id)}
                                  onCheckedChange={(checked) =>
                                    toggleRegionForChunk(region.id!, checked === true)
                                  }
                                />
                              ) : (
                                <div
                                  className="w-4 h-4 rounded border border-dashed opacity-50"
                                  title="Сохраните область, чтобы добавить её в чанк"
                                />
                              )}
                              <Badge variant="outline" style={{ borderColor: getRegionColor(region.type) }}>
                                {getRegionTypeLabel(region.type)}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              {region.isNomenclatureTable && (
                                <Tag className="w-3 h-3 text-green-600" />
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (region.id) {
                                    deleteRegionMutation.mutate({ regionId: region.id });
                                  } else {
                                    setRegions(regions.filter((r) => r !== region));
                                    if (selectedRegion === region) {
                                      setSelectedRegion(null);
                                    }
                                    toast.success("Область удалена");
                                  }
                                }}
                                disabled={deleteRegionMutation.isPending}
                                title="Удалить область"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                          {region.notes && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {region.notes}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog
        open={isCreateGroupDialogOpen}
        onOpenChange={(open) => {
          setIsCreateGroupDialogOpen(open);
          if (!open) {
            setNewGroupName("");
            setNewGroupDescription("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Создать товарную группу</DialogTitle>
            <DialogDescription>
              Группы помогают объединять чанки по конкретным товарам и разделам.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="manual-new-group-name">Название группы *</Label>
              <Input
                id="manual-new-group-name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Например: Труба SANEXT «Универсальная»"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newGroupName.trim()) {
                    handleCreateProductGroup();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-new-group-description">Описание (необязательно)</Label>
              <Textarea
                id="manual-new-group-description"
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                placeholder="Дополнительные заметки о группе..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateGroupDialogOpen(false);
                setNewGroupName("");
                setNewGroupDescription("");
              }}
            >
              Отмена
            </Button>
            <Button
              onClick={handleCreateProductGroup}
              disabled={createGroupMutation.isPending || !newGroupName.trim()}
            >
              {createGroupMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Создание...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Создать
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCreateItemDialogOpen}
        onOpenChange={(open) => {
          setIsCreateItemDialogOpen(open);
          if (!open) {
            setNewItemName("");
            setNewItemDescription("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Создать товар</DialogTitle>
            <DialogDescription>
              Товар относится к выбранной группе и будет отдельным чанком при генерации.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Название товара *</Label>
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Например: Труба SANEXT «Универсальная»"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newItemName.trim() && chunkProductGroupId) {
                    createItemMutation.mutate({
                      documentId,
                      groupId: chunkProductGroupId,
                      name: newItemName.trim(),
                      description: newItemDescription.trim() || undefined,
                    });
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Описание</Label>
              <Textarea
                value={newItemDescription}
                onChange={(e) => setNewItemDescription(e.target.value)}
                placeholder="Опционально"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateItemDialogOpen(false)}
              disabled={createItemMutation.isPending}
            >
              Отмена
            </Button>
            <Button
              onClick={() => {
                if (!chunkProductGroupId) return;
                createItemMutation.mutate({
                  documentId,
                  groupId: chunkProductGroupId,
                  name: newItemName.trim(),
                  description: newItemDescription.trim() || undefined,
                });
              }}
              disabled={
                createItemMutation.isPending || !chunkProductGroupId || !newItemName.trim()
              }
            >
              {createItemMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Создание...
                </>
              ) : (
                "Создать"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

