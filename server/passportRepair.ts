import fs from "fs";
import { randomUUID } from "crypto";
import * as documentDb from "./documentDb";
import {
  installationPath,
  preparePassportKnowledge,
  indexInstallationMarkdown,
} from "./installationKnowledge";
import { pdfToMarkdown } from "./pdfMarkdown";

type RepairStatus = {
  state: "running" | "done" | "failed";
  message: string;
  documentId?: number;
  chunks?: number;
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
