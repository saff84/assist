import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Code2, Copy, ExternalLink, Globe, Loader2, MessageSquare } from "lucide-react";

export default function WidgetPage() {
  const { data, isLoading, error } = trpc.widget.getOverview.useQuery();

  const copySnippet = async () => {
    if (!data?.embedSnippet) return;
    await navigator.clipboard.writeText(data.embedSnippet);
    toast.success("Код вставки скопирован");
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Загрузка настроек виджета...
        </div>
      </DashboardLayout>
    );
  }

  if (error || !data) {
    return (
      <DashboardLayout>
        <div className="p-6 text-destructive">
          Не удалось загрузить раздел виджета: {error?.message || "unknown error"}
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Виджет чата</h1>
          <p className="text-muted-foreground">
            Подключение чата на сторонние сайты и список доменов, которые уже обращались к виджету
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Подключённых сайтов</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <Globe className="w-6 h-6 text-blue-500" />
                {data.connectedSitesCount}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Уникальные Origin, которые вызывали API виджета
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Запросов с сайта</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <MessageSquare className="w-6 h-6 text-purple-500" />
                {data.websiteQueries}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Сообщения source=website в истории чата
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>CORS</CardDescription>
              <CardTitle className="text-lg">
                {data.allowAllOrigins ? "Все домены (*)" : `${data.allowedOrigins.length} в whitelist`}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground break-all">
              {data.allowAllOrigins
                ? "WIDGET_ALLOWED_ORIGINS=*"
                : Array.isArray(data.allowedOrigins)
                  ? data.allowedOrigins.join(", ") || "список пуст"
                  : String(data.allowedOrigins)}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code2 className="w-5 h-5" />
              Код для стороннего сайта
            </CardTitle>
            <CardDescription>
              Вставьте перед <code>&lt;/body&gt;</code>. CSS подтянется автоматически.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="rounded-lg bg-muted p-4 text-sm overflow-x-auto whitespace-pre-wrap">
              {data.embedSnippet}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={copySnippet}>
                <Copy className="w-4 h-4 mr-2" />
                Копировать
              </Button>
              <Button type="button" variant="outline" asChild>
                <a href={data.demoUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Открыть демо
                </a>
              </Button>
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                Публичный URL: <code>{data.publicBaseUrl}</code>
              </p>
              <p>
                Скрипт: <code>{data.scriptUrl}</code>
              </p>
              <p>
                Чтобы зафиксировать URL, задайте в <code>.env</code>:{" "}
                <code>PUBLIC_APP_URL={data.publicBaseUrl}</code>
              </p>
              <p>
                Whitelist доменов: <code>WIDGET_ALLOWED_ORIGINS=https://shop.example.com,https://www.shop.example.com</code>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Сайты, которые обращались к виджету</CardTitle>
            <CardDescription>
              Список появляется после реальных запросов с сайта (Origin заголовок)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.sites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Пока никто не подключался. Откройте демо или вставьте виджет на сайт и задайте вопрос.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Origin</th>
                      <th className="py-2 pr-4">Запросы</th>
                      <th className="py-2 pr-4">Чаты</th>
                      <th className="py-2 pr-4">Первый визит</th>
                      <th className="py-2">Последний визит</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sites.map((site) => (
                      <tr key={site.origin} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium break-all">{site.origin}</td>
                        <td className="py-2 pr-4">{site.requestCount}</td>
                        <td className="py-2 pr-4">{site.chatCount}</td>
                        <td className="py-2 pr-4">
                          {site.firstSeenAt ? new Date(site.firstSeenAt).toLocaleString() : "—"}
                        </td>
                        <td className="py-2">
                          {site.lastSeenAt ? new Date(site.lastSeenAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
