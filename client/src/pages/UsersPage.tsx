import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield } from "lucide-react";

export default function UsersPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <Shield className="h-10 w-10 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">User Management</h1>
            <p className="text-muted-foreground">
              Авторизация отключена, поэтому дополнительных аккаунтов нет
            </p>
          </div>
        </div>

        <Alert>
          <AlertDescription>
            Приложение работает в режиме без аутентификации. Доступ ко всем разделам
            всегда открыт, а встроенный админ создаётся автоматически при запуске.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Встроенный администратор</CardTitle>
            <CardDescription>
              Этот аккаунт используется для всех операций в системе
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p><span className="font-semibold text-foreground">Имя:</span> Admin User</p>
            <p><span className="font-semibold text-foreground">Email:</span> admin@localhost</p>
            <p>
              <span className="font-semibold text-foreground">Права:</span> Полный доступ к загрузке документов, настройкам и тестовой панели.
            </p>
            <p>
              При необходимости можно реализовать собственную систему авторизации, но по умолчанию
              никакой логин не требуется.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

