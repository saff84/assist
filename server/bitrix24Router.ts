import { router, publicProcedure, adminProcedure } from "./_core/trpc";
import { z } from "zod";
import * as ragModule from "./ragModule";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";
import { clientIp, consumeLimit, withRagCapacity } from "./_core/requestLimits";

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
        text: z.string().min(1).max(4000),
        userId: z.string().max(200).optional(),
        chatId: z.string().max(200).optional(),
        timestamp: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const secret = process.env.BITRIX24_INBOUND_SECRET?.trim();
      const provided = ctx.req.headers.authorization?.replace(/^Bearer /, "");
      if (!secret || secret.length < 32 || !provided || Buffer.byteLength(secret) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(provided))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Webhook authentication required" });
      }
      if (!consumeLimit(`bitrix:${clientIp(ctx.req)}`)) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      try {
        // Process the query through RAG
        const response = await withRagCapacity(() => ragModule.processRAGQuery({
          query: input.text,
          sessionId: input.chatId || input.userId,
          source: "bitrix24",
          topK: 5,
        }));

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
  getConfig: adminProcedure.query(() => {
    return {
      webhookUrl: "/api/trpc/bitrix24.webhook",
      configured: Boolean(process.env.BITRIX24_INBOUND_SECRET?.trim()),
      supportedEvents: ["message_add"],
      version: "1.0",
    };
  }),
});
