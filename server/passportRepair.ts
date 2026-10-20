import fs from "fs";
import { randomUUID } from "crypto";
import * as documentDb from "./documentDb";
import {
  installationPath,
  preparePassportKnowledge,
  indexInstallationMarkdown,
  hasSamePassportSource,
} from "./installationKnowledge";
import { pdfToMarkdown } from "./pdfMarkdown";
import { canRecoverInstallationReview } from "../shared/documentReview";
import { readInstallationReview } from "./installationReviewStore";

type RepairStatus = {
  state: "running" | "done" | "failed";
  message: string;
  documentId?: number;
  chunks?: number;
  total?: number;
  processed?: number;
  restored?: number;
  errors?: Array<{ id: number; title: string; message: string }>;
};
const jobs = new Map<string, RepairStatus>();
const active = new Map<string, string>();

export function getPassportRepairStatus(jobId: string): RepairStatus {
  return (
    jobs.get(jobId) ?? {
      state: "failed",
      message:
        "Задача не найдена. Возможно, сервер перезапустился; повторите обновление.",
    }
  );
}

/** Restore only previously indexed documents, without regenerating or overwriting their MD. */
export async function startInstallationReviewRecovery(ids: number[]) {
  const selected = new Set(ids);
  const documents = (await documentDb.getAllDocuments()).filter(
    doc => selected.has(doc.id) && canRecoverInstallationReview(doc)
  );
  if (!documents.length)
    throw new Error("Нет ранее индексированных документов для восстановления");
  const keyFor = (doc: (typeof documents)[number]) =>
    /^passport-\d+\.md$/.test(doc.filename)
      ? doc.filename.replace(/\.md$/, "")
      : `installation-${doc.id}`;
  if (documents.some(doc => active.has(keyFor(doc))))
    throw new Error(
      "Один из документов уже обновляется. Дождитесь завершения."
    );
  const jobId = `review-recovery:${randomUUID()}`;
  documents.forEach(doc => active.set(keyFor(doc), jobId));
  jobs.set(jobId, {
    state: "running",
    message: "Восстановление индекса ранее проверенных документов",
    total: documents.length,
    processed: 0,
    restored: 0,
  });
  void (async () => {
    let processed = 0,
      restored = 0;
    const errors: Array<{ id: number; title: string; message: string }> = [];
    try {
      for (const original of documents) {
        try {
          const doc = await documentDb.getDocumentById(original.id);
          if (!doc || !canRecoverInstallationReview(doc)) {
            processed++;
            continue;
          }
          jobs.set(jobId, {
            state: "running",
            message: `Восстановление: ${doc.title || doc.filename}`,
            total: documents.length,
            processed,
            restored,
            errors: [...errors],
          });
          const saved = readInstallationReview(doc.id, doc.documentMetadata);
          const passportId = Number(
            /^passport-(\d+)\.md$/.exec(doc.filename)?.[1]
          );
          if (passportId) {
            const source = await documentDb.getDocumentById(passportId);
            if (
              !source ||
              !hasSamePassportSource(doc, source.contentHash) ||
              (saved?.review.sourcePdfHash &&
                saved.review.sourcePdfHash !== source.contentHash)
            ) {
              throw new Error(
                "Исходный PDF изменился после проверки. Этот документ нужно проверить повторно."
              );
            }
          }
          await indexInstallationMarkdown(doc.id, saved?.markdown, {
            reviewKind: "recovered",
          });
          restored++;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          errors.push({
            id: original.id,
            title: original.title || original.filename,
            message,
          });
          try {
            await documentDb.updateDocumentStatus(
              original.id,
              "failed",
              message
            );
          } catch (dbError) {
            console.error("[ReviewRecovery]", dbError);
          }
        }
        processed++;
      }
      jobs.set(jobId, {
        state: restored ? "done" : errors.length ? "failed" : "done",
        message: `Восстановлено: ${restored}. Ошибок: ${errors.length}.`,
        total: documents.length,
        processed,
        restored,
        errors,
      });
    } finally {
      documents.forEach(doc => {
        if (active.get(keyFor(doc)) === jobId) active.delete(keyFor(doc));
      });
    }
  })();
  return { jobId };
}

