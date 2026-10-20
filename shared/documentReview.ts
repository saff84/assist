type ReviewDocument = {
  docType?: string;
  fileType?: string;
  status?: string;
  processingMessage?: string | null;
  documentMetadata?: { customFields?: Record<string, any> } | null;
  tocJson?: unknown;
  pages?: number | null;
};

/** Legacy indexing wrote metadata, TOC and page count; draft conversion did not. */
export function hasPreviousInstallationReview(doc: ReviewDocument): boolean {
  return Boolean(
    doc.documentMetadata?.customFields?.installationReview ||
      (doc.documentMetadata != null && doc.tocJson != null && doc.pages != null)
  );
}

export function canRecoverInstallationReview(doc: ReviewDocument): boolean {
  const fields = doc.documentMetadata?.customFields;
  if (fields?.installationRequiresReview === true) return false;
  const review =
    fields?.installationReview ?? fields?.previousInstallationReview;
  if (
    review?.sourcePdfHash &&
    fields?.installationSourceHash &&
    review.sourcePdfHash !== fields.installationSourceHash
  )
    return false;
  return (
    doc.docType === "installation" &&
    doc.fileType === "md" &&
    ((doc.status === "processing" &&
      Boolean(doc.processingMessage?.includes("Ожидает проверки"))) ||
      (doc.status === "failed" && Boolean(fields?.installationReview))) &&
    hasPreviousInstallationReview(doc)
  );
}
