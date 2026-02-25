import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export default function PromptEditorPage() {
  const [prompt, setPrompt] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [basePrompt, setBasePrompt] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch additional instructions (stored in DB)
  const { data: currentPrompt, isLoading } = trpc.document.getSystemPrompt.useQuery();
  // Fetch base prompt (from file)
  const { data: templatePrompt, isLoading: isTemplateLoading } =
    trpc.document.getSystemPromptTemplate.useQuery();

  // Update system prompt mutation
  const updatePromptMutation = trpc.document.updateSystemPrompt.useMutation({
    onSuccess: () => {
      toast.success("Дополнительные инструкции сохранены");
      setOriginalPrompt(prompt);
      setHasChanges(false);
    },
    onError: (error) => {
      toast.error(error.message || "Не удалось сохранить дополнительные инструкции");
    },
  });

  useEffect(() => {
    const value = currentPrompt?.prompt ?? "";
    setPrompt(value);
    setOriginalPrompt(value);
  }, [currentPrompt]);

  useEffect(() => {
    setBasePrompt(templatePrompt?.prompt ?? "");
  }, [templatePrompt]);

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    setHasChanges(value !== originalPrompt);
  };

  const handleSave = () => {
    updatePromptMutation.mutate({ prompt });
  };

  const handleReset = () => {
    setPrompt(originalPrompt);
    setHasChanges(false);
  };

  if (isLoading || isTemplateLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Редактор промта</h1>
        <p className="text-muted-foreground">
          Основной промт используется как база, дополнительные инструкции дополняют его.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editor */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Основной промт (read-only)</CardTitle>
              <CardDescription>
                Загружается из `prompts/system.sanext.txt` (или пути из `RAG_SYSTEM_PROMPT_PATH`)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={basePrompt}
                readOnly
                className="min-h-72 font-mono text-sm"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Дополнительные инструкции</CardTitle>
              <CardDescription>
                Эти инструкции добавляются к основному промту и могут уточнять поведение.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={prompt}
                onChange={(e) => handlePromptChange(e.target.value)}
                placeholder="Например: Для таблиц всегда сохраняй все строки, включая последнюю."
                className="min-h-72 font-mono text-sm"
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || updatePromptMutation.isPending}
                  className="gap-2"
                >
                  {updatePromptMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Сохранение...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Сохранить
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleReset}
                  variant="outline"
                  disabled={!hasChanges}
                  className="gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Сброс
                </Button>
              </div>

              {hasChanges && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
                  Есть несохранённые изменения
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Preview & Tips */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Подсказки</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3 text-muted-foreground">
              <div>
                <p className="font-medium text-foreground mb-1">Точечные правила</p>
                <p>Добавляйте конкретные инструкции под текущие кейсы.</p>
              </div>

              <div>
                <p className="font-medium text-foreground mb-1">Без конфликтов</p>
                <p>Не дублируйте и не противоречьте базовому промту.</p>
              </div>

              <div>
                <p className="font-medium text-foreground mb-1">Проверка результата</p>
                <p>После изменения прогоните 2-3 тестовых запроса в Test Panel.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Текущие доп. инструкции</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm bg-muted p-3 rounded-md max-h-48 overflow-y-auto font-mono text-xs">
                {originalPrompt || "Не заданы"}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
