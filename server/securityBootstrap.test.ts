import { afterEach, beforeEach, expect, it, vi } from "vitest";
const sql = vi.hoisted(() => ({ execute: vi.fn(), end: vi.fn(), createConnection: vi.fn() }));
vi.mock("mysql2/promise", () => ({ default: { createConnection: sql.createConnection } }));
import { initializeDatabase } from "./initDatabase";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("JWT_SECRET", "unit-test-secret-012345678901234567890123456789");
  vi.stubEnv("DATABASE_URL", "mysql://test:unused@127.0.0.1:3306/test");
  vi.stubEnv("ADMIN_EMAIL", "different-from-existing@test.local"); vi.stubEnv("ADMIN_PASSWORD", "");
  vi.stubEnv("DB_SCHEMA_BOOTSTRAP", "false");
  sql.createConnection.mockResolvedValue(sql);
  sql.end.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("keeps an existing administrator even when LOGIN_INFO is removed and the configured email differs", async () => {
  sql.execute.mockImplementation(async (query: string) => {
    if (query.startsWith("SELECT id FROM users WHERE role")) return [[{ id: 7 }]];
    if (query.startsWith("SELECT id FROM system_prompts")) return [[{ id: 1 }]];
    return [[]];
  });
  await initializeDatabase();
  expect(sql.execute.mock.calls.some(([query]) => query.includes("INSERT INTO users"))).toBe(false);
  expect(sql.end).toHaveBeenCalledOnce();
});
it("refuses insecure first-run bootstrap and closes the database connection", async () => {
  sql.execute.mockResolvedValue([[]]);
  await expect(initializeDatabase()).rejects.toThrow("ADMIN_PASSWORD");
  expect(sql.execute.mock.calls.some(([query]) => query.includes("INSERT INTO users"))).toBe(false);
  expect(sql.end).toHaveBeenCalledOnce();
});

it.each(["false", "true"])("indexes full source URLs without exceeding utf8mb4 key limits (bootstrap=%s)", async bootstrap => {
  vi.stubEnv("DB_SCHEMA_BOOTSTRAP", bootstrap);
  sql.execute.mockImplementation(async (query: string) => {
    // Reproduce the production failure for the old full VARCHAR(1024) index.
    if (/documents_sourceUrl_uidx\s+(?:ON documents\s*)?\(sourceUrl\)/i.test(query)) {
      throw Object.assign(new Error("Specified key was too long"), { errno: 1071 });
    }
    if (query.startsWith("SELECT id FROM users WHERE role")) return [[{ id: 7 }]];
    if (query.startsWith("SELECT id FROM system_prompts")) return [[{ id: 1 }]];
    return [[]];
  });
  await expect(initializeDatabase()).resolves.toBeUndefined();
  const statements = sql.execute.mock.calls.map(([query]) => query as string);
  const indexes = statements.filter(query => query.includes("documents_sourceUrl_uidx"));
  expect(indexes.length).toBeGreaterThan(0);
  expect(indexes.every(query => query.includes("CAST(SHA2(sourceUrl, 256) AS CHAR(64))"))).toBe(true);
  expect(statements.some(query => /(?:MODIFY|CHANGE).*sourceUrl|DROP TABLE|TRUNCATE|DELETE FROM documents/i.test(query))).toBe(false);
  expect(sql.end).toHaveBeenCalledOnce();
});
