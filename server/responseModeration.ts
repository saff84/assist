import { defaultModerationFallback } from "../shared/responseModeration";
import { inspectResponseText } from "./responseModerationMatcher";
import { responseModerationStore, type ModerationEvent } from "./responseModerationStore";
import type { RAGResponse } from "./ragModule";

export async function moderateAssistantResponse(reply: RAGResponse, channel: ModerationEvent["channel"]): Promise<RAGResponse> {
  let fallback = defaultModerationFallback;
  let reason: ModerationEvent["reason"] = "term";
  let rules: string[] = [];
  try {
    const settings = await responseModerationStore.read();
    if (!settings.enabled) return reply;
    fallback = settings.fallback;
    const visible = [reply.response, ...reply.sources.flatMap(source => [source.filename, source.sectionPath ?? ""]),
      ...(reply.attachments ?? []).flatMap(attachment => [attachment.filename, attachment.title ?? ""])];
    let total = 0;
    for (const text of visible) {
      total += text.length;
      if (total > 200000) { reason = "too_long"; break; }
      const result = inspectResponseText(text, settings);
      if (result.blocked) { reason = result.reason ?? "term"; rules = result.rules; break; }
    }
    if (!rules.length && reason !== "too_long") return reply;
  } catch {
    reason = "settings_error";
    fallback = defaultModerationFallback;
  }
  try { await responseModerationStore.record(channel, reason, rules, reply.response); }
  catch { console.warn("[ResponseModeration] Could not write moderation journal"); }
  // Do not leak blocked text through source labels, attachments or debug context.
  return { ...reply, response: fallback, moderated: true, sources: [], attachments: [], chunks: undefined,
    diagnostics: undefined, suggestedTopics: [] };
}
