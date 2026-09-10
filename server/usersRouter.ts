import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { adminProcedure, router } from "./_core/trpc";
import { hashPassword } from "./_core/auth";
import { USER_ROLES, type UserRole, isAdmin, normalizeUserRole } from "./_core/roles";
import * as db from "./db";
import { getDb } from "./db";
import { users } from "../drizzle/schema";

const roleSchema = z.enum(USER_ROLES);
const passwordSchema = z
  .string()
  .min(8, "Пароль должен содержать минимум 8 символов")
  .max(128, "Пароль слишком длинный");

export const usersRouter = router({
  list: adminProcedure.query(async () => {
    const all = await db.getAllUsers();
    return all.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: normalizeUserRole(user.role),
      mustChangePassword: user.mustChangePassword,
      lastSignedIn: user.lastSignedIn,
      createdAt: user.createdAt,
    }));
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        email: z.string().email(),
        password: passwordSchema,
        role: roleSchema.default("editor"),
      })
    )
    .mutation(async ({ input }) => {
      const email = input.email.trim().toLowerCase();
      const existing = await db.getUserByEmail(email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Пользователь с таким email уже существует",
        });
      }

      await db.createUserWithPassword({
        openId: `local-${crypto.randomUUID()}`,
        name: input.name.trim(),
        email,
        passwordHash: hashPassword(input.password),
        loginMethod: "email",
        role: input.role,
        mustChangePassword: true,
        lastSignedIn: new Date(),
      });

      const created = await db.getUserByEmail(email);
      return {
        id: created!.id,
        name: created!.name,
        email: created!.email,
        role: created!.role,
        mustChangePassword: created!.mustChangePassword,
      };
    }),

  updateRole: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        role: roleSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id && input.role !== "admin") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Нельзя снять роль admin у самого себя",
        });
      }

      const target = await db.getUserById(input.userId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Пользователь не найден" });
      }

      if (isAdmin(target.role) && input.role !== "admin") {
        const all = await db.getAllUsers();
        const adminCount = all.filter((u) => isAdmin(u.role)).length;
        if (adminCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Нельзя снять роль с последнего администратора",
          });
        }
      }

      const database = await getDb();
      if (!database) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      }

      await database
        .update(users)
        .set({ role: input.role as UserRole })
        .where(eq(users.id, input.userId));

      return { success: true, userId: input.userId, role: input.role };
    }),

  resetPassword: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        newPassword: passwordSchema,
      })
    )
    .mutation(async ({ input }) => {
      const target = await db.getUserById(input.userId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Пользователь не найден" });
      }

      await db.updateUserSecurity(input.userId, {
        passwordHash: hashPassword(input.newPassword),
        mustChangePassword: true,
      });

      return { success: true };
    }),
});
