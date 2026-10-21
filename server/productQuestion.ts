const product=/труб|фитинг|редуктор|клапан|коллектор|радиатор|насос|кран|заглуш|муфт|тройник|переходник|термостат|счетчик|счётчик/i;
const task=/монтаж|монтир|установ|подключ|подбор|подобра|подобрать|выбра|выбор|характерист|параметр|описани|расска|обзор|что такое|для чего|зачем|как |како|каки|сколько|чем |можно|нужно ли|совмест|подойдет|подойдёт|размер|диаметр|давлен|температур|расход|цен[аыу]|стоим|паспорт|сертифик|гарант|неисправ|теч[ьеи]|слома|замен|опрессов|радиус|инструкц/i;
export const hasProductSubject=(query:string)=>product.test(query);
export function productTaskTargets(query:string):Array<"catalog"|"installation"> {
  return /монтаж|установ|подключ/i.test(query)?["installation"]:["catalog","installation"];
}
export function isProductOnlyQuery(query:string):boolean {
  const value=query.trim().replace(/ё/g,"е");
  return value.split(/\s+/).length<=12 && product.test(value) && !task.test(value)
    && !/что это|назначени|применени|информаци|преимуществ|отличи|свойств|принцип|ассортимент|виды|типы/i.test(value);
}
export function productTaskQuestion(query:string):string {
  return `Что вас интересует по «${query.trim()}»: общее описание и характеристики, подбор под ваши условия или монтаж и совместимость?`;
}
export function clarifySearchFailure(query:string):string {
  return `По запросу «${query.trim()}» не удалось найти достаточно подходящих фрагментов для точного ответа. Это не означает, что изделия нет в базе.\n\nУточните, пожалуйста, модель, артикул или линейку изделия — для какого именно изделия нужен ответ?`;
}
export function isTaskSelection(query:string):boolean {
  return !hasProductSubject(query) && /^(?:мне (?:нужен|нужна|нужно|нужны)\s+)?(?:(?:общее|общие|технические|основные|полные|все)\s+)*(?:подбор|подобрать|характеристик[аиуы]?|описание|обзор|расскажи|расскажите|монтаж|установка|подключение|совместимость|эксплуатация|размеры|диаметр|давление|температура)(?:\s|[.!?,]|$)/i.test(query.trim()) && query.trim().split(/\s+/).length<=10;
}
