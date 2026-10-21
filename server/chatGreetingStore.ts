import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { chatGreetingSchema, defaultChatGreeting, type ChatGreetingSettings } from "../shared/chatGreeting";
export const chatGreetingPath=path.resolve("uploads","settings","chat-greeting.json");
export async function readChatGreeting():Promise<ChatGreetingSettings> {
  try {return chatGreetingSchema.parse(JSON.parse(await fs.readFile(chatGreetingPath,"utf8")));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {...defaultChatGreeting};throw new Error("Не удалось прочитать настройки приветствия");}
}
export async function saveChatGreeting(settings:ChatGreetingSettings) {
  const value=chatGreetingSchema.parse(settings);
  await fs.mkdir(path.dirname(chatGreetingPath),{recursive:true});
  const temporary=`${chatGreetingPath}.${randomUUID()}.tmp`;
  try{await fs.writeFile(temporary,JSON.stringify(value,null,2),"utf8");await fs.rename(temporary,chatGreetingPath);}
  finally{await fs.rm(temporary,{force:true});}
  return value;
}
