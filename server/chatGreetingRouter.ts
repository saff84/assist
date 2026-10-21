import { adminProcedure, router } from "./_core/trpc";
import { chatGreetingSchema } from "../shared/chatGreeting";
import { readChatGreeting, saveChatGreeting } from "./chatGreetingStore";
export const chatGreetingRouter=router({
  get:adminProcedure.query(()=>readChatGreeting()),
  save:adminProcedure.input(chatGreetingSchema).mutation(({input})=>saveChatGreeting(input)),
});
