export function bootstrapAdminCredentials() {
  return {
    email: process.env.ADMIN_EMAIL?.trim().toLowerCase() || "admin@admin.local",
    password: process.env.ADMIN_PASSWORD || "",
    name: process.env.ADMIN_NAME?.trim() || "Administrator",
  };
}
export function validateBootstrapPassword(password: string) {
  if (password.length < 12 || password.length > 128 || /^(admin123|change.me|replace.me|password)/i.test(password)) {
    throw new Error("Для первого администратора задайте уникальный ADMIN_PASSWORD длиной от 12 до 128 символов");
  }
}
