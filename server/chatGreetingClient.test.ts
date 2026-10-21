import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatGreetingContent } from "../client/src/components/ChatGreeting";
import { WidgetApiClient } from "../client/src/widget/api";
afterEach(()=>vi.unstubAllGlobals());
it("loads the same public settings contract used by the widget and test panel, without cached responses",async()=>{
  const settings={description:"Новый текст SANEXT",questionHelp:"Укажите модель"};
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>settings});vi.stubGlobal("fetch",fetch);
  expect(await new WidgetApiClient("https://example.test/").getGreeting()).toEqual(settings);
  expect(fetch).toHaveBeenCalledWith("https://example.test/api/widget/greeting",expect.objectContaining({cache:"no-store"}));
  expect(await new WidgetApiClient("").getGreeting()).toEqual(settings);
  expect(fetch).toHaveBeenLastCalledWith("/api/widget/greeting",expect.objectContaining({cache:"no-store"}));
});
it("renders edited text and line breaks identically and escapes embedded HTML",()=>{
  const html=renderToStaticMarkup(createElement(ChatGreetingContent,{settings:{description:"Строка 1\n<script>alert(1)</script>",questionHelp:"Артикул 5905"}}));
  expect(html).toContain("Строка 1\n&lt;script&gt;");expect(html).not.toContain("<script>");
  expect(html).toContain("Артикул 5905");expect(html).toContain("whitespace-pre-wrap");
});
it("rejects invalid configuration instead of displaying a malformed greeting",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({description:42})}));
  await expect(new WidgetApiClient("").getGreeting()).rejects.toThrow();
});
