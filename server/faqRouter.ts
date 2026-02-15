import { router, adminProcedure } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as faqDb from "./faqDb";
import { buildLexicalTerms, generateChunkEmbedding } from "./uploadRouter";

const imageSchema = z.object({
  key: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  url: z.string().min(1),
});

function buildFaqContent(input: {
  title: string;
  answerText: string;
  images?: Array<{ filename: string; url: string }>;
}) {
  const title = input.title.trim();
  const answer = input.answerText.trim();
  const images = input.images ?? [];

  const imagesBlock =
    images.length > 0
      ? `\n\nИзображения:\n${images
          .map((img, idx) => `![${img.filename || `image_${idx + 1}`}](${img.url})`)
          .join("\n")}`
      : "";

  return `Вопрос:\n${title}\n\nОтвет:\n${answer}${imagesBlock}`.trim();
}

export const faqRouter = router({
  list: adminProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const rows = await faqDb.listFaqEntries({ search: input?.search });
        return rows;
      } catch (error) {
        console.error("[FAQ] list error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list FAQ entries",
        });
      }
    }),

  create: adminProcedure
    .input(
      z.object({
        title: z.string().trim().min(3).max(512),
        answerText: z.string().trim().min(3),
        images: z.array(imageSchema).max(12).optional(),
        tags: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const content = buildFaqContent({
          title: input.title,
          answerText: input.answerText,
          images: input.images?.map((i) => ({ filename: i.filename, url: i.url })),
        });

        let embedding: number[] | null = null;
        try {
          embedding = await generateChunkEmbedding(content);
        } catch (e) {
          console.warn("[FAQ] embedding generation failed, saving without embedding:", e);
        }

        const id = await faqDb.createFaqEntry({
          title: input.title.trim(),
          answerText: input.answerText.trim(),
          content,
          images: input.images ?? null,
          embedding: embedding ? JSON.stringify(embedding) : null,
          bm25Terms: buildLexicalTerms(content),
          tags: input.tags ?? null,
          createdBy: ctx.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const created = await faqDb.getFaqEntryById(id);
        return { id, entry: created };
      } catch (error) {
        console.error("[FAQ] create error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? `Failed to create FAQ entry: ${error.message}` : "Failed to create FAQ entry",
        });
      }
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().trim().min(3).max(512),
        answerText: z.string().trim().min(3),
        images: z.array(imageSchema).max(12).optional(),
        tags: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const existing = await faqDb.getFaqEntryById(input.id);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "FAQ entry not found" });
        }

        const content = buildFaqContent({
          title: input.title,
          answerText: input.answerText,
          images: input.images?.map((i) => ({ filename: i.filename, url: i.url })),
        });

        let embedding: number[] | null = null;
        try {
          embedding = await generateChunkEmbedding(content);
        } catch (e) {
          console.warn("[FAQ] embedding generation failed, saving without embedding:", e);
        }

        await faqDb.updateFaqEntry(input.id, {
          title: input.title.trim(),
          answerText: input.answerText.trim(),
          content,
          images: input.images ?? null,
          embedding: embedding ? JSON.stringify(embedding) : null,
          bm25Terms: buildLexicalTerms(content),
          tags: input.tags ?? null,
          updatedAt: new Date(),
        });

        const updated = await faqDb.getFaqEntryById(input.id);
        return { id: input.id, entry: updated };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[FAQ] update error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? `Failed to update FAQ entry: ${error.message}` : "Failed to update FAQ entry",
        });
      }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        const existing = await faqDb.getFaqEntryById(input.id);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "FAQ entry not found" });
        }
        await faqDb.deleteFaqEntry(input.id);
        return { deleted: true, images: existing.images ?? [] };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[FAQ] delete error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete FAQ entry",
        });
      }
    }),
});

