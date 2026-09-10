import type { Request, Response, NextFunction } from "express";

function parseAllowedOrigins(): string[] | "*" {
  const raw = process.env.WIDGET_ALLOWED_ORIGINS?.trim();
  if (!raw) {
    return process.env.NODE_ENV === "production" ? [] : "*";
  }
  if (raw === "*") {
    return "*";
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getAllowedOriginsConfig(): string[] | "*" {
  return parseAllowedOrigins();
}

function resolveAllowedOrigin(requestOrigin: string | undefined): string | null {
  const allowed = parseAllowedOrigins();

  if (!requestOrigin) {
    return null;
  }

  if (allowed === "*") {
    return requestOrigin;
  }

  if (allowed.includes(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}

export function applyWidgetCors(req: Request, res: Response): boolean {
  const requestOrigin = req.headers.origin;

  if (!requestOrigin) {
    return true;
  }

  const origin = resolveAllowedOrigin(requestOrigin);
  if (!origin) {
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  return true;
}

export function widgetCorsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/widget")) {
    next();
    return;
  }

  const allowed = applyWidgetCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(allowed ? 204 : 403).end();
    return;
  }

  if (!allowed && req.headers.origin) {
    res.status(403).json({ error: "Origin is not allowed" });
    return;
  }

  next();
}
