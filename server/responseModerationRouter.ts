import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "./_core/trpc";
import { responseModerationSchema } from "../shared/responseModeration";
import { responseModerationStore, validateModerationSettings } from "./responseModerationStore";
import { inspectResponseText } from "./responseModerationMatcher";

export const responseModerationRouter = router({
  get: adminProcedure.query(() => responseModerationStore.read()),
  save: adminProcedure.input(responseModerationSchema).mutation(({ input }) => {
    try { validateModerationSettings(input); }
    catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message }); }
    return responseModerationStore.save(input);
  }),
  preview: adminProcedure.input(z.object({ text: z.string().min(1).max(12000), settings: responseModerationSchema }))
    .mutation(({ input }) => {
      try { validateModerationSettings(input.settings); }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message }); }
      const finding = inspectResponseText(input.text, input.settings);
      return { ...finding, response: finding.blocked ? input.settings.fallback : input.text };
    }),
  events: adminProcedure.query(async () => (await responseModerationStore.events()).reverse()),
});
