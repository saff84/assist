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
    const userId = await verifyAuthToken(rawCookie);
    if (userId) {
      user = (await getUserById(userId)) ?? null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
