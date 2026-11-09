import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getAuthCookieName, verifyAuthToken } from "./auth";
import { getUserById } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const rawCookie = opts.req.cookies?.[getAuthCookieName()];
  let user: User | null = null;

  if (typeof rawCookie === "string" && rawCookie.length > 0) {
    const session = await verifyAuthToken(rawCookie);
    if (session) {
      const candidate = await getUserById(session.userId);
      user = candidate && candidate.sessionVersion === session.sessionVersion ? candidate : null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
