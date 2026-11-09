import crypto from "crypto";
import { jwtVerify, SignJWT } from "jose";

const AUTH_COOKIE_NAME = "assist_auth";
const TOKEN_TTL_SEC = 60 * 60 * 24 * 7;

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32 || /change.me|example|your.secret|replace.me/i.test(secret)) {
    throw new Error("JWT_SECRET must be set and at least 32 characters long");
  }
  return new TextEncoder().encode(secret);
}

const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(rawPassword: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await derivePassword(rawPassword, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
export function isLegacyPasswordHash(hash: string): boolean { return /^[a-f0-9]{64}$/i.test(hash); }
export async function verifyPassword(rawPassword: string, passwordHash: string | null): Promise<boolean> {
  if (!passwordHash) return false;
  if (isLegacyPasswordHash(passwordHash)) {
    return crypto.timingSafeEqual(crypto.createHash("sha256").update(rawPassword).digest(), Buffer.from(passwordHash, "hex"));
  }
  const match = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(passwordHash);
  if (!match) return false;
  return crypto.timingSafeEqual(await derivePassword(rawPassword, Buffer.from(match[1], "hex")), Buffer.from(match[2], "hex"));
}

export async function issueAuthToken(userId: number, sessionVersion: number): Promise<string> {
  return new SignJWT({ sessionVersion, purpose: "auth" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SEC}s`)
    .sign(getJwtSecret());
}

export async function verifyAuthToken(token: string): Promise<{ userId: number; sessionVersion: number } | null> {
  try {
    const payload = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] });
    const userId = Number(payload.payload.sub);
    const sessionVersion = payload.payload.sessionVersion;
    return Number.isSafeInteger(userId) && userId > 0 && payload.payload.purpose === "auth" && typeof sessionVersion === "number" && Number.isSafeInteger(sessionVersion) && sessionVersion >= 0
      ? { userId, sessionVersion } : null;
  } catch {
    return null;
  }
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE_NAME;
}

export function getCookieSecureFlag(): boolean {
  const allowInsecureHttpAuth =
    process.env.ALLOW_INSECURE_HTTP_AUTH?.trim().toLowerCase() === "true";
  const override = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") {
    if (allowInsecureHttpAuth) return false;
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[Auth] AUTH_COOKIE_SECURE=false ignored in production because ALLOW_INSECURE_HTTP_AUTH is not true"
      );
    }
    return process.env.NODE_ENV === "production";
  }
  return process.env.NODE_ENV === "production";
}
