import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function ReviewRecoveryButton({
  ids,
  onBusyChange,
}: {
  ids: number[];
  onBusyChange: (busy: boolean) => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const status = trpc.document.getPassportRepairStatus.useQuery(
    { jobId: jobId ?? "" },
    { enabled: Boolean(jobId), refetchInterval: jobId ? 1500 : false }
  );
  const start = trpc.document.recoverInstallationReviews.useMutation({
    onSuccess: result => setJobId(result.jobId),
    onError: error => toast.error(error.message),
  });
  useEffect(() => {
    if (!jobId || !status.data || status.data.state === "running") return;
    if (status.data.state === "failed") toast.error(status.data.message);
    else if (status.data.errors?.length) toast.warning(status.data.message);
    else toast.success(status.data.message);
    setJobId(null);
    void utils.document.listDocuments.invalidate();
    void utils.document.getKnowledgeSyncSourceDocuments.invalidate();
    void utils.document.getInstallationDraft.invalidate();
  }, [jobId, status.data, utils]);
  useEffect(() => {
    onBusyChange(Boolean(jobId) || start.isPending);
  }, [jobId, start.isPending, onBusyChange]);
  return (
    <div className="space-y-2">
      <Button
        disabled={!ids.length || start.isPending || Boolean(jobId)}
        onClick={() => start.mutate({ ids })}
      >
        {jobId
          ? `Восстановление: ${status.data?.processed ?? 0}/${status.data?.total ?? ids.length}`
          : `Восстановить индексацию (${ids.length})`}
      </Button>
      {jobId && (
        <p className="text-sm text-muted-foreground">
          {status.data?.message || "Подготовка восстановления…"}
        </p>
      )}
    </div>
  );
}