/** Explicit repair of selected documents, including replacement of published chunks. */
export async function startPassportRepair(documentId: number) {
  const doc = await documentDb.getDocumentById(documentId);
  if (!doc) throw new Error("Документ не найден");
  const passportId =
    doc.docType === "passport" && doc.fileType === "pdf"
      ? doc.id
      : doc.docType === "installation"
        ? Number(/^passport-(\d+)\.md$/.exec(doc.filename)?.[1]) || null
        : null;
  if (
    !passportId &&
    !(
      doc.docType === "installation" &&
      doc.fileType === "md" &&
      doc.downloadFilename
    )
  ) {
    throw new Error(
      "Для обновления нужен исходный PDF паспорта или приложенный PDF документа монтажа."
    );
  }
  const source = passportId
    ? await documentDb.getDocumentById(passportId)
    : null;
  if (
    passportId &&
    (!source || source.docType !== "passport" || source.status !== "indexed")
  ) {
    throw new Error(
      "Исходный паспорт недоступен. Сначала синхронизируйте источник."
    );
  }
  const sourcePath = source
    ? installationPath(source.id, source.filename)
    : installationPath(doc.id, `download_${doc.downloadFilename}`);
  if (!fs.existsSync(sourcePath))
    throw new Error(
      "Исходный PDF отсутствует на сервере. Повторите загрузку или синхронизацию."
    );
  const documentKey = passportId
    ? `passport-${passportId}`
    : `installation-${documentId}`;
  if (active.has(documentKey)) throw new Error("Этот документ уже обновляется");
  const jobId = `${documentKey}:${randomUUID()}`;
  active.set(documentKey, jobId);
  // Keep a bounded history; active jobs are never evicted.
  if (jobs.size >= 100) {
    const old = Array.from(jobs).find(([, job]) => job.state !== "running");
    if (old) jobs.delete(old[0]);
  }
  jobs.set(jobId, {
    state: "running",
    message: "Пересоздание Markdown из исходного PDF",
  });
  void (async () => {
    let targetId: number | undefined =
      doc.docType === "installation" ? doc.id : undefined;
    try {
      if (passportId) {
        targetId = (await preparePassportKnowledge(passportId, { force: true }))
          .id;
      } else {
        await documentDb.updateDocumentStatus(doc.id, "processing");
        await documentDb.updateDocumentProgress(
          doc.id,
          "parsing",
          20,
          "Пересоздание Markdown из PDF"
        );
        const markdown = await pdfToMarkdown(
          sourcePath,
          doc.title || doc.filename
        );
        fs.writeFileSync(
          installationPath(doc.id, doc.filename),
          markdown,
          "utf8"
        );
        await documentDb.deleteDocumentChunks(doc.id);
        await documentDb.updateDocumentChunksCount(doc.id, 0);
      }
      if (!targetId) throw new Error("Не удалось определить документ Markdown");
      jobs.set(jobId, {
        state: "running",
        message: "Замена чанков и поискового индекса",
        documentId: targetId,
      });
      const result = await indexInstallationMarkdown(targetId);
      jobs.set(jobId, {
        state: "done",
        message: "Markdown и чанки обновлены",
        documentId: targetId,
        chunks: result.chunks,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (targetId) {
        try {
          await documentDb.updateDocumentStatus(targetId, "failed", message);
        } catch (dbError) {
          console.error("[PassportRepair] Failed to save error", dbError);
        }
      }
      jobs.set(jobId, { state: "failed", message, documentId: targetId });
      console.error("[PassportRepair]", jobId, message);
    } finally {
      active.delete(documentKey);
    }
  })();
  return { jobId };
}
