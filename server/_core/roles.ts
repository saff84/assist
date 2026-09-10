import { TRPCError } from "@trpc/server";

export const USER_ROLES = ["admin", "editor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function normalizeUserRole(role: string | null | undefined): UserRole {
  if (role === "admin") return "admin";
  // Legacy "user" and any unknown role map to editor (never escalate to admin)
  return "editor";
}

export function isAdmin(role: string | null | undefined): boolean {
  return normalizeUserRole(role) === "admin";
}

export function isEditor(role: string | null | undefined): boolean {
  return normalizeUserRole(role) === "editor";
}

/** Documents, FAQ, annotations, embeddings for a doc, test panel usage */
export function canManageKnowledgeBase(role: string | null | undefined): boolean {
  const normalized = normalizeUserRole(role);
  return normalized === "admin" || normalized === "editor";
}

/** Users, LLM, prompt, widget settings, global cleanup */
export function canManageSystem(role: string | null | undefined): boolean {
  return isAdmin(role);
}

export function assertKnowledgeAccess(user: { role: string }): void {
  if (!canManageKnowledgeBase(user.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Недостаточно прав для работы с базой знаний",
    });
  }
}

export function assertAdminAccess(user: { role: string }): void {
  if (!isAdmin(user.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Только администратор может выполнить это действие",
    });
  }
}
