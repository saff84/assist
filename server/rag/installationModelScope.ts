import { modelCodes } from "../../shared/productScope";

/** Prefer the model's own manual over assemblies that merely mention it. */
export function scopeInstallationModel<T extends {
  documentId: number;
  docType: string;
  title?: string | null;
  filename: string;
}>(query: string, chunks: T[]): T[] {
  const models = modelCodes(query);
  if (models.length !== 1) return chunks;
  const owners = new Set(chunks.filter(chunk => {
    if (!["installation", "instruction"].includes(chunk.docType)) return false;
    const codes = modelCodes(chunk.title || chunk.filename);
    return codes.length === 1 && codes[0] === models[0];
  }).map(chunk => chunk.documentId));
  // Preserve general manuals when no dedicated indexed manual is available.
  return owners.size ? chunks.filter(chunk => owners.has(chunk.documentId)) : chunks;
}
