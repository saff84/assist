import { beforeEach, expect, it, vi } from "vitest";
const files = vi.hoisted(() => ({ readFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), rm: vi.fn() }));
vi.mock("fs/promises", () => ({ default: files }));
import { readWidgetConsent, saveWidgetConsent, consentConfig } from "./widgetConsentStore";
import { widgetConsentSchema } from "../shared/widgetConsent";
beforeEach(() => vi.resetAllMocks());
it("defaults to disabled for existing installations", async () => {
  files.readFile.mockRejectedValue(Object.assign(new Error(), { code: "ENOENT" }));
  expect((await readWidgetConsent()).enabled).toBe(false);
});
it("saves editable text and the toggle atomically", async () => {
  const settings = widgetConsentSchema.parse({ enabled: true, text: "Моя компания\nМои условия", policyUrl: "https://example.com/privacy" });
  await saveWidgetConsent(settings);
  expect(files.writeFile).toHaveBeenCalledWith(expect.stringContaining(".tmp"), JSON.stringify(settings, null, 2), "utf8");
  expect(files.rename).toHaveBeenCalledOnce();
  files.readFile.mockResolvedValue(JSON.stringify(settings));
  expect(await readWidgetConsent()).toMatchObject(settings);
});
it("invalidates acceptance when text or policy changes", () => {
  const settings = widgetConsentSchema.parse({ enabled: true });
  const version = consentConfig(settings).version;
  expect(consentConfig({ ...settings, text: "Другие условия" }).version).not.toBe(version);
  expect(consentConfig({ ...settings, policyUrl: "https://example.com/privacy" }).version).not.toBe(version);
});
it("rejects invalid text and unsafe links", async () => {
  expect(widgetConsentSchema.safeParse({ text: " " }).success).toBe(false);
  expect(widgetConsentSchema.safeParse({ policyUrl: "javascript:alert(1)" }).success).toBe(false);
  files.readFile.mockResolvedValue("broken");
  await expect(readWidgetConsent()).rejects.toThrow("Не удалось прочитать");
});
