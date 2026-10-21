import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { documentApplicabilitySchema, emptyApplicability, type DocumentApplicability } from "../shared/documentApplicability";
export const applicabilityRoot=path.resolve("uploads","document-applicability");
export async function readDocumentApplicability(documentId:number):Promise<DocumentApplicability> {
  if(!Number.isSafeInteger(documentId)||documentId<=0)throw new Error("Invalid document id");
  try{
    const value=documentApplicabilitySchema.parse(JSON.parse(await fs.readFile(path.join(applicabilityRoot,documentId+".json"),"utf8")));
    if(value.documentId!==documentId)throw new Error("Document id mismatch");return value;
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return emptyApplicability(documentId);throw error;}
}
export async function saveDocumentApplicability(input:DocumentApplicability) {
  const value=documentApplicabilitySchema.parse(input);
  await fs.mkdir(applicabilityRoot,{recursive:true});
  const target=path.join(applicabilityRoot,value.documentId+".json"),temporary=target+"."+randomUUID()+".tmp";
  try{await fs.writeFile(temporary,JSON.stringify(value,null,2),"utf8");await fs.rename(temporary,target);}
  finally{await fs.rm(temporary,{force:true});}
  return value;
}
export async function listDocumentApplicability() {
  let files:string[];
  try{files=await fs.readdir(applicabilityRoot);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  return Promise.all(files.filter(name=>/^[1-9]\d*\.json$/.test(name)).map(name=>readDocumentApplicability(Number.parseInt(name,10))));
}
