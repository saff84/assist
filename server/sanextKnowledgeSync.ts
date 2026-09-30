import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as documentDb from "./documentDb";
import * as db from "./db";
import * as syncSourcesDb from "./knowledgeSyncSourcesDb";
import type { KnowledgeSyncSource } from "../drizzle/schema";
import type { DocumentType } from "./rag/types";

export type SanextLinkItem = {
  url: string;
  title: string;
};

export type SanextSyncResult = {
  startedAt: string;
  finishedAt: string;
  added: number;
  updated: number;
  unchanged: number;
  orphaned: number;
  errors: Array<{ url?: string; message: string }>;
  byType: Record<
    "passport" | "certificate",
    { added: number; updated: number; unchanged: number; orphaned: number }
  >;
  sourceResults: Array<{
    sourceId: number;
    name: string;
    added: number;
    updated: number;
    unchanged: number;
    orphaned: number;
    linkCount: number;
  }>;
};

type SyncStatus = {
  inProgress: boolean;
  lastRunAt: string | null;
  lastResult: SanextSyncResult | null;
  lastError: string | null;
};

const status: SyncStatus = {
  inProgress: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
};

let syncTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

export function getSanextSyncStatus(): SyncStatus {
  return { ...status };
}

function ensureUploadsDir(): string {
  const uploadsDir = path.join(process.cwd(), "uploads", "documents");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

function permanentFilePath(documentId: number, filename: string): string {
  return path.resolve(ensureUploadsDir(), `${documentId}_${filename}`);
}

function sanitizeFilename(raw: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const base = path.basename(decoded).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  const trimmed = base.trim() || "document.pdf";
  return trimmed.length > 180 ? `${trimmed.slice(0, 176)}.pdf` : trimmed;
}

function stripTitlePrefix(text: string, prefix: string | null | undefined): string {
  let out = text.replace(/\s+/g, " ").trim();
  const p = (prefix || "").trim();
  if (p) {
    const re = new RegExp(`^\\s*${escapeRegExp(p)}\\s*`, "i");
    out = out.replace(re, "").trim();
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extensionMatches(url: string, ext: string): boolean {
  const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith(normalized);
  } catch {
    return url.toLowerCase().includes(normalized);
  }
}

export function extractLinksWithRules(
  html: string,
  pageUrl: string,
  source: Pick<
    KnowledgeSyncSource,
    | "hrefMustContain"
    | "fileExtension"
    | "titleSource"
    | "titleStripPrefix"
    | "linkTextMustContain"
  >
): SanextLinkItem[] {
  const items: SanextLinkItem[] = [];
  const seen = new Set<string>();
  const hrefNeedle = (source.hrefMustContain || "").trim().toLowerCase();
  const textNeedle = (source.linkTextMustContain || "").trim().toLowerCase();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const hrefRaw = match[1]?.trim() ?? "";
    if (!hrefRaw) continue;
    let absolute: string;
    try {
      absolute = new URL(hrefRaw, pageUrl).href;
    } catch {
      continue;
    }

    if (hrefNeedle && !absolute.toLowerCase().includes(hrefNeedle)) continue;
    if (!extensionMatches(absolute, source.fileExtension || ".pdf")) continue;

    const url = absolute.split("#")[0];
    if (seen.has(url)) continue;

    const inner = match[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    const rawText = inner.replace(/\s+/g, " ").trim();
    if (textNeedle && !rawText.toLowerCase().includes(textNeedle)) continue;

    seen.add(url);

    let title: string;
    if (source.titleSource === "filename") {
      title = stripTitlePrefix(
        sanitizeFilename(url).replace(/\.[^.]+$/i, ""),
        source.titleStripPrefix
      );
    } else {
      title =
        stripTitlePrefix(rawText, source.titleStripPrefix) ||
        stripTitlePrefix(
          sanitizeFilename(url).replace(/\.[^.]+$/i, ""),
          source.titleStripPrefix
        );
    }

    items.push({ url, title: title || "Документ SANEXT" });
  }
  return items;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "SANEXT-Knowledge-Assistant/1.0 (+sync)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return await res.text();
}

async function fetchPdfBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "SANEXT-Knowledge-Assistant/1.0 (+sync)",
      Accept: "application/pdf,*/*",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function resolveUploaderId(): Promise<number> {
  const fromEnv = Number(process.env.SANEXT_SYNC_UPLOADER_ID || "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  const adminEmail = process.env.ADMIN_EMAIL || "admin@admin.local";
  const admin = await db.getUserByEmail(adminEmail);
  if (admin?.id) return admin.id;

  const all = await db.getAllUsers();
  const firstAdmin = all.find((u) => u.role === "admin");
  if (firstAdmin?.id) return firstAdmin.id;
  if (all[0]?.id) return all[0].id;
  return 1;
}

function emptyTypeStats() {
  return { added: 0, updated: 0, unchanged: 0, orphaned: 0 };
}

async function upsertLink(
  item: SanextLinkItem,
  source: KnowledgeSyncSource,
  uploaderId: number,
  result: SanextSyncResult,
  sourceStats: { added: number; updated: number; unchanged: number }
): Promise<void> {
  const docType = source.docType;
  const typeStats = result.byType[docType];
  const filenameFromUrl = sanitizeFilename(item.url);
  const existing = await documentDb.getDocumentBySourceUrl(item.url);

  // Ownership / reclaim rules before downloading
  if (existing) {
    const ownerId = existing.syncSourceId ?? null;
    if (ownerId != null && ownerId !== source.id) {
      result.errors.push({
        url: item.url,
        message: `Пропуск: файл уже привязан к другому источнику (#${ownerId}), не переносим в «${source.name}»`,
      });
      return;
    }
    if (ownerId == null && existing.docType !== docType) {
      result.errors.push({
        url: item.url,
        message: `Пропуск: отвязанный документ типа «${existing.docType}» не совпадает с источником «${docType}»`,
      });
      return;
    }
  }

  let buffer: Buffer;
  try {
    buffer = await fetchPdfBuffer(item.url);
  } catch (err) {
    result.errors.push({
      url: item.url,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (buffer.length < 100 || buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    result.errors.push({
      url: item.url,
      message: "Downloaded file is not a valid PDF",
    });
    return;
  }

  const hash = sha256(buffer);
  const now = new Date();

  if (!existing) {
    const documentId = await documentDb.createDocument({
      filename: filenameFromUrl,
      fileType: "pdf",
      fileSize: buffer.length,
      uploadedBy: uploaderId,
      status: "processing",
      chunksCount: 0,
      processingType: docType,
      docType: docType as DocumentType,
      title: item.title,
      sourceUrl: item.url,
      contentHash: hash,
      sourceSyncedAt: now,
      syncSourceId: source.id,
      processingStage: "saving",
      processingProgress: 50,
      processingMessage: `Синхронизация: ${source.name}`,
      errorMessage: null,
    } as any);

    try {
      fs.writeFileSync(permanentFilePath(documentId, filenameFromUrl), buffer);
      await documentDb.updateDocumentSyncRecord(documentId, {
        status: "indexed",
        processingMessage: `Синхронизировано: ${source.name}`,
        sourceSyncedAt: now,
      });
    } catch (writeErr) {
      await documentDb.updateDocumentSyncRecord(documentId, {
        status: "failed",
        contentHash: null,
        errorMessage:
          writeErr instanceof Error
            ? `Не удалось сохранить файл: ${writeErr.message}`
            : "Не удалось сохранить файл",
      });
      result.errors.push({
        url: item.url,
        message:
          writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
      return;
    }

    result.added += 1;
    typeStats.added += 1;
    sourceStats.added += 1;
    return;
  }

  const sameHash = existing.contentHash === hash;
  const existingPath = permanentFilePath(existing.id, existing.filename);
  const fileMissing = !fs.existsSync(existingPath);

  if (sameHash && !fileMissing) {
    await documentDb.updateDocumentSyncRecord(existing.id, {
      title: item.title,
      sourceSyncedAt: now,
      syncSourceId: source.id,
      docType,
      processingType: docType,
      status: "indexed",
      errorMessage: null,
      processingMessage: `Синхронизировано: ${source.name} (без изменений)`,
    });
    result.unchanged += 1;
    typeStats.unchanged += 1;
    sourceStats.unchanged += 1;
    return;
  }

  // Hash match but file gone, or content changed → (re)write file
  const oldPath = existingPath;
  const newPath = permanentFilePath(existing.id, filenameFromUrl);
  try {
    fs.writeFileSync(newPath, buffer);
  } catch (writeErr) {
    await documentDb.updateDocumentSyncRecord(existing.id, {
      status: "failed",
      contentHash: null,
      errorMessage:
        writeErr instanceof Error
          ? `Не удалось сохранить файл: ${writeErr.message}`
          : "Не удалось сохранить файл",
    });
    result.errors.push({
      url: item.url,
      message:
        writeErr instanceof Error
          ? `Не удалось обновить файл: ${writeErr.message}`
          : "Не удалось обновить файл",
    });
    return;
  }
  if (oldPath !== newPath && fs.existsSync(oldPath)) {
    try {
      fs.unlinkSync(oldPath);
    } catch {
      // ignore
    }
  }

  await documentDb.updateDocumentSyncRecord(existing.id, {
    title: item.title,
    filename: filenameFromUrl,
    fileSize: buffer.length,
    contentHash: hash,
    sourceSyncedAt: now,
    syncSourceId: source.id,
    docType,
    processingType: docType,
    status: "indexed",
    errorMessage: null,
    processingMessage: fileMissing
      ? `Восстановлен файл: ${source.name}`
      : `Обновлено: ${source.name}`,
  });
  result.updated += 1;
  typeStats.updated += 1;
  sourceStats.updated += 1;
}

async function syncOneSource(
  source: KnowledgeSyncSource,
  uploaderId: number,
  result: SanextSyncResult
): Promise<Set<string>> {
  const seenUrls = new Set<string>();
  const sourceStats = { added: 0, updated: 0, unchanged: 0, orphaned: 0 };

  let html: string;
  try {
    html = await fetchText(source.pageUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push({ url: source.pageUrl, message });
    await syncSourcesDb.updateKnowledgeSyncSource(source.id, {
      lastSyncedAt: new Date(),
      lastSyncMessage: `Ошибка: ${message}`,
    });
    result.sourceResults.push({
      sourceId: source.id,
      name: source.name,
      added: 0,
      updated: 0,
      unchanged: 0,
      orphaned: 0,
      linkCount: 0,
    });
    return seenUrls;
  }

  const links = extractLinksWithRules(html, source.pageUrl, source);
  console.log(
    `[SanextSync] source#${source.id} «${source.name}»: ${links.length} links`
  );

  // Do not orphan the library if the page returned no matches (layout change / empty HTML)
  if (links.length === 0) {
    const msg =
      "На странице не найдено ссылок по правилам — orphaning пропущен";
    result.errors.push({ url: source.pageUrl, message: msg });
    await syncSourcesDb.updateKnowledgeSyncSource(source.id, {
      lastSyncedAt: new Date(),
      lastSyncMessage: msg,
    });
    result.sourceResults.push({
      sourceId: source.id,
      name: source.name,
      added: 0,
      updated: 0,
      unchanged: 0,
      orphaned: 0,
      linkCount: 0,
    });
    return seenUrls;
  }

  for (const link of links) {
    seenUrls.add(link.url);
    try {
      await upsertLink(link, source, uploaderId, result, sourceStats);
    } catch (err) {
      result.errors.push({
        url: link.url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const existingDocs = await documentDb.listDocumentsBySyncSourceId(source.id);
  for (const doc of existingDocs) {
    if (!doc.sourceUrl || seenUrls.has(doc.sourceUrl)) continue;
    if (
      doc.status === "failed" &&
      (doc.errorMessage?.includes("Снят со страницы") ||
        doc.errorMessage?.includes("снят с сайта"))
    ) {
      continue;
    }
    await documentDb.updateDocumentSyncRecord(doc.id, {
      status: "failed",
      errorMessage: "Снят со страницы источника (не найден при синхронизации)",
      processingMessage: "Orphaned after sync",
      sourceSyncedAt: new Date(),
    });
    result.orphaned += 1;
    sourceStats.orphaned += 1;
    result.byType[source.docType].orphaned += 1;
  }

  await syncSourcesDb.updateKnowledgeSyncSource(source.id, {
    lastSyncedAt: new Date(),
    lastSyncMessage: `+${sourceStats.added} ~${sourceStats.updated} =${sourceStats.unchanged} orphan=${sourceStats.orphaned} (ссылок: ${links.length})`,
  });

  result.sourceResults.push({
    sourceId: source.id,
    name: source.name,
    added: sourceStats.added,
    updated: sourceStats.updated,
    unchanged: sourceStats.unchanged,
    orphaned: sourceStats.orphaned,
    linkCount: links.length,
  });

  return seenUrls;
}

export async function runSanextKnowledgeSync(options?: {
  sourceId?: number;
}): Promise<SanextSyncResult> {
  if (status.inProgress) {
    throw new Error("Синхронизация уже выполняется");
  }

  status.inProgress = true;
  status.lastError = null;
  const startedAt = new Date();
  const result: SanextSyncResult = {
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    added: 0,
    updated: 0,
    unchanged: 0,
    orphaned: 0,
    errors: [],
    byType: {
      passport: emptyTypeStats(),
      certificate: emptyTypeStats(),
    },
    sourceResults: [],
  };

  console.log("[SanextSync] Starting sync…");

  try {
    await syncSourcesDb.ensureDefaultKnowledgeSyncSources();
    const uploaderId = await resolveUploaderId();

    let sources: KnowledgeSyncSource[];
    if (options?.sourceId) {
      const one = await syncSourcesDb.getKnowledgeSyncSourceById(options.sourceId);
      if (!one) throw new Error(`Источник #${options.sourceId} не найден`);
      sources = [one];
    } else {
      sources = await syncSourcesDb.listEnabledKnowledgeSyncSources();
    }

    if (!sources.length) {
      throw new Error("Нет включённых источников синхронизации");
    }

    for (const source of sources) {
      await syncOneSource(source, uploaderId, result);
    }

    result.finishedAt = new Date().toISOString();
    status.lastRunAt = result.finishedAt;
    status.lastResult = result;
    console.log(
      `[SanextSync] Done: +${result.added} ~${result.updated} =${result.unchanged} orphan=${result.orphaned} errors=${result.errors.length}`
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.lastError = message;
    result.finishedAt = new Date().toISOString();
    status.lastRunAt = result.finishedAt;
    status.lastResult = result;
    console.error("[SanextSync] Failed:", message);
    throw err;
  } finally {
    status.inProgress = false;
  }
}

export function startSanextKnowledgeSyncScheduler(): void {
  const disabled =
    process.env.SANEXT_SYNC_DISABLED === "1" ||
    process.env.SANEXT_SYNC_DISABLED === "true";
  if (disabled) {
    console.log("[SanextSync] Scheduler disabled via SANEXT_SYNC_DISABLED");
    return;
  }

  const intervalMs = Math.max(
    60_000,
    Number(process.env.SANEXT_SYNC_INTERVAL_MS || 24 * 60 * 60 * 1000) ||
      24 * 60 * 60 * 1000
  );
  const startupDelayMs = Math.max(
    5_000,
    Number(process.env.SANEXT_SYNC_STARTUP_DELAY_MS || 60_000) || 60_000
  );

  if (startupTimer) clearTimeout(startupTimer);
  if (syncTimer) clearInterval(syncTimer);

  startupTimer = setTimeout(() => {
    syncSourcesDb.ensureDefaultKnowledgeSyncSources().catch(() => undefined);
    runSanextKnowledgeSync().catch((err) => {
      console.error("[SanextSync] Startup run failed:", err);
    });
  }, startupDelayMs);

  syncTimer = setInterval(() => {
    runSanextKnowledgeSync().catch((err) => {
      console.error("[SanextSync] Scheduled run failed:", err);
    });
  }, intervalMs);

  console.log(
    `[SanextSync] Scheduler started: first in ${startupDelayMs}ms, then every ${intervalMs}ms`
  );
}
