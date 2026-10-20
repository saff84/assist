import fs from "fs";
import path from "path";
import crypto from "crypto";

export type ReviewKind = "manual" | "repair" | "recovered" | "legacy";
export type InstallationReview = {
  markdownHash: string;
  sourcePdfHash: string | null;
  converterVersion: string;
  kind: ReviewKind;
  savedAt: string;
};
export const markdownHash = (markdown: string) =>
  crypto.createHash("sha256").update(markdown).digest("hex");
const snapshotPath = (id: number, hash: string) =>
  path.resolve("uploads", "document-reviews", String(id), `${hash}.md`);

export function saveInstallationReview(
  id: number,
  markdown: string,
  sourcePdfHash: string | null,
  converterVersion: string,
  kind: ReviewKind
): InstallationReview {
  const review: InstallationReview = {
    markdownHash: markdownHash(markdown),
    sourcePdfHash,
    converterVersion,
    kind,
    savedAt: new Date().toISOString(),
  };
  const file = snapshotPath(id, review.markdownHash);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, markdown, "utf8");
  fs.writeFileSync(
    file.replace(/\.md$/, ".json"),
    JSON.stringify(review, null, 2),
    "utf8"
  );
  return review;
}

export function readInstallationReview(
  id: number,
  metadata: { customFields?: Record<string, any> } | null
) {
  const review = (metadata?.customFields?.installationReview ??
    metadata?.customFields?.previousInstallationReview) as
    | InstallationReview
    | undefined;
  if (!review || !/^[a-f0-9]{64}$/.test(review.markdownHash)) return null;
  const file = snapshotPath(id, review.markdownHash);
  if (!fs.existsSync(file)) return null;
  const markdown = fs.readFileSync(file, "utf8");
  if (markdownHash(markdown) !== review.markdownHash)
    throw new Error(
      "Контрольная сумма сохранённого MD не совпадает. Восстановление остановлено."
    );
  return { review, markdown };
}
