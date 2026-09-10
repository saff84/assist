import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Shield, Loader2 } from "lucide-react";
import { useState } from "react";

export default function UsersPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const listQuery = trpc.users.list.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "editor">("editor");
  const [resetPasswordById, setResetPasswordById] = useState<Record<number, string>>({});

  const createMutation = trpc.users.create.useMutation({
    onSuccess: async () => {
      toast.success("Пользователь создан");
      setName("");
      setEmail("");
      setPassword("");
      setRole("editor");
      await utils.users.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateRoleMutation = trpc.users.updateRole.useMutation({
    onSuccess: async () => {
      toast.success("Роль обновлена");
      await utils.users.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const resetPasswordMutation = trpc.users.resetPassword.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success("Пароль сброшен — при входе потребуется смена");
      setResetPasswordById((prev) => ({ ...prev, [variables.userId]: "" }));
      await utils.users.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Alert>
            <AlertDescription>Управление пользователями доступно только администратору.</AlertDescription>
          </Alert>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl p-6">
        <div className="flex items-center gap-3">
          <Shield className="h-10 w-10 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Пользователи</h1>
            <p className="text-muted-foreground">
              Роли: <strong>admin</strong> — полный доступ; <strong>editor</strong> — база знаний (документы, FAQ, тест)
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Создать пользователя</CardTitle>
            <CardDescription>Новому пользователю при первом входе нужно будет сменить пароль</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate({ name, email, password, role });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="name">Имя</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Временный пароль</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Роль</Label>
                <Select value={role} onValueChange={(value) => setRole(value as "admin" | "editor")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">editor — база знаний</SelectItem>
                    <SelectItem value="admin">admin — полный доступ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Создаём..." : "Создать"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Список пользователей</CardTitle>
          </CardHeader>
          <CardContent>
            {listQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Загрузка...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-3">Имя</th>
                      <th className="py-2 pr-3">Email</th>
                      <th className="py-2 pr-3">Роль</th>
                      <th className="py-2 pr-3">Сброс пароля</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(listQuery.data ?? []).map((item) => (
                      <tr key={item.id} className="border-b last:border-0 align-top">
                        <td className="py-3 pr-3 font-medium">{item.name || "—"}</td>
                        <td className="py-3 pr-3">{item.email}</td>
                        <td className="py-3 pr-3">
                          <Select
                            value={item.role === "admin" ? "admin" : "editor"}
                            onValueChange={(value) =>
                              updateRoleMutation.mutate({
                                userId: item.id,
                                role: value as "admin" | "editor",
                              })
                            }
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="editor">editor</SelectItem>
                              <SelectItem value="admin">admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex gap-2 items-center">
                            <Input
                              type="password"
                              placeholder="новый пароль"
                              className="max-w-[160px]"
                              value={resetPasswordById[item.id] || ""}
                              onChange={(e) =>
                                setResetPasswordById((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={
                                resetPasswordMutation.isPending ||
                                !(resetPasswordById[item.id] || "").trim()
                              }
                              onClick={() =>
                                resetPasswordMutation.mutate({
                                  userId: item.id,
                                  newPassword: resetPasswordById[item.id],
                                })
                              }
                            >
                              Сбросить
                            </Button>
                          </div>
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
