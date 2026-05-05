import crypto from "crypto";
import { jwtVerify, SignJWT } from "jose";

const AUTH_COOKIE_NAME = "assist_auth";
const TOKEN_TTL_SEC = 60 * 60 * 24 * 7;

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters long");
  }
  return new TextEncoder().encode(secret);
}

export function hashPassword(rawPassword: string): string {
  return crypto.createHash("sha256").update(rawPassword).digest("hex");
}

export function verifyPassword(rawPassword: string, passwordHash: string | null): boolean {
  if (!passwordHash) return false;
  return hashPassword(rawPassword) === passwordHash;
}

export async function issueAuthToken(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SEC}s`)
    .sign(getJwtSecret());
}

export async function verifyAuthToken(token: string): Promise<number | null> {
  try {
    const payload = await jwtVerify(token, getJwtSecret());
    const userId = Number(payload.payload.sub);
    return Number.isFinite(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE_NAME;
}

export function getCookieSecureFlag(): boolean {
  return process.env.NODE_ENV === "production";
}
