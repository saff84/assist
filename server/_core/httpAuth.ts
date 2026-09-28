import type { Request, Response, NextFunction } from "express";
import { getAuthCookieName, verifyAuthToken } from "./auth";
import { getUserById } from "../db";
import { canManageKnowledgeBase } from "./roles";

/**
 * Require logged-in admin/editor for knowledge-base mutating HTTP routes (upload).
 * GET file/companion stay public for widget attachments.
 */
export async function requireKnowledgeAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const rawCookie = req.cookies?.[getAuthCookieName()];
    if (typeof rawCookie !== "string" || !rawCookie) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const userId = await verifyAuthToken(rawCookie);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const user = await getUserById(userId);
    if (!user || !canManageKnowledgeBase(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    (req as any).user = user;
    next();
  } catch (error) {
    console.error("[Auth] requireKnowledgeAuth failed:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
}
