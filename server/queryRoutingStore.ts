import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { defaultQueryRouting, queryRoutingSchema, type QueryRoutingConfig } from "../shared/queryRouting";

export const queryRoutingPath = path.resolve("uploads", "settings", "query-routing.json");
export async function readQueryRouting(): Promise<QueryRoutingConfig> {
  try {
    return queryRoutingSchema.parse(JSON.parse(await fs.readFile(queryRoutingPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(defaultQueryRouting);
    throw new Error("Не удалось прочитать правила маршрутизации. Проверьте uploads/settings/query-routing.json.");
  }
}
export async function saveQueryRouting(config: QueryRoutingConfig) {
  const validated = queryRoutingSchema.parse(config);
  await fs.mkdir(path.dirname(queryRoutingPath), {recursive:true});
  const temporary = `${queryRoutingPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(validated, null, 2), "utf8");
    await fs.rename(temporary, queryRoutingPath);
  } finally { await fs.rm(temporary, {force:true}); }
  return validated;
}
