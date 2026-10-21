import { z } from "zod";
import { router, adminProcedure } from "./_core/trpc";
import { queryRoutingSchema, resolveQueryRoute } from "../shared/queryRouting";
import { readQueryRouting, saveQueryRouting } from "./queryRoutingStore";
import { listIntentTraces } from "./intentTrace";
import { listIntentRecommendations, reviewIntentRecommendation } from "./intentRecommendations";

export const queryRoutingRouter = router({
  traces: adminProcedure.query(()=>listIntentTraces()),
  recommendations: adminProcedure.query(()=>listIntentRecommendations()),
  review: adminProcedure.input(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),action:z.enum(["accept","dismiss"]),terms:z.array(z.string().trim().min(2).max(80)).min(1).max(20).optional()}))
    .mutation(({input})=>reviewIntentRecommendation(input.id,input.action,input.terms)),
  get: adminProcedure.query(() => readQueryRouting()),
  save: adminProcedure.input(queryRoutingSchema).mutation(({input}) => saveQueryRouting(input)),
  preview: adminProcedure.input(z.object({query:z.string().min(1).max(4000), config:queryRoutingSchema}))
    .mutation(({input}) => resolveQueryRoute(input.query, input.config)),
});
