import { z } from "zod";
export const chatGreetingSchema=z.object({
  description:z.string().trim().min(1,"Описание не должно быть пустым").max(3000),
  questionHelp:z.string().trim().max(3000),
});
export type ChatGreetingSettings=z.infer<typeof chatGreetingSchema>;
export const defaultChatGreeting:ChatGreetingSettings={
  description:"Здравствуйте! Я помощник SANEXT. Помогу с характеристиками и подбором продукции, совместимостью, монтажом, паспортами и сертификатами, гарантией и вопросами о компании.",
  questionHelp:"Укажите название изделия или артикул и конкретный вопрос. Для монтажа опишите условия и этап работ, для совместимости — оба изделия. Например: «Нужен сертификат на 5905» или «Как монтировать трубу Тёплый пол?» Если данных не хватит, я задам уточняющий вопрос.",
};
