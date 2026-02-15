import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessageSquare, Clock, TrendingUp, Globe, Briefcase, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function StatisticsPage() {
  // Fetch statistics
  const { data: stats, isLoading: statsLoading } = trpc.document.getStats.useQuery();
  const { data: chatHistory, isLoading: historyLoading } = trpc.document.getChatHistory.useQuery({
    limit: 50,
  });
  const { data: popularQuestions } = trpc.document.getPopularQuestions.useQuery({ limit: 10 });

  if (statsLoading || historyLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-96 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Загрузка статистики...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Статистика</h1>
        <p className="text-muted-foreground mt-1">Мониторинг производительности и использования ассистента</p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden transition-all hover:shadow-md hover:border-primary/50">
          <div className="absolute top-0 right-0 w-20 h-20 bg-primary/5 rounded-bl-full" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Всего запросов</CardTitle>
              <div className="p-2 bg-primary/10 rounded-lg">
                <BarChart3 className="w-4 h-4 text-primary" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats?.totalQueries || 0}</div>
            <p className="text-xs text-muted-foreground mt-2">Всего обработано запросов</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-all hover:shadow-md hover:border-blue-500/50">
          <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/5 rounded-bl-full" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Среднее время ответа</CardTitle>
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Clock className="w-4 h-4 text-blue-500" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats?.avgResponseTime || 0}<span className="text-lg text-muted-foreground">мс</span></div>
            <p className="text-xs text-muted-foreground mt-2">Среднее время ответа</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-all hover:shadow-md hover:border-green-500/50">
          <div className="absolute top-0 right-0 w-20 h-20 bg-green-500/5 rounded-bl-full" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Запросы с сайта</CardTitle>
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Globe className="w-4 h-4 text-green-500" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats?.queriesBySource?.website || 0}</div>
            <p className="text-xs text-muted-foreground mt-2">Из веб-чата</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden transition-all hover:shadow-md hover:border-purple-500/50">
          <div className="absolute top-0 right-0 w-20 h-20 bg-purple-500/5 rounded-bl-full" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Запросы Bitrix24</CardTitle>
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Briefcase className="w-4 h-4 text-purple-500" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">{stats?.queriesBySource?.bitrix24 || 0}</div>
            <p className="text-xs text-muted-foreground mt-2">Из Bitrix24</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Queries */}
        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              <CardTitle>Последние запросы</CardTitle>
            </div>
            <CardDescription>Последние взаимодействия с ассистентом</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {chatHistory && chatHistory.length > 0 ? (
                chatHistory.slice(0, 10).map((item, idx) => (
                  <div 
                    key={idx} 
                    className="border-b pb-3 last:border-b-0 transition-colors hover:bg-muted/50 rounded-md px-2 py-1 -mx-2"
                  >
                    <p className="text-sm font-medium line-clamp-2 text-foreground">{item.query}</p>
                    <div className="flex justify-between items-center mt-2">
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-medium",
                        item.source === "website" 
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : item.source === "bitrix24"
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {item.source === "website" ? "Сайт" : item.source === "bitrix24" ? "Bitrix24" : item.source}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString("ru-RU", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground font-medium">Запросов пока нет</p>
                  <p className="text-xs text-muted-foreground mt-1">Запросы появятся здесь после использования ассистента</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Popular Questions */}
        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <CardTitle>Популярные вопросы</CardTitle>
            </div>
            <CardDescription>Наиболее часто задаваемые вопросы</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {popularQuestions && popularQuestions.length > 0 ? (
                popularQuestions.map((item, idx) => (
                  <div 
                    key={idx} 
                    className="border-b pb-3 last:border-b-0 transition-colors hover:bg-muted/50 rounded-md px-2 py-1 -mx-2"
                  >
                    <p className="text-sm font-medium line-clamp-2 text-foreground">{item.query}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-primary/10 rounded-full">
                        <MessageSquare className="w-3 h-3 text-primary" />
                        <span className="text-xs font-medium text-primary">{item.count}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {item.count === 1 ? "раз" : item.count < 5 ? "раза" : "раз"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <TrendingUp className="w-12 h-12 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground font-medium">Данных пока нет</p>
                  <p className="text-xs text-muted-foreground mt-1">Популярные вопросы появятся после накопления статистики</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Info */}
      <Card className="transition-all hover:shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <CardTitle>Обзор производительности</CardTitle>
          </div>
          <CardDescription>Метрики здоровья системы и эффективности</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-3 p-4 rounded-lg bg-green-500/5 border border-green-500/20">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-green-500/10 rounded-md">
                  <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <span className="text-sm font-medium">Тренд запросов</span>
              </div>
              <p className="text-3xl font-bold tracking-tight">{stats?.totalQueries || 0}</p>
              <p className="text-xs text-muted-foreground">Всего обработано запросов</p>
            </div>

            <div className="space-y-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-500/10 rounded-md">
                  <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-sm font-medium">Скорость ответа</span>
              </div>
              <p className="text-3xl font-bold tracking-tight">{stats?.avgResponseTime || 0}<span className="text-lg text-muted-foreground">мс</span></p>
              <p className="text-xs text-muted-foreground">Среднее время ответа</p>
            </div>

            <div className="space-y-3 p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-purple-500/10 rounded-md">
                  <MessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <span className="text-sm font-medium">Источники</span>
              </div>
              <p className="text-3xl font-bold tracking-tight">
                {Object.values(stats?.queriesBySource || {}).reduce((a: number, b: number) => a + b, 0)}
              </p>
              <p className="text-xs text-muted-foreground">Запросы из всех источников</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
