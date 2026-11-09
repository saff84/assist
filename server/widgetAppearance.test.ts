import { describe, expect, it } from "vitest";
import { defaultWidgetAppearance, widgetAppearanceSchema } from "../shared/widgetAppearance";

describe("widget appearance validation", () => {
  it("provides defaults and permits removing optional header elements", () => {
    expect(widgetAppearanceSchema.parse({})).toEqual(defaultWidgetAppearance);
    expect(widgetAppearanceSchema.parse({ brand: "", subtitle: "", logoUrl: "" }).brand).toBe("");
  });
  it("accepts HTTPS logos and uploaded raster images", () => {
    for (const logoUrl of ["https://example.com/logo.png", "data:image/png;base64,aGVsbG8="]) {
      expect(widgetAppearanceSchema.safeParse({ logoUrl }).success).toBe(true);
    }
  });
  it("rejects executable URLs, SVG uploads, oversized images and empty titles", () => {
    for (const logoUrl of ["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "http://example.com/logo.png", "x".repeat(700001)]) {
      expect(widgetAppearanceSchema.safeParse({ logoUrl }).success).toBe(false);
    }
    expect(widgetAppearanceSchema.safeParse({ title: "   " }).success).toBe(false);
  });
});
