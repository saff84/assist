import { z } from "zod";
import { and,eq,inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { documents, sections } from "../drizzle/schema";
import { getDb } from "./db";
import { adminProcedure, router } from "./_core/trpc";
import { documentApplicabilitySchema } from "../shared/documentApplicability";
import { readDocumentApplicability, saveDocumentApplicability } from "./documentApplicabilityStore";
async function resources() {
  const db=await getDb();if(!db)throw new Error("Database not available");
  return db.select({id:documents.id,title:documents.title,filename:documents.filename,docType:documents.docType}).from(documents)
    .where(and(eq(documents.status,"indexed"),inArray(documents.docType,["catalog","certificate","passport"])));
}
export const documentApplicabilityRouter=router({
  resources:adminProcedure.query(()=>resources()),
  get:adminProcedure.input(z.object({documentId:z.number().int().positive()})).query(({input})=>readDocumentApplicability(input.documentId)),
  categories:adminProcedure.input(z.object({catalogIds:z.array(z.number().int().positive()).max(100)})).query(async({input})=>{
    if(!input.catalogIds.length)return [];
    const db=await getDb();if(!db)throw new Error("Database not available");
    return db.select({title:sections.title,sectionPath:sections.sectionPath,documentId:sections.documentId})
      .from(sections).innerJoin(documents,eq(sections.documentId,documents.id))
      .where(and(inArray(sections.documentId,input.catalogIds),eq(documents.docType,"catalog"),eq(documents.status,"indexed")));
  }),
  save:adminProcedure.input(documentApplicabilitySchema).mutation(async({input})=>{
    const available=await resources();
    if(!available.some(doc=>doc.id===input.documentId&&(doc.docType==="passport"||doc.docType==="certificate")))throw new TRPCError({code:"BAD_REQUEST",message:"Выберите сохранённый сертификат или паспорт"});
    if(input.catalogIds.some(id=>!available.some(doc=>doc.id===id&&doc.docType==="catalog")))throw new TRPCError({code:"BAD_REQUEST",message:"Один из выбранных каталогов не проиндексирован или удалён"});
    return saveDocumentApplicability(input);
  }),
});
