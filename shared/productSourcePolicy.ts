import type { QueryRoutingConfig, RouteTarget } from "./queryRouting";
export const isSourceComparison=(query:string)=>/сравн|сопостав/i.test(query)&&/каталог/i.test(query)&&/паспорт/i.test(query);
export const isProductInformationTask=(query:string)=>/характерист|параметр|описани|обзор|размер|диаметр|давлен|температур|подбор|подобрать|выбор|расскажи|расскажите|материал|корпус|масса|вес|длин|высот|ширин|резьб|присоедин|расход|\bkv|ттх|назначен|что такое|для чего/i.test(query);
export function productSourcePolicy(query:string,targets:RouteTarget[],config:Pick<QueryRoutingConfig,"productAnswersFromCatalogOnly">) {
  if(config.productAnswersFromCatalogOnly===false||!isProductInformationTask(query))return null;
  if(/монтаж|эксплуатац|совмест|подключ|установ|опрессов|сертифик|паспорт|гарант|неисправ/i.test(query))return null;
  if(!targets.some(target=>target==="catalog"||target==="installation"||target==="instruction"))return null;
  return {targets:["catalog"] as RouteTarget[],reason:"Описание, характеристики и подбор: только база товаров. Автоматический переход к паспортам запрещён."};
}
