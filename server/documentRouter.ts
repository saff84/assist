import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import * as documentDb from "./documentDb";
import * as documentProcessor from "./documentProcessor";
import * as ragModule from "./ragModule";
import * as faqDb from "./faqDb";
import type { DocumentType } from "./rag/types";
import { regenerateAllEmbeddings, regenerateDocumentEmbeddings } from "./regenerateEmbeddings";
import { TRPCError } from "@trpc/server";
import {
  generateChunksFromManualRegions as buildManualChunks,
  generateChunkFromRegionSelection,
  generateWarrantyFaqChunksFromManualRegions,
} from "./manualChunkGenerator";
import { generateChunksFromManualProductItems } from "./manualChunkGenerator";

/**
 * Document management and RAG tRPC router
 */

export const documentRouter = router({
  /**
   * Get all documents
   */
  listDocuments: protectedProcedure.query(async () => {
    try {
      const docs = await documentDb.getAllDocuments();
      return docs;
    } catch (error) {
      console.error("Error listing documents:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to list documents",
      });
    }
  }),

  /**
   * Get document by ID
   */
  getDocument: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    try {
      const doc = await documentDb.getDocumentById(input.id);
      if (!doc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }
      return doc;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("Error getting document:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get document",
      });
    }
  }),

  /**
   * Get detailed document processing information (admin only)
   */
  getDocumentProcessingDetails: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        // Only admins can view processing details
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view document processing details",
          });
        }

        const details = await documentDb.getDocumentProcessingDetails(input.id);
        if (!details) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Document not found",
          });
        }
        return details;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error getting document processing details:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? `Failed to get document processing details: ${error.message}`
              : "Failed to get document processing details",
        });
      }
    }),

  /**
   * Generate a single chunk from selected manual regions
   */
  generateChunkFromSelectedRegions: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        regionIds: z.array(z.number()).min(1, "Не выбрано ни одной области"),
        regenerateEmbeddings: z.boolean().optional(),
        chunkTitle: z
          .string()
          .trim()
          .min(1, "Заголовок слишком короткий")
          .max(256, "Заголовок слишком длинный")
          .optional(),
        productGroupId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can generate chunks",
          });
        }

        if (input.productGroupId) {
          const group = await documentDb.getProductGroup(input.productGroupId);
          if (!group || group.documentId !== input.documentId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Выбранная товарная группа не принадлежит этому документу",
            });
          }
        }

        const result = await generateChunkFromRegionSelection(
          input.documentId,
          input.regionIds,
          {
            regenerateEmbeddings: input.regenerateEmbeddings ?? true,
            chunkTitle: input.chunkTitle,
            productGroupId: input.productGroupId,
            annotatedByUserId: ctx.user.id,
          }
        );

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error generating chunk from selected regions:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Не удалось создать чанк из выбранных областей",
        });
      }
    }),

  /**
   * Delete document (admin only)
   */
  deleteDocument: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        // Only admins can delete documents
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can delete documents",
          });
        }

        const doc = await documentDb.getDocumentById(input.id);
        if (!doc) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Document not found",
          });
        }

        await documentDb.deleteDocument(input.id);

        return { success: true, message: "Document deleted successfully" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error deleting document:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete document",
        });
      }
    }),

  /**
   * Get database cleanup statistics (admin only)
   */
  getCleanupStats: protectedProcedure.query(async ({ ctx }) => {
    try {
      // Only admins can view cleanup stats
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only administrators can view cleanup statistics",
        });
      }

      const stats = await documentDb.getCleanupStats();
      return stats;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("Error getting cleanup stats:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get cleanup statistics",
      });
    }
  }),

  /**
   * Clean up orphaned records (admin only)
   */
  cleanupOrphanedRecords: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      // Only admins can cleanup orphaned records
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only administrators can cleanup orphaned records",
        });
      }

      const result = await documentDb.cleanupOrphanedRecords();
      return {
        success: true,
        message: "Orphaned records cleaned up successfully",
        ...result,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("Error cleaning up orphaned records:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to cleanup orphaned records",
      });
    }
  }),

  /**
   * Get system prompt
   */
  getSystemPrompt: protectedProcedure.query(async () => {
    try {
      const prompt = await documentDb.getSystemPrompt();
      return prompt || { prompt: "You are a helpful AI assistant." };
    } catch (error) {
      console.error("Error getting system prompt:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get system prompt",
      });
    }
  }),

  /**
   * Update system prompt (admin only)
   */
  updateSystemPrompt: protectedProcedure
    .input(z.object({ prompt: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      try {
        // Only admins can update system prompt
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can update system prompts",
          });
        }

        const promptId = await documentDb.createSystemPrompt(input.prompt, ctx.user.id);
        return { success: true, promptId };
      } catch (error) {
        console.error("Error updating system prompt:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update system prompt",
        });
      }
    }),

  /**
   * Ask the assistant (RAG query)
   */
  askAssistant: publicProcedure
    .input(
      z.object({
        query: z.string().min(1),
        sessionId: z.string().optional(),
        source: z.enum(["website", "bitrix24", "test"]),
        forceDocumentType: z
          .enum([
            "catalog",
            "instruction",
            "general",
            "certificate",
            "passport",
            "warranty_faq",
          ] satisfies ReadonlyArray<DocumentType>)
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const response = await ragModule.processRAGQuery({
          query: input.query,
          sessionId: input.sessionId,
          userId: ctx.user?.id,
          source: input.source,
          topK: 5,
        }, {
          topK: 5,
          includeDiagnostics: input.source === "test",
          forceDocumentType: input.forceDocumentType,
        });

        return response;
      } catch (error) {
        console.error("Error processing RAG query:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process query",
        });
      }
    }),

  /**
   * Get assistant statistics
   */
  getStats: protectedProcedure.query(async () => {
    try {
      const stats = await ragModule.getAssistantStats();
      return stats;
    } catch (error) {
      console.error("Error getting stats:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get statistics",
      });
    }
  }),

  /**
   * Get available chat topics by DB content (public)
   * Used by the web widget to show/hide quick topic buttons.
   */
  getAvailableChatTopics: publicProcedure.query(async () => {
    try {
      const availability = await documentDb.getDocTypeAvailability([
        "certificate",
        "passport",
        "warranty_faq",
      ]);

      const hasFaqChunks = await faqDb.hasAnyFaqEntries().catch(() => false);
      return {
        hasCertificates: availability.certificate,
        hasPassports: availability.passport,
        hasWarrantyFaq: availability.warranty_faq || hasFaqChunks,
      };
    } catch (error) {
      console.error("Error getting available chat topics:", error);
      // Fail-open: hide optional topics on error
      return {
        hasCertificates: false,
        hasPassports: false,
        hasWarrantyFaq: false,
      };
    }
  }),

  /**
   * Update document title (admin only)
   * Used by manual annotation flows (certificate/passport) after upload.
   */
  updateDocumentTitle: protectedProcedure
    .input(
      z.object({
        documentId: z.number().int().positive(),
        title: z.string().trim().min(1).max(512).nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can update document title",
          });
        }

        await documentDb.updateDocumentTitle(
          input.documentId,
          input.title && input.title.trim().length > 0 ? input.title.trim() : null
        );

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error updating document title:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update document title",
        });
      }
    }),

  /**
   * Get chat history
   */
  getChatHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const history = await documentDb.getChatHistory(input.limit, input.offset);
        return history;
      } catch (error) {
        console.error("Error getting chat history:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get chat history",
        });
      }
    }),

  /**
   * Get statistics trend
   */
  getStatsTrend: protectedProcedure
    .input(
      z.object({
        days: z.number().default(30),
      })
    )
    .query(async ({ input }) => {
      try {
        const trend = await documentDb.getStatsTrend(input.days);
        return trend;
      } catch (error) {
        console.error("Error getting stats trend:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get statistics trend",
        });
      }
    }),

  /**
   * Get popular questions
   */
  getPopularQuestions: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(10),
      })
    )
    .query(async ({ input }) => {
      try {
        const questions = await documentDb.getPopularQuestions(input.limit);
        return questions;
      } catch (error) {
        console.error("Error getting popular questions:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get popular questions",
        });
      }
    }),

  /**
   * Regenerate embeddings for all documents (admin only)
   */
  regenerateAllEmbeddings: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      // Only admins can regenerate embeddings
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only administrators can regenerate embeddings",
        });
      }

      const result = await regenerateAllEmbeddings();
      return result;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("Error regenerating embeddings:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to regenerate embeddings",
      });
    }
  }),

  /**
   * Regenerate embeddings for a specific document (admin only)
   */
  regenerateDocumentEmbeddings: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        // Only admins can regenerate embeddings
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can regenerate embeddings",
          });
        }

        const result = await regenerateDocumentEmbeddings(input.documentId);
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error regenerating document embeddings:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to regenerate document embeddings",
        });
      }
    }),

  /**
   * Get full chunk content (admin only)
   */
  getChunkContent: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        chunkIndex: z.number(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        // Only admins can view chunk content
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view chunk content",
          });
        }

        const chunk = await documentDb.getChunkContent(input.documentId, input.chunkIndex);
        if (!chunk) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Chunk not found",
          });
        }
        return chunk;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error getting chunk content:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get chunk content",
        });
      }
    }),

  /**
   * Get all sections for a document (admin only)
   */
  getDocumentSections: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        // Only admins can view sections
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view document sections",
          });
        }

        const sections = await documentDb.getDocumentSections(input.documentId);
        return sections;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error getting document sections:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get document sections",
        });
      }
    }),

  /**
   * Get section details with chunks (admin only)
   */
  getSectionDetails: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        sectionPath: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        // Only admins can view section details
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view section details",
          });
        }

        const details = await documentDb.getSectionDetails(input.documentId, input.sectionPath);
        if (!details) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Section not found",
          });
        }
        return details;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error getting section details:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get section details",
        });
      }
    }),

  /**
   * Get product details with chunks (admin only)
   */
  getProductDetails: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        productSku: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        // Only admins can view product details
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view product details",
          });
        }

        const details = await documentDb.getProductDetails(input.documentId, input.productSku);
        if (!details) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Product not found",
          });
        }
        return details;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error getting product details:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get product details",
        });
      }
    }),

  /**
   * Get document annotations (admin only)
   */
  getDocumentAnnotations: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view annotations",
          });
        }

        const annotations = await documentDb.getDocumentAnnotations(input.documentId);
        return annotations;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error getting document annotations:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get annotations",
        });
      }
    }),

  /**
   * Get document chunks with annotations (admin only)
   */
  getDocumentChunksWithAnnotations: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view chunks with annotations",
          });
        }

        const chunks = await documentDb.getDocumentChunksWithAnnotations(input.documentId);
        return chunks;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error getting chunks with annotations:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get chunks with annotations",
        });
      }
    }),

  /**
   * Create or update chunk annotation (admin only)
   */
  upsertChunkAnnotation: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        chunkIndex: z.number(),
        annotationType: z.enum(["table", "technical_table", "table_with_articles", "text", "figure", "list"]),
        isNomenclatureTable: z.boolean().default(false),
        productGroupId: z.number().optional().nullable(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can create annotations",
          });
        }

        // Validate productGroupId if provided
        if (input.productGroupId !== undefined && input.productGroupId !== null) {
          const group = await documentDb.getProductGroup(input.productGroupId);
          if (!group || group.documentId !== input.documentId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid productGroupId or group belongs to different document",
            });
          }
        }

        const annotationId = await documentDb.upsertChunkAnnotation({
          documentId: input.documentId,
          chunkIndex: input.chunkIndex,
          annotationType: input.annotationType,
          isNomenclatureTable: input.isNomenclatureTable ?? false,
          productGroupId: input.productGroupId ?? null,
          notes: input.notes ?? null,
          annotatedBy: ctx.user.id,
        });

        return { success: true, annotationId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error upserting chunk annotation:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save annotation",
        });
      }
    }),

  /**
   * Delete chunk annotation (admin only)
   */
  deleteChunkAnnotation: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        chunkIndex: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can delete annotations",
          });
        }

        await documentDb.deleteChunkAnnotation(input.documentId, input.chunkIndex);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error deleting chunk annotation:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete annotation",
        });
      }
    }),

  /**
   * Get product groups for a document (admin only)
   */
  getDocumentProductGroups: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view product groups",
          });
        }

        const groups = await documentDb.getDocumentProductGroups(input.documentId);
        return groups;
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;
        // If table doesn't exist, return empty array instead of error
        if (error?.code === 'ER_NO_SUCH_TABLE' || error?.errno === 1146) {
          console.warn("Product groups table doesn't exist yet, returning empty array");
          return [];
        }
        console.error("Error getting product groups:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get product groups",
        });
      }
    }),

  /**
   * Create product group (admin only)
   */
  createProductGroup: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        name: z.string().min(1),
        description: z.string().optional(),
        sectionPath: z.string().optional(),
        pageStart: z.number().optional(),
        pageEnd: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can create product groups",
          });
        }

        const groupId = await documentDb.createProductGroup({
          documentId: input.documentId,
          name: input.name,
          description: input.description ?? null,
          sectionPath: input.sectionPath ?? null,
          pageStart: input.pageStart ?? null,
          pageEnd: input.pageEnd ?? null,
          createdBy: ctx.user.id,
        });

        return { success: true, groupId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error creating product group:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create product group",
        });
      }
    }),

  /**
   * Update product group (admin only)
   */
  updateProductGroup: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        sectionPath: z.string().optional(),
        pageStart: z.number().optional(),
        pageEnd: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can update product groups",
          });
        }

        const { groupId, ...updates } = input;
        await documentDb.updateProductGroup(groupId, updates);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error updating product group:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update product group",
        });
      }
    }),

  /**
   * Delete product group (admin only)
   */
  deleteProductGroup: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can delete product groups",
          });
        }

        await documentDb.deleteProductGroup(input.groupId);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error deleting product group:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete product group",
        });
      }
    }),

  /**
   * Get products in a group (admin only)
   */
  getProductsInGroup: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view products in group",
          });
        }

        const products = await documentDb.getProductsInGroup(input.groupId);
        return products;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error getting products in group:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get products in group",
        });
      }
    }),

  /**
   * Add products to group (admin only)
   */
  addProductsToGroup: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        productIds: z.array(z.number()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can add products to group",
          });
        }

        await documentDb.addProductsToGroup(input.groupId, input.productIds);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error adding products to group:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to add products to group",
        });
      }
    }),

  /**
   * Remove products from group (admin only)
   */
  removeProductsFromGroup: protectedProcedure
    .input(z.object({ productIds: z.array(z.number()) }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can remove products from group",
          });
        }

        await documentDb.removeProductsFromGroup(input.productIds);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error removing products from group:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove products from group",
        });
      }
    }),

  /**
   * Product items (inside a product group) - admin only
   */
  getProductItemsByGroup: protectedProcedure
    .input(z.object({ documentId: z.number(), groupId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view product items",
          });
        }

        const items = await documentDb.getProductItemsByGroup(input.documentId, input.groupId);
        return items;
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;
        if (error?.code === "ER_NO_SUCH_TABLE" || error?.errno === 1146) {
          console.warn("Product items table doesn't exist yet, returning empty array");
          return [];
        }
        console.error("Error getting product items:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get product items",
        });
      }
    }),

  createProductItem: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        groupId: z.number(),
        name: z.string().trim().min(1).max(512),
        description: z.string().optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can create product items",
          });
        }

        const group = await documentDb.getProductGroup(input.groupId);
        if (!group || group.documentId !== input.documentId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid groupId or group belongs to different document",
          });
        }

        const itemId = await documentDb.createProductItem({
          documentId: input.documentId,
          groupId: input.groupId,
          name: input.name,
          description: input.description ?? null,
          sortOrder: input.sortOrder ?? 0,
          createdBy: ctx.user.id,
        });

        return { success: true, itemId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error creating product item:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create product item",
        });
      }
    }),

  updateProductItem: protectedProcedure
    .input(
      z.object({
        itemId: z.number(),
        name: z.string().trim().min(1).max(512).optional(),
        description: z.string().optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can update product items",
          });
        }
        const { itemId, ...updates } = input;
        await documentDb.updateProductItem(itemId, updates as any);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error updating product item:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update product item",
        });
      }
    }),

  deleteProductItem: protectedProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can delete product items",
          });
        }

        await documentDb.deleteProductItem(input.itemId);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error deleting product item:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete product item",
        });
      }
    }),

  /**
   * Manual Regions Functions - for manual document annotation
   */

  /**
   * Get manual regions for a document (admin only)
   */
  getDocumentManualRegions: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can view manual regions",
          });
        }

        const regions = await documentDb.getDocumentManualRegions(input.documentId);
        return regions;
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;
        // If table doesn't exist, return empty array instead of error
        if (error?.code === 'ER_NO_SUCH_TABLE' || error?.errno === 1146) {
          console.warn("Manual regions table doesn't exist yet, returning empty array");
          return [];
        }
        console.error("Error getting manual regions:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get manual regions",
        });
      }
    }),

  /**
   * Create manual region (admin only)
   */
  createManualRegion: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        pageNumber: z.number(),
        regionType: z.enum([
          "text",
          "table",
          "technical_table",
          "table_with_articles",
          "figure",
          "list",
          "faq_question",
          "faq_answer",
          "certificate_answer",
        ]),
        coordinates: z.object({
          points: z.array(z.object({ x: z.number(), y: z.number() })),
          bbox: z.object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          }).optional(),
          normalizedPoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
          normalizedBBox: z.object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          }).optional(),
          pageDimensions: z.object({
            width: z.number(),
            height: z.number(),
          }).optional(),
          scaleAtCapture: z.number().optional(),
        }),
        isNomenclatureTable: z.boolean().default(false),
        productGroupId: z.number().optional().nullable(),
        productItemId: z.number().optional().nullable(),
        qaPairId: z.number().int().positive().optional().nullable(),
        notes: z.string().optional(),
        extractedText: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can create manual regions",
          });
        }

        // Validate product group/item relationship if provided
        if (input.productItemId) {
          const item = await documentDb.getProductItem(input.productItemId);
          if (!item || item.documentId !== input.documentId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid productItemId or item belongs to different document",
            });
          }
          if (input.productGroupId && item.groupId !== input.productGroupId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "productItemId does not belong to selected productGroupId",
            });
          }
        }

        const regionId = await documentDb.createManualRegion({
          documentId: input.documentId,
          pageNumber: input.pageNumber,
          regionType: input.regionType,
          coordinates: input.coordinates,
          isNomenclatureTable: input.isNomenclatureTable ?? false,
          productGroupId: input.productGroupId ?? null,
          productItemId: input.productItemId ?? null,
          qaPairId: input.qaPairId ?? null,
          notes: input.notes ?? null,
          extractedText: input.extractedText ?? null,
          createdBy: ctx.user.id,
        });

        return { success: true, regionId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error creating manual region:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create manual region",
        });
      }
    }),

  /**
   * Update manual region (admin only)
   */
  updateManualRegion: protectedProcedure
    .input(
      z.object({
        regionId: z.number(),
        regionType: z
          .enum([
            "text",
            "table",
            "technical_table",
            "table_with_articles",
            "figure",
            "list",
            "faq_question",
            "faq_answer",
            "certificate_answer",
          ])
          .optional(),
        coordinates: z
          .object({
            points: z.array(z.object({ x: z.number(), y: z.number() })),
            bbox: z.object({
              x: z.number(),
              y: z.number(),
              width: z.number(),
              height: z.number(),
            }).optional(),
            normalizedPoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
            normalizedBBox: z.object({
              x: z.number(),
              y: z.number(),
              width: z.number(),
              height: z.number(),
            }).optional(),
            pageDimensions: z.object({
              width: z.number(),
              height: z.number(),
            }).optional(),
            scaleAtCapture: z.number().optional(),
          })
          .optional(),
        isNomenclatureTable: z.boolean().optional(),
        productGroupId: z.number().optional().nullable(),
        productItemId: z.number().optional().nullable(),
        qaPairId: z.number().int().positive().optional().nullable(),
        notes: z.string().optional(),
        extractedText: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can update manual regions",
          });
        }

        const { regionId, ...updates } = input;

        if (updates.productItemId) {
          const current = await documentDb.getManualRegion(regionId);
          if (!current) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Manual region not found" });
          }
          const item = await documentDb.getProductItem(updates.productItemId);
          if (!item || item.documentId !== current.documentId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid productItemId or item belongs to different document",
            });
          }
          if (updates.productGroupId && item.groupId !== updates.productGroupId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "productItemId does not belong to selected productGroupId",
            });
          }
        }
        await documentDb.updateManualRegion(regionId, updates);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error updating manual region:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update manual region",
        });
      }
    }),

  /**
   * Delete manual region (admin only)
   */
  deleteManualRegion: protectedProcedure
    .input(z.object({ regionId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can delete manual regions",
          });
        }

        await documentDb.deleteManualRegion(input.regionId);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error deleting manual region:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete manual region",
        });
      }
    }),

  /**
   * Generate chunks from manual regions
   */
  generateChunksFromManualRegions: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        regenerateEmbeddings: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can generate chunks",
          });
        }

        const result = await buildManualChunks(input.documentId, {
          regenerateEmbeddings: input.regenerateEmbeddings ?? true,
          annotatedByUserId: ctx.user.id,
        });

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error generating manual chunks:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Не удалось создать чанки",
        });
      }
    }),

  /**
   * Generate one chunk per product item (group -> item -> chunk)
   */
  generateChunksFromManualProductItems: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        regenerateEmbeddings: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can generate chunks",
          });
        }

        const result = await generateChunksFromManualProductItems(input.documentId, {
          regenerateEmbeddings: input.regenerateEmbeddings,
          annotatedByUserId: ctx.user.id,
        });
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error generating product item chunks:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? `Failed to generate product item chunks: ${error.message}`
              : "Failed to generate product item chunks",
        });
      }
    }),

  /**
   * Generate warranty FAQ chunks from paired manual regions (admin only)
   */
  generateWarrantyFaqChunksFromManualRegions: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        regenerateEmbeddings: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only administrators can generate chunks",
          });
        }

        const result = await generateWarrantyFaqChunksFromManualRegions(input.documentId, {
          regenerateEmbeddings: input.regenerateEmbeddings ?? true,
        });

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error generating warranty FAQ chunks:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Не удалось создать FAQ-чанки",
        });
      }
    }),
});
