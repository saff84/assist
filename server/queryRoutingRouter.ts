import { z } from "zod";
import { router, adminProcedure } from "./_core/trpc";
import { queryRoutingSchema, resolveQueryRoute } from "../shared/queryRouting";
import { readQueryRouting, saveQueryRouting } from "./queryRoutingStore";

export const queryRoutingRouter = router({
  get: adminProcedure.query(() => readQueryRouting()),
  save: adminProcedure.input(queryRoutingSchema).mutation(({input}) => saveQueryRouting(input)),
  preview: adminProcedure.input(z.object({query:z.string().min(1).max(4000), config:queryRoutingSchema}))
    .mutation(({input}) => resolveQueryRoute(input.query, input.config)),
});
