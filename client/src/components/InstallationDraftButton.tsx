import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export function InstallationDraftButton({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const draft = trpc.document.getInstallationDraft.useQuery(
    { id },
    { enabled: open }
  );
  const index = trpc.document.indexInstallationDraft.useMutation({
    onSuccess: async result => {
      toast.success(`Проиндексировано фрагментов: ${result.chunks}`);
      setOpen(false);
      await Promise.all([
        utils.document.getInstallationDraft.invalidate({ id }),
        utils.document.listDocuments.invalidate(),
        utils.document.getKnowledgeSyncSourceDocuments.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setMarkdown(null);
          setOpen(true);
        }}
      >
        Проверить MD
      </Button>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!index.isPending) setOpen(value);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Проверка Markdown перед индексацией</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Это ручная проверка перед публикацией знаний. Сверьте с PDF все
            страницы, начало и конец разделов, строки и колонки таблиц, артикулы,
            единицы измерения и ограничения. Если текст обрывается или таблицы
            потеряны, не запускайте индексацию — документ требует повторной обработки.
            После проверки нажмите «Сохранить и индексировать».
          </p>
          <div className="flex gap-3 text-sm">
            <a
              href={`/api/documents/${id}/file?download=1`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Скачать MD
            </a>
            <a
              href={`/api/documents/${id}/companion?download=1`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Оригинал PDF (если приложен)
            </a>
          </div>
          {draft.error && (
            <p className="text-destructive">{draft.error.message}</p>
          )}
          <textarea
            aria-label="Markdown документа"
            className="h-[55vh] w-full rounded border p-3 font-mono text-sm"
            disabled={!draft.data || index.isPending}
            value={markdown ?? draft.data?.markdown ?? ""}
            onChange={event => setMarkdown(event.target.value)}
          />
          <Button
            disabled={!draft.data || index.isPending}
            onClick={() =>
              index.mutate({ id, markdown: markdown ?? draft.data!.markdown })
            }
          >
            {index.isPending ? "Индексация…" : "Сохранить и индексировать"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
