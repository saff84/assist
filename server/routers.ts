import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { documentRouter } from "./documentRouter";
import { bitrix24Router } from "./bitrix24Router";
import { faqRouter } from "./faqRouter";
import { llmRouter } from "./llmRouter";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  document: documentRouter,
  bitrix24: bitrix24Router,
  faq: faqRouter,
  llm: llmRouter,
});

export type AppRouter = typeof appRouter;
