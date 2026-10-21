import { z } from "zod";
import { router, adminProcedure } from "./_core/trpc";
import { queryRoutingSchema, resolveQueryRoute } from "../shared/queryRouting";
import { readQueryRouting, saveQueryRouting } from "./queryRoutingStore";
import { listIntentTraces } from "./intentTrace";
import { listIntentRecommendations, reviewIntentRecommendation } from "./intentRecommendations";
import { productSourcePolicy, isSourceComparison } from "../shared/productSourcePolicy";

export const queryRoutingRouter = router({
  traces: adminProcedure.query(()=>listIntentTraces()),
  recommendations: adminProcedure.query(()=>listIntentRecommendations()),
  review: adminProcedure.input(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),action:z.enum(["accept","dismiss"]),terms:z.array(z.string().trim().min(2).max(80)).min(1).max(20).optional()}))
    .mutation(({input})=>reviewIntentRecommendation(input.id,input.action,input.terms)),
  get: adminProcedure.query(() => readQueryRouting()),
  save: adminProcedure.input(queryRoutingSchema).mutation(({input}) => saveQueryRouting(input)),
  preview: adminProcedure.input(z.object({query:z.string().min(1).max(4000), config:queryRoutingSchema}))
    .mutation(({input}) => {
      if(isSourceComparison(input.query))return {ruleId:"source-comparison",ruleName:"Явное сравнение источников",term:"каталог и паспорт",target:"catalog" as const,additionalTargets:["installation" as const]};
      const rule=resolveQueryRoute(input.query,input.config);if(!rule)return null;
      const policy=productSourcePolicy(input.query,[rule.target,...rule.additionalTargets],input.config);
      return policy?{...rule,target:policy.targets[0],additionalTargets:policy.targets.slice(1),sourcePolicy:policy.reason}:rule;
    }),
});
