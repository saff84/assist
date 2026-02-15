import { processRAGQuery } from "../server/ragModule";

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        i++;
      }
    }
  }
  return options;
}

async function main() {
  const opts = parseArgs();
  const question =
    (typeof opts.question === "string" && opts.question) ||
    "расскажи об универсальной трубе";

  const result = await processRAGQuery(
    {
      query: question,
      source: "test",
    },
    {
      topK: 10,
      includeDiagnostics: true,
    }
  );

  console.log("=== RESPONSE ===");
  console.log(result.response);

  if (result.diagnostics) {
    if (result.diagnostics.context) {
      console.log("\n=== CONTEXT PREVIEW ===");
      console.log(result.diagnostics.context);
    }

    console.log("\n=== USED SOURCES ===");
    result.diagnostics.usedSources.forEach((source, index) => {
      console.log(
        `#${index + 1} ${source.filename} [${source.documentType}] relevance=${source.relevance.toFixed(
          3
        )}`
      );
      console.log(`Section: ${source.sectionPath ?? "n/a"}`);
      console.log(`Page: ${source.pageStart ?? "n/a"}`);
      console.log(`Boosts: ${source.boostsApplied.join(", ") || "none"}`);
      console.log("---");
    });

    if (result.diagnostics.retrieval) {
      console.log("\n=== TOP ORIGINAL ===");
      result.diagnostics.retrieval.topOriginal.slice(0, 10).forEach((entry) => {
        console.log(
          `Chunk ${entry.id} | relevance=${entry.relevance.toFixed(
            3
          )} | file=${entry.filename}`
        );
      });

      console.log("\n=== TOP AFTER MMR ===");
      result.diagnostics.retrieval.topAfterMmr
        .slice(0, 10)
        .forEach((entry) => {
          console.log(
            `Chunk ${entry.id} | relevance=${entry.relevance.toFixed(
              3
            )} | file=${entry.filename}`
          );
        });
    }
  }
}

main().catch((error) => {
  console.error("Debug run failed:", error);
  process.exit(1);
});

