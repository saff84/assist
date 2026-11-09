import { afterEach, beforeEach, expect, it, vi } from "vitest";
import crypto from "crypto";
import { SignJWT } from "jose";
const db = vi.hoisted(() => ({ getUserById: vi.fn(), getUserByEmail: vi.fn(), updateUserPassword: vi.fn(), updateUserSecurity: vi.fn(), revokeUserSessions: vi.fn() }));
vi.mock("./db", () => db);
import { hashPassword, verifyPassword, issueAuthToken, verifyAuthToken, getJwtSecret } from "./_core/auth";
import { createContext } from "./_core/context";
import { authRouter } from "./authRouter";
import { router, adminProcedure, knowledgeProcedure, protectedProcedure } from "./_core/trpc";
import { bootstrapAdminCredentials, validateBootstrapPassword } from "./_core/bootstrapAdmin";

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("JWT_SECRET", "unit-test-secret-012345678901234567890123456789"); });
afterEach(() => vi.unstubAllEnvs());

it("salts new passwords, rejects wrong passwords, and can verify legacy SHA-256", async () => {
  const first = await hashPassword("мой новый пароль");
  expect(first).not.toBe(await hashPassword("мой новый пароль"));
  expect(first).toMatch(/^scrypt\$/);
  expect(await verifyPassword("мой новый пароль", first)).toBe(true);
  expect(await verifyPassword("чужой пароль", first)).toBe(false);
  const old = crypto.createHash("sha256").update("legacy-password").digest("hex");
  expect(await verifyPassword("legacy-password", old)).toBe(true);
  expect(await verifyPassword("wrong", old)).toBe(false);
  expect(await verifyPassword("wrong", "corrupt")).toBe(false);
});

it("rejects old tokens, other token purposes, expired tokens and placeholder signing keys", async () => {
  const old = await new SignJWT({}).setSubject("1").setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(getJwtSecret());
  expect(await verifyAuthToken(old)).toBeNull();
  const resource = await new SignJWT({ purpose: "document", sessionVersion: 0 }).setSubject("1").setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(getJwtSecret());
  expect(await verifyAuthToken(resource)).toBeNull();
  const expired = await new SignJWT({ purpose: "auth", sessionVersion: 0 }).setSubject("1").setProtectedHeader({ alg: "HS256" }).setExpirationTime(1).sign(getJwtSecret());
  expect(await verifyAuthToken(expired)).toBeNull();
  vi.stubEnv("JWT_SECRET", "change-me-to-a-long-random-secret-at-least-32-chars");
  expect(() => getJwtSecret()).toThrow();
});

it("invalidates a session when the stored version changes", async () => {
  const token = await issueAuthToken(1, 3);
  const request = { req: { cookies: { assist_auth: token } }, res: {} } as any;
  db.getUserById.mockResolvedValue({ id: 1, sessionVersion: 3 });
  expect((await createContext(request)).user?.id).toBe(1);
  db.getUserById.mockResolvedValue({ id: 1, sessionVersion: 4 });
  expect((await createContext(request)).user).toBeNull();
});

it("upgrades legacy hashes at successful login and issues a token for the new session version", async () => {
  const user = { id: 1, email: "admin@test.local", role: "admin", sessionVersion: 0, passwordHash: crypto.createHash("sha256").update("legacy-password").digest("hex") };
  db.getUserByEmail.mockResolvedValue(user);
  db.updateUserPassword.mockImplementation(async (_id, passwordHash) => {
    db.getUserById.mockResolvedValue({ ...user, passwordHash, sessionVersion: 1 });
    return true;
  });
  const cookie = vi.fn();
  const caller = authRouter.createCaller({ req: { ip: "login-upgrade", headers: {} }, res: { cookie }, user: null } as any);
  await caller.login({ email: user.email, password: "legacy-password" });
  expect(db.updateUserPassword).toHaveBeenCalledWith(1, expect.stringMatching(/^scrypt\$/), user.passwordHash);
  expect(await verifyAuthToken(cookie.mock.calls[0][1])).toEqual({ userId: 1, sessionVersion: 1 });
});

it("does not overwrite a concurrent password reset during legacy migration", async () => {
  const user = { id: 1, email: "admin@test.local", sessionVersion: 0, passwordHash: crypto.createHash("sha256").update("legacy-password").digest("hex") };
  db.getUserByEmail.mockResolvedValue(user);
  db.updateUserPassword.mockResolvedValue(false);
  const cookie = vi.fn();
  const caller = authRouter.createCaller({ req: { ip: "login-race", headers: {} }, res: { cookie }, user: null } as any);
  await expect(caller.login({ email: user.email, password: "legacy-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(cookie).not.toHaveBeenCalled();
});

it("revokes sessions on logout", async () => {
  const clearCookie = vi.fn();
  await authRouter.createCaller({ user: { id: 7 }, res: { clearCookie } } as any).logout();
  expect(db.revokeUserSessions).toHaveBeenCalledWith(7);
  expect(clearCookie).toHaveBeenCalled();
});

it("renews the current browser session after changing a temporary password", async () => {
  const user = { id: 9, sessionVersion: 3, mustChangePassword: true, passwordHash: crypto.createHash("sha256").update("current-password").digest("hex") };
  db.updateUserSecurity.mockImplementation(async (_id, data, expected) => {
    expect(expected).toBe(user.passwordHash);
    db.getUserById.mockResolvedValue({ ...user, ...data, sessionVersion: 4 });
    return true;
  });
  const cookie = vi.fn();
  const caller = authRouter.createCaller({ user, req: {}, res: { cookie } } as any);
  await expect(caller.changePassword({ currentPassword: "current-password", newPassword: "new-password" })).resolves.toEqual({ success: true });
  expect(await verifyAuthToken(cookie.mock.calls[0][1])).toEqual({ userId: 9, sessionVersion: 4 });
});

it("does not issue a session for a password reset that raced with password change", async () => {
  const user = { id: 10, passwordHash: crypto.createHash("sha256").update("current-password").digest("hex") };
  db.updateUserSecurity.mockResolvedValue(true);
  db.getUserById.mockResolvedValue({ ...user, passwordHash: "different-admin-reset-hash", sessionVersion: 5 });
  const cookie = vi.fn();
  await expect(authRouter.createCaller({ user, req: {}, res: { cookie } } as any).changePassword({ currentPassword: "current-password", newPassword: "new-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(cookie).not.toHaveBeenCalled();
});

it("blocks all protected APIs until a temporary password has been changed", async () => {
  const caller = router({ admin: adminProcedure.query(() => true), knowledge: knowledgeProcedure.query(() => true), loggedIn: protectedProcedure.query(() => true) }).createCaller({ user: { role: "admin", mustChangePassword: true } } as any);
  for (const run of [caller.admin, caller.knowledge, caller.loggedIn]) await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("uses explicit bootstrap credentials and rejects default passwords", () => {
  vi.stubEnv("ADMIN_EMAIL", "owner@test.local"); vi.stubEnv("ADMIN_PASSWORD", "unique-bootstrap-12345");
  expect(bootstrapAdminCredentials()).toMatchObject({ email: "owner@test.local", password: "unique-bootstrap-12345" });
  expect(() => validateBootstrapPassword("admin123")).toThrow();
  expect(() => validateBootstrapPassword("")).toThrow();
  expect(() => validateBootstrapPassword("unique-bootstrap-12345")).not.toThrow();
});
