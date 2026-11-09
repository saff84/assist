import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "./_core/auth";
import type { WidgetConsentConfig } from "../shared/widgetConsent";

export async function recordWidgetConsent(config: WidgetConsentConfig, sessionId: string, origin: string) {
  const id = crypto.randomUUID();
  const acceptedAt = new Date().toISOString();
  const token = await new SignJWT({ purpose: "widget-consent", version: config.version, sessionId, origin })
    .setJti(id).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("24h").sign(getJwtSecret());
  const directory = path.resolve("uploads", "consent-audit");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  // No question text, password or auth cookie is written to this journal.
  await fs.appendFile(path.join(directory, `${acceptedAt.slice(0, 10)}.jsonl`), JSON.stringify({
    id, acceptedAt, sessionId, origin, version: config.version, text: config.text, policyUrl: config.policyUrl,
  }) + "\n", { encoding: "utf8", mode: 0o600 });
  return { token };
}
export async function hasWidgetConsent(token: string | undefined, version: string, sessionId: string | undefined, origin: string) {
  if (!token || !sessionId) return false;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] });
    return payload.purpose === "widget-consent" && payload.version === version && payload.sessionId === sessionId && payload.origin === origin;
  } catch { return false; }
}
