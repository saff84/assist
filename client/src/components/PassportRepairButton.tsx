import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export function PassportRepairButton({ id }: { id: number }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const status = trpc.document.getPassportRepairStatus.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: Boolean(jobId),
      refetchInterval: jobId ? 1500 : false,
    }
  );
  const repair = trpc.document.repairPassportKnowledge.useMutation({
    onSuccess: result => {
      setJobId(result.jobId);
      toast.info("Запущено обновление MD и чанков из исходного PDF");
      void utils.document.listDocuments.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  useEffect(() => {
    const result = status.data;
    if (!jobId || !result || result.state === "running") return;
    if (result.state === "done")
      toast.success(`MD и чанки обновлены. Фрагментов: ${result.chunks}`);
    else toast.error(result.message);
    setJobId(null);
    void utils.document.listDocuments.invalidate();
    void utils.document.getKnowledgeSyncSourceDocuments.invalidate();
    if (result.documentId)
      void utils.document.getInstallationDraft.invalidate({
        id: result.documentId,
      });
  }, [jobId, status.data, utils]);
  const busy = repair.isPending || Boolean(jobId);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => repair.mutate({ id })}
      title="Заново извлечь Markdown из PDF и заменить существующие чанки. Оригинал PDF сохраняется."
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {busy
        ? status.data?.state === "running"
          ? status.data.message
          : "Обновление…"
        : "Обновить MD и чанки"}
    </Button>
  );
}
