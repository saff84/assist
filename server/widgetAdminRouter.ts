import { adminProcedure, router } from "./_core/trpc";
import { countWidgetSites, listWidgetSites } from "./widgetSitesDb";
import * as ragModule from "./ragModule";
import { getAllowedOriginsConfig } from "./_core/widgetCors";
import { widgetAppearanceSchema } from "../shared/widgetAppearance";
import { readWidgetAppearance, saveWidgetAppearance } from "./widgetAppearanceStore";
import { widgetConsentSchema } from "../shared/widgetConsent";
import { readWidgetConsent, saveWidgetConsent } from "./widgetConsentStore";

function resolvePublicBaseUrl(reqHost?: string, proto?: string): string {
  const fromEnv = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;

  if (reqHost) {
    const scheme = proto === "https" ? "https" : "http";
    return `${scheme}://${reqHost}`;
  }

  return "http://YOUR_PUBLIC_IP";
}

export const widgetAdminRouter = router({
  getConsent: adminProcedure.query(() => readWidgetConsent()),
  saveConsent: adminProcedure.input(widgetConsentSchema).mutation(({ input }) => saveWidgetConsent(input)),
  getAppearance: adminProcedure.query(() => readWidgetAppearance()),
  saveAppearance: adminProcedure.input(widgetAppearanceSchema).mutation(({ input }) => saveWidgetAppearance(input)),
  getOverview: adminProcedure.query(async ({ ctx }) => {
    const host = ctx.req.headers.host;
    const xfProto = String(ctx.req.headers["x-forwarded-proto"] || "").split(",")[0]?.trim();
    const publicBaseUrl = resolvePublicBaseUrl(host, xfProto || undefined);
    const allowedOrigins = getAllowedOriginsConfig();
    const sites = await listWidgetSites();
    const connectedSitesCount = await countWidgetSites();

    let websiteQueries = 0;
    try {
      const stats = await ragModule.getAssistantStats();
      websiteQueries = Number(stats?.queriesBySource?.website ?? 0);
    } catch {
      websiteQueries = sites.reduce((sum, site) => sum + site.chatCount, 0);
    }

    const widgetAssetVersion = "20261106-widget-security";
    const embedSnippet = `<script
  src="${publicBaseUrl}/chat-widget.js?v=${widgetAssetVersion}"
  data-api-url="${publicBaseUrl}"
  data-position="bottom-right"
  defer
></script>`;

    return {
      publicBaseUrl,
      demoUrl: `${publicBaseUrl}/widget-demo.html`,
      scriptUrl: `${publicBaseUrl}/chat-widget.js`,
      cssUrl: `${publicBaseUrl}/chat-widget.css`,
      embedSnippet,
      allowedOrigins,
      allowAllOrigins: allowedOrigins === "*",
      connectedSitesCount,
      websiteQueries,
      sites: sites.map((site) => ({
        origin: site.origin,
        requestCount: site.requestCount,
        chatCount: site.chatCount,
        firstSeenAt: site.firstSeenAt,
        lastSeenAt: site.lastSeenAt,
      })),
    };
  }),
});
