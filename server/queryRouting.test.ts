import { describe, expect, it } from "vitest";
import { defaultQueryRouting, matchRouteTerm, queryRoutingSchema, resolveQueryRoute, routeDocumentTypes } from "../shared/queryRouting";

describe("query routing",()=>{
  it.each(["монтаж трубы теплый пол", "условия монтажа труб", "монтажные требования"])("routes installation word forms: %s",query=>{
    expect(resolveQueryRoute(query,defaultQueryRouting)?.target).toBe("installation");
  });
  it.each([["Нужны СЕРТИФИКАТЫ на трубы!","certificate"],["номер сертификата","certificate"],["скачать паспорта","passport"],["техпаспорт трубы","passport"]])("routes document requests: %s",(query,target)=>{
    expect(resolveQueryRoute(query,defaultQueryRouting)?.target).toBe(target);
  });
  it("uses first enabled rule for mixed intents and respects ordering",()=>{
    const config=structuredClone(defaultQueryRouting);
    expect(resolveQueryRoute("монтаж трубы по паспорту",config)?.target).toBe("installation");
    config.rules.reverse();
    expect(resolveQueryRoute("монтаж трубы по паспорту",config)?.target).toBe("passport");
    config.rules[0].enabled=false;
    expect(resolveQueryRoute("монтаж трубы по паспорту",config)?.target).toBe("installation");
    config.enabled=false;
    expect(resolveQueryRoute("монтаж",config)).toBeNull();
  });
  it("matches whole words, phrases and trailing prefixes, not arbitrary substrings",()=>{
    expect(matchRouteTerm("демонтаж трубы","монтаж*")).toBe(false);
    expect(matchRouteTerm("монтажа трубы","монтаж")).toBe(false);
    expect(matchRouteTerm("тёплого пола","теплого пола")).toBe(true);
    expect(matchRouteTerm("условия монтажа теплого пола","теплого пол*")).toBe(true);
    expect(matchRouteTerm("теплого водяного пола","теплого пола")).toBe(false);
    expect(resolveQueryRoute("кто производит трубу",defaultQueryRouting)).toBeNull();
  });
  it("limits installation search to derived Markdown and instructions",()=>{
    expect(routeDocumentTypes("installation")).toEqual(["installation","instruction"]);
    expect(routeDocumentTypes("certificate")).toEqual(["certificate"]);
    expect(routeDocumentTypes("passport")).toEqual(["passport"]);
  });
  it("rejects empty rules, unknown targets and duplicate ids",()=>{
    const config=structuredClone(defaultQueryRouting);
    expect(queryRoutingSchema.safeParse(config).success).toBe(true);
    expect(queryRoutingSchema.safeParse({...config,rules:[{...config.rules[0],terms:[]}]}).success).toBe(false);
    expect(queryRoutingSchema.safeParse({...config,rules:[{...config.rules[0],target:"all"}]}).success).toBe(false);
    expect(queryRoutingSchema.safeParse({...config,rules:[config.rules[0],config.rules[0]]}).success).toBe(false);
  });
});
