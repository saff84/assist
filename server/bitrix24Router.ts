import { router, publicProcedure } from "./_core/trpc";
import { z } from "zod";
import * as ragModule from "./ragModule";
import { TRPCError } from "@trpc/server";

/**
 * Bitrix24 webhook integration router
 * Handles incoming messages from Bitrix24
 */

export const bitrix24Router = router({
  /**
   * Webhook endpoint for Bitrix24 messages
   * Receives messages and returns AI responses
   */
  webhook: publicProcedure
    .input(
      z.object({
        messageId: z.string(),
        text: z.string(),
        userId: z.string().optional(),
        chatId: z.string().optional(),
        timestamp: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Process the query through RAG
        const response = await ragModule.processRAGQuery({
          query: input.text,
          sessionId: input.chatId || input.userId,
          source: "bitrix24",
          topK: 5,
        });

        // Return response in Bitrix24 format
        return {
          success: true,
          messageId: input.messageId,
          response: response.response,
          sources: response.sources,
          responseTime: response.responseTime,
        };
      } catch (error) {
        console.error("Error processing Bitrix24 webhook:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process message",
        });
      }
    }),

  /**
   * Get webhook configuration
   */
  getConfig: publicProcedure.query(() => {
    return {
      webhookUrl: process.env.BITRIX24_WEBHOOK_URL || "https://your-domain.com/api/trpc/bitrix24.webhook",
      supportedEvents: ["message_add"],
      version: "1.0",
    };
  }),
});
