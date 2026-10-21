import { beforeEach, expect, it, vi } from "vitest";
const files=vi.hoisted(()=>({readFile:vi.fn(),mkdir:vi.fn(),writeFile:vi.fn(),rename:vi.fn(),rm:vi.fn()}));
vi.mock("fs/promises",()=>({default:files}));
import { readChatGreeting, saveChatGreeting, chatGreetingPath } from "./chatGreetingStore";
import { chatGreetingRouter } from "./chatGreetingRouter";
import { defaultChatGreeting } from "../shared/chatGreeting";
beforeEach(()=>{vi.resetAllMocks();});
it("uses the same standard greeting until an administrator saves one",async()=>{
  files.readFile.mockRejectedValue(Object.assign(new Error("missing"),{code:"ENOENT"}));
  expect(await readChatGreeting()).toEqual(defaultChatGreeting);
});
it("saves Unicode and line breaks atomically in the persistent uploads volume",async()=>{
  const settings={description:"Здравствуйте!\nПомогаю с монтажом.",questionHelp:"Укажите артикул."};
  expect(await saveChatGreeting(settings)).toEqual(settings);
  expect(files.writeFile).toHaveBeenCalledWith(expect.stringContaining(chatGreetingPath),JSON.stringify(settings,null,2),"utf8");
  expect(files.rename).toHaveBeenCalledWith(expect.stringContaining(".tmp"),chatGreetingPath);
  files.readFile.mockResolvedValue(JSON.stringify(settings));
  expect(await readChatGreeting()).toEqual(settings);
});
it("rejects an empty description without overwriting saved settings",async()=>{
  await expect(saveChatGreeting({description:" ",questionHelp:"help"})).rejects.toThrow();
  expect(files.writeFile).not.toHaveBeenCalled();
  files.readFile.mockResolvedValue("corrupt");
  await expect(readChatGreeting()).rejects.toThrow("Не удалось прочитать");
});
it.each([null,"editor","user"])("permits settings changes only for administrators: %s",async role=>{
  const caller=chatGreetingRouter.createCaller({user:role?{role}:null} as any);
  await expect(caller.get()).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(caller.save(defaultChatGreeting)).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("lets an administrator retrieve and update the public greeting settings",async()=>{
  const caller=chatGreetingRouter.createCaller({user:{role:"admin"}} as any);
  files.readFile.mockResolvedValue(JSON.stringify(defaultChatGreeting));
  expect(await caller.get()).toEqual(defaultChatGreeting);
  expect(await caller.save({description:"Помощник SANEXT",questionHelp:""})).toEqual({description:"Помощник SANEXT",questionHelp:""});
});
