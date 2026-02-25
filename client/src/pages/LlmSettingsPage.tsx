import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Cpu, Cloud, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

export default function LlmSettingsPage() {
  const { data: settings, isLoading } = trpc.llm.getLlmSettings.useQuery();
  const { data: llmStatus } = trpc.llm.getLlmStatus.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const [provider, setProvider] = useState<"local" | "external">("local");
  const [externalApiUrl, setExternalApiUrl] = useState("");
  const [externalApiKey, setExternalApiKey] = useState("");
  const [externalModel, setExternalModel] = useState("");
  const [useQuickResponses, setUseQuickResponses] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (settings) {
      setProvider(settings.provider);
      setExternalApiUrl(settings.externalApiUrl || "");
      setExternalApiKey("");
      setExternalModel(settings.externalModel || "");
      setUseQuickResponses(settings.useQuickResponses ?? true);
    }
  }, [settings]);

  const updateMutation = trpc.llm.updateLlmSettings.useMutation({
    onSuccess: () => {
      toast.success("Настройки LLM сохранены");
      setHasChanges(false);
      setExternalApiKey("");
    },
    onError: (error) => {
      toast.error(error.message || "Ошибка сохранения");
    },
  });

  useEffect(() => {
    if (!settings) return;
    const urlChanged = externalApiUrl !== (settings.externalApiUrl || "");
    const modelChanged = externalModel !== (settings.externalModel || "");
    const providerChanged = provider !== settings.provider;
    const quickResponsesChanged =
      useQuickResponses !== (settings.useQuickResponses ?? true);
    const keyChanged = externalApiKey.length > 0;
    setHasChanges(
      providerChanged || urlChanged || modelChanged || keyChanged || quickResponsesChanged
    );
  }, [
    provider,
    externalApiUrl,
    externalModel,
    externalApiKey,
    useQuickResponses,
    settings,
  ]);

  const handleSave = () => {
    if (provider === "external" && !externalApiUrl.trim()) {
      toast.error("Укажите URL API для внешнего провайдера");
      return;
    }
    if (provider === "external" && !externalModel.trim()) {
      toast.error("Укажите модель для внешнего провайдера");
      return;
    }
    updateMutation.mutate({
      provider,
      externalApiUrl: externalApiUrl.trim() || undefined,
      externalApiKey: externalApiKey.trim() ? externalApiKey.trim() : undefined,
      externalModel: externalModel.trim() || undefined,
      useQuickResponses,
    });
  };

  if (isLoading || !settings) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Настройки LLM</h1>
        <p className="text-muted-foreground">
          Выберите локальную LLM (Ollama/Forge) или внешний провайдер (OpenRouter и др.)
        </p>
      </div>

      {llmStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Статус подключения</CardTitle>
            <CardDescription>
              {llmStatus.provider === "local"
                ? "Состояние локальной LLM для ответов на вопросы"
                : "Параметры внешнего API"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {llmStatus.provider === "local" ? (
              <>
                {llmStatus.forgeConfigured && !llmStatus.ollamaOk ? (
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span>Forge API настроен</span>
                  </div>
                ) : llmStatus.ollamaOk ? (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>Ollama: доступен ({llmStatus.ollamaUrl})</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {llmStatus.llmReady ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <span>LLM для ответов: {llmStatus.llmModel} — готов</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 text-amber-600" />
                          <span>LLM для ответов: {llmStatus.llmModel} — модель не загружена</span>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <XCircle className="h-4 w-4 text-amber-600" />
                    <span>
                      Ollama недоступен
                      {llmStatus.ollamaError && ` (${llmStatus.ollamaError})`}
                    </span>
                    {llmStatus.forgeConfigured && (
                      <span className="text-muted-foreground"> — используется Forge API</span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                {llmStatus.configured ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span>Внешний API настроен: {llmStatus.model}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-amber-600" />
                    <span>Внешний API: укажите API ключ</span>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Провайдер LLM</CardTitle>
          <CardDescription>
            Локальная модель (Ollama/Forge) или внешний API (OpenRouter, OpenAI и др.)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup
            value={provider}
            onValueChange={(v) => setProvider(v as "local" | "external")}
            className="grid grid-cols-2 gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="local" id="local" />
              <Label htmlFor="local" className="flex items-center gap-2 cursor-pointer">
                <Cpu className="h-4 w-4" />
                Локальная (Ollama / Forge)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="external" id="external" />
              <Label htmlFor="external" className="flex items-center gap-2 cursor-pointer">
                <Cloud className="h-4 w-4" />
                Внешний API (OpenRouter и др.)
              </Label>
            </div>
          </RadioGroup>

          {provider === "external" && (
            <div className="space-y-4 pt-4 border-t">
              <div className="space-y-2">
                <Label htmlFor="external-url">URL API</Label>
                <Input
                  id="external-url"
                  value={externalApiUrl}
                  onChange={(e) => setExternalApiUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                />
                <p className="text-xs text-muted-foreground">
                  Для OpenRouter: https://openrouter.ai/api/v1
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="external-key">API Key</Label>
                <Input
                  id="external-key"
                  type="password"
                  value={externalApiKey}
                  onChange={(e) => setExternalApiKey(e.target.value)}
                  placeholder={
                    settings.externalApiKeyMasked
                      ? `Текущий: ${settings.externalApiKeyMasked}`
                      : "Введите API ключ"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Оставьте пустым, чтобы сохранить текущий ключ
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="external-model">Модель</Label>
                <Input
                  id="external-model"
                  value={externalModel}
                  onChange={(e) => setExternalModel(e.target.value)}
                  placeholder="anthropic/claude-sonnet-4"
                />
                <p className="text-xs text-muted-foreground">
                  Например: anthropic/claude-sonnet-4, openai/gpt-4o
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor="quick-responses-toggle">Быстрые ответы</Label>
              <p className="text-xs text-muted-foreground">
                Вкл: быстрые ответы из чанков. Выкл: все вопросы отправляются в LLM.
              </p>
            </div>
            <Switch
              id="quick-responses-toggle"
              checked={useQuickResponses}
              onCheckedChange={setUseQuickResponses}
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateMutation.isPending}
              className="gap-2"
            >
              {updateMutation.isPending ? (
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
          </div>

          {hasChanges && (
            <p className="text-sm text-amber-600">
              Есть несохранённые изменения
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Справка</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>
            <strong>Локальная LLM</strong> использует Ollama (если настроен OLLAMA_BASE_URL)
            или встроенный Forge API (BUILT_IN_FORGE_API_URL, BUILT_IN_FORGE_API_KEY).
          </p>
          <p>
            <strong>Внешний API</strong> — например{" "}
            <a
              href="https://openrouter.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              OpenRouter
            </a>
            . Получите API ключ на сайте провайдера и укажите модель в формате provider/model.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
