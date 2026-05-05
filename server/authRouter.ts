import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { publicProcedure, router } from "./_core/trpc";
import { getAuthCookieName, getCookieSecureFlag, hashPassword, issueAuthToken, verifyPassword } from "./_core/auth";

const passwordSchema = z
  .string()
  .min(8, "Пароль должен содержать минимум 8 символов")
  .max(128, "Пароль слишком длинный");

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const LOCK_MS = 15 * 60 * 1000;

type LoginAttemptState = {
  attempts: number[];
  lockUntil: number;
};

const loginAttempts = new Map<string, LoginAttemptState>();

function getClientIp(rawIp: string | undefined): string {
  if (!rawIp) return "unknown";
  return rawIp.replace(/^::ffff:/, "");
}

function getAttemptKey(ip: string, email: string): string {
  return `${ip.toLowerCase()}|${email.trim().toLowerCase()}`;
}

function getRemainingLockMs(key: string, now: number): number {
  const state = loginAttempts.get(key);
  if (!state) return 0;
  if (state.lockUntil <= now) return 0;
  return state.lockUntil - now;
}

function registerFailedAttempt(key: string, now: number): number {
  const state = loginAttempts.get(key) ?? { attempts: [], lockUntil: 0 };
  state.attempts = state.attempts.filter((ts) => now - ts <= LOGIN_WINDOW_MS);
  state.attempts.push(now);

  if (state.attempts.length >= LOGIN_MAX_ATTEMPTS) {
    state.lockUntil = now + LOCK_MS;
    state.attempts = [];
  }

  loginAttempts.set(key, state);
  return state.lockUntil > now ? state.lockUntil - now : 0;
}

function resetAttempts(key: string) {
  loginAttempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, state] of loginAttempts.entries()) {
    const freshAttempts = state.attempts.filter((ts) => now - ts <= LOGIN_WINDOW_MS);
    const locked = state.lockUntil > now;
    if (!freshAttempts.length && !locked) {
      loginAttempts.delete(key);
      continue;
    }
    state.attempts = freshAttempts;
    loginAttempts.set(key, state);
  }
}, 60_000).unref();

export const authRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    return {
      user: ctx.user
        ? {
            id: ctx.user.id,
            name: ctx.user.name,
            email: ctx.user.email,
            role: ctx.user.role,
            mustChangePassword: ctx.user.mustChangePassword,
          }
        : null,
    };
  }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email("Введите корректный email"),
        password: z.string().min(1, "Введите пароль"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const email = input.email.trim().toLowerCase();
      const ip = getClientIp(ctx.req.ip);
      const key = getAttemptKey(ip, email);
      const now = Date.now();
      const remainingLockMs = getRemainingLockMs(key, now);

      if (remainingLockMs > 0) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Слишком много попыток входа. Повторите через ${Math.ceil(
            remainingLockMs / 1000
          )} сек.`,
        });
      }

      const user = await db.getUserByEmail(email);
      if (!user || !verifyPassword(input.password, user.passwordHash)) {
        const lockMs = registerFailedAttempt(key, now);
        throw new TRPCError({
          code: lockMs > 0 ? "TOO_MANY_REQUESTS" : "UNAUTHORIZED",
          message:
            lockMs > 0
              ? `Слишком много попыток входа. Повторите через ${Math.ceil(
                  lockMs / 1000
                )} сек.`
              : "Неверный email или пароль",
        });
      }

      resetAttempts(key);

      const token = await issueAuthToken(user.id);
      ctx.res.cookie(getAuthCookieName(), token, {
        httpOnly: true,
        secure: getCookieSecureFlag(),
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7,
        path: "/",
      });

      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        },
      };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    ctx.res.clearCookie(getAuthCookieName(), {
      path: "/",
      sameSite: "lax",
      secure: getCookieSecureFlag(),
      httpOnly: true,
    });
    return { success: true };
  }),

  changePassword: publicProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1, "Введите текущий пароль"),
        newPassword: passwordSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Требуется вход" });
      }
      if (!verifyPassword(input.currentPassword, ctx.user.passwordHash)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Неверный текущий пароль" });
      }
      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Новый пароль должен отличаться от текущего",
        });
      }

      await db.updateUserSecurity(ctx.user.id, {
        passwordHash: hashPassword(input.newPassword),
        mustChangePassword: false,
      });

      return { success: true };
    }),
});
