import { z } from "zod";
export const documentApplicabilitySchema=z.object({
  documentId:z.number().int().positive(),
  skus:z.array(z.string().trim().regex(/^\d{4,8}$/,"Артикул должен содержать 4–8 цифр")).max(500),
  categories:z.array(z.string().trim().min(1).max(512)).max(100),
  productLines:z.array(z.string().trim().min(1).max(512)).max(100),
  catalogIds:z.array(z.number().int().positive()).max(100),
});
export type DocumentApplicability=z.infer<typeof documentApplicabilitySchema>;
export const emptyApplicability=(documentId:number):DocumentApplicability=>({documentId,skus:[],categories:[],productLines:[],catalogIds:[]});
export const normalizeCategory=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/ё/g,"е").replace(/[_\s]+/g," ").trim();
