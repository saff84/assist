import { regenerateAllEmbeddings } from "../server/regenerateEmbeddings";

async function main() {
  const result = await regenerateAllEmbeddings();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("[Embeddings] Regeneration failed:", error);
  process.exitCode = 1;
});

