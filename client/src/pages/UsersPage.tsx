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
              Управление доступом и безопасность администратора
            </p>
          </div>
        </div>

        <Alert>
          <AlertDescription>
            На первом входе с дефолтным паролем система принудительно потребует смену пароля.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Встроенный администратор</CardTitle>
            <CardDescription>
              Базовый администратор создается автоматически, если отсутствует
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p><span className="font-semibold text-foreground">Имя:</span> задается через `ADMIN_NAME`</p>
            <p><span className="font-semibold text-foreground">Email:</span> задается через `ADMIN_EMAIL`</p>
            <p>
              <span className="font-semibold text-foreground">Права:</span> Полный доступ к загрузке документов, настройкам и тестовой панели.
            </p>
            <p>
              Для production задайте сильные значения `ADMIN_PASSWORD` и `JWT_SECRET`.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

