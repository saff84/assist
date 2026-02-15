export function useAuth() {
  return {
    user: {
      openId: "auth-disabled",
      name: "Admin",
      email: "admin@localhost",
      role: "admin" as const,
    },
    loading: false,
    error: null,
    isAuthenticated: true,
    refresh: () => Promise.resolve(),
    logout: () => Promise.resolve(),
  };
}
