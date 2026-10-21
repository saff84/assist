import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card,CardHeader,CardTitle,CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { documentApplicabilitySchema, type DocumentApplicability } from "@shared/documentApplicability";
import { toast } from "sonner";
const split=(value:string)=>Array.from(new Set(value.split(/\r?\n/).map(item=>item.trim()).filter(Boolean)));
type Resource={id:number;title:string|null;filename:string;docType:string};
function Editor({documentId,catalogs,onDirtyChange}:{documentId:number;catalogs:Resource[];onDirtyChange:(dirty:boolean)=>void}) {
  const query=trpc.documentApplicability.get.useQuery({documentId},{refetchOnWindowFocus:false});
  const [draft,setDraft]=useState<DocumentApplicability|null>(null);
  const [categories,setCategories]=useState("");const [lines,setLines]=useState("");const [skus,setSkus]=useState("");
  const [dirty,setDirty]=useState(false);
  useEffect(()=>onDirtyChange(dirty),[dirty,onDirtyChange]);
  useEffect(()=>{if(query.data&&!draft){setDraft(query.data);setCategories(query.data.categories.join("\n"));setLines(query.data.productLines.join("\n"));setSkus(query.data.skus.join("\n"));}},[query.data,draft]);
  const names=trpc.documentApplicability.categories.useQuery({catalogIds:draft?.catalogIds??[]},{enabled:!!draft?.catalogIds.length});
  const utils=trpc.useUtils();
  const save=trpc.documentApplicability.save.useMutation({onSuccess:value=>{setDraft(value);setDirty(false);utils.documentApplicability.get.setData({documentId},value);toast.success("Связи документа сохранены");},onError:error=>toast.error(error.message)});
  if(query.error)return <p role="alert">{query.error.message}</p>;
  if(!draft)return <p>Загрузка связей…</p>;
  return <fieldset disabled={save.isPending} className="space-y-5">
    <label className="block space-y-2"><span>Артикулы (прямая подтверждённая связь)</span><Textarea value={skus} rows={3} placeholder="44293" onChange={e=>{setSkus(e.target.value);setDirty(true);}}/></label>
    <div className="grid gap-4 md:grid-cols-2"><label className="block space-y-2"><span>Категории — точные названия разделов</span><Textarea value={categories} rows={4} placeholder="Заглушки" onChange={e=>{setCategories(e.target.value);setDirty(true);}}/></label><label className="block space-y-2"><span>Линейки — точные названия</span><Textarea value={lines} rows={4} placeholder="Фитинги PPSU Lite" onChange={e=>{setLines(e.target.value);setDirty(true);}}/></label></div>
    <div className="space-y-2"><p className="font-medium">Каталоги, на которые распространяется документ</p><p className="text-sm text-muted-foreground">Если категории и линейки пусты, связь действует для всех товаров выбранных каталогов. Иначе выбранные каталоги ограничивают поиск категорий и линеек. Прямые артикулы действуют независимо от каталога.</p>
      <div className="max-h-64 overflow-y-auto border rounded-md p-3 space-y-2">{catalogs.map(catalog=><label key={catalog.id} className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={draft.catalogIds.includes(catalog.id)} onChange={e=>{setDraft({...draft,catalogIds:e.target.checked?[...draft.catalogIds,catalog.id]:draft.catalogIds.filter(id=>id!==catalog.id)});setDirty(true);}}/>{catalog.title||catalog.filename}</label>)}</div>
    </div>
    {!!draft.catalogIds.length&&<details className="border rounded-lg p-3 text-sm"><summary className="cursor-pointer">Названия разделов выбранных каталогов</summary>{names.error?<p>{names.error.message}</p>:<ul className="mt-2 space-y-1">{names.data?.map((item,index)=><li key={index}>{item.sectionPath} — {item.title}</li>)}</ul>}</details>}
    <p className="text-sm text-muted-foreground">Вводите каждое значение с новой строки. Связи проверяются по точному названию, без учёта регистра и «ё/е». Если заданы и категории, и линейки, должны совпасть обе. Без выбранного каталога связь проверяется во всех каталогах. Для всей линейки PPSU Lite проще выбрать каталог «Фитинги_lite» и оставить категории и линейки пустыми. Проверяйте область применения самого сертификата перед сохранением.</p>
    <div className="flex flex-wrap gap-3"><Button disabled={!dirty||save.isPending} onClick={()=>{const value=documentApplicabilitySchema.safeParse({...draft,categories:split(categories),productLines:split(lines),skus:Array.from(new Set(skus.split(/[\n,;]+/).map(value=>value.trim()).filter(Boolean)))});if(!value.success){toast.error(value.error.issues[0].message);return;}save.mutate(value.data);}}>{save.isPending?"Сохранение…":"Сохранить подтверждённые связи"}</Button><Button variant="outline" onClick={()=>{setDraft({...draft,catalogIds:[]});setSkus("");setCategories("");setLines("");setDirty(true);}}>Очистить форму связей</Button></div>
  </fieldset>;
}
export default function DocumentApplicabilityPage() {
  const resources=trpc.documentApplicability.resources.useQuery();
  const [selected,setSelected]=useState(()=>Number(new URLSearchParams(window.location.search).get("documentId"))||0);
  const documents=resources.data?.filter(doc=>doc.docType==="certificate"||doc.docType==="passport")??[];
  const catalogs=resources.data?.filter(doc=>doc.docType==="catalog")??[];
  const [requested,setRequested]=useState<number|null>(null);
  const [editorDirty,setEditorDirty]=useState(false);
  return <div className="max-w-5xl mx-auto space-y-6 pb-10"><div><h1 className="text-3xl font-bold">Связи сертификатов и паспортов</h1><p className="text-muted-foreground mt-2">Подтверждённая применимость документа к артикулам, категориям и линейкам.</p></div>
    <Card><CardHeader><CardTitle>Как работает поиск</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>Приоритет: подтверждённые связи → точный артикул в названии PDF → подгруппа товара → родительские разделы и линейка каталога.</p><p>Автоматический подбор по названию не подтверждает применимость документа. Связь, которую вы сохраните здесь, считается проверенной администратором и используется первой. Различайте PPSU и PPSU Lite.</p><p>Связи сохраняются отдельно от чанков и не требуют переиндексации. Удалённые и неиндексированные документы не выдаются.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Документ и область применения</CardTitle></CardHeader><CardContent className="space-y-5">
      {resources.error&&<p role="alert">{resources.error.message}</p>}
      <label className="block space-y-2"><span>Сертификат или паспорт</span><select className="w-full border rounded-md p-2 bg-background" value={selected} onChange={e=>{const next=Number(e.target.value);if(editorDirty&&next!==selected)setRequested(next);else setSelected(next);}}><option value={0}>Выберите документ…</option>{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.docType==="certificate"?"Сертификат":"Паспорт"}: {doc.title||doc.filename}</option>)}</select></label>
      {requested!==null&&<div className="border rounded-md p-3 space-y-2"><p>При смене документа несохранённые изменения формы будут потеряны.</p><Button variant="outline" onClick={()=>{setSelected(requested);setRequested(null);}}>Перейти к другому документу</Button><Button variant="ghost" onClick={()=>setRequested(null)}>Остаться</Button></div>}
      {selected>0&&documents.some(doc=>doc.id===selected)&&<Editor key={selected} documentId={selected} catalogs={catalogs} onDirtyChange={setEditorDirty}/>}
    </CardContent></Card>
  </div>;
}
