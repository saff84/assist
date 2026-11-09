import type { Request, Response, NextFunction } from "express";
import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "./auth";
import { createContext } from "./context";

export async function signDocumentUrl(url: string): Promise<string> {
  const parsed = new URL(url, "http://widget.local");
  if (!/^\/api\/documents\/\d+\/(file|companion)$/.test(parsed.pathname)) throw new Error("Invalid attachment URL");
  const token = await new SignJWT({ purpose: "document", path: parsed.pathname })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(getJwtSecret());
  parsed.searchParams.set("access", token);
  return `${parsed.pathname}${parsed.search}`;
}
export async function verifyDocumentAccess(token: string, requestPath: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] });
    return payload.purpose === "document" && payload.path === requestPath;
  } catch { return false; }
}
export async function requireDocumentAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const { user } = await createContext({ req, res } as Parameters<typeof createContext>[0]);
    if (user && !user.mustChangePassword) { next(); return; }
    if (typeof req.query.access === "string" && await verifyDocumentAccess(req.query.access, req.path)) { next(); return; }
    res.status(401).json({ error: "Для документа требуется вход или действующая ссылка из ответа ассистента" });
  } catch { res.status(503).json({ error: "Не удалось проверить доступ" }); }
}
