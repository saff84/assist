import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  saveInstallationReview,
  readInstallationReview,
} from "./installationReviewStore";

describe("approved Markdown snapshots", () => {
  it("keeps older manual corrections and detects a damaged backup", () => {
    const root = path.resolve("uploads/document-reviews");
    let id: number, dir: string;
    do {
      id = crypto.randomInt(1_000_000_000, 2_000_000_000);
      dir = path.resolve(root, String(id));
    } while (fs.existsSync(dir));
    expect(dir.startsWith(root + path.sep)).toBe(true);
    try {
      const old = saveInstallationReview(
        id,
        "# Manually corrected table\nOriginal wording.",
        "pdf",
        "layout-v2",
        "manual"
      );
      saveInstallationReview(
        id,
        "# New revision",
        "pdf",
        "layout-v3",
        "manual"
      );
      const metadata = { customFields: { installationReview: old } };
      expect(readInstallationReview(id, metadata)?.markdown).toContain(
        "Original wording."
      );
      fs.writeFileSync(path.join(dir, `${old.markdownHash}.md`), "truncated");
      expect(() => readInstallationReview(id, metadata)).toThrow(
        "Контрольная сумма"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
