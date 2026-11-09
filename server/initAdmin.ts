import * as db from "./db";
import crypto from "crypto";
import { hashPassword } from "./_core/auth";
import { bootstrapAdminCredentials, validateBootstrapPassword } from "./_core/bootstrapAdmin";

/**
 * Initialize default admin user on first startup
 */
export async function initializeDefaultAdmin() {
  const { email: adminEmail, password: adminPassword, name: adminName } = bootstrapAdminCredentials();

  console.log(`[Init] Checking for admin user: ${adminEmail}`);

  try {
    // Check if admin already exists
    const existingAdmin = (await db.getAllUsers()).find(user => user.role === "admin");
    
    if (existingAdmin) {
      console.log(`[Init] Admin user already exists: ${adminEmail}`);
      return;
    }

    // Create admin user
    const openId = `admin-${crypto.randomUUID()}`;
    validateBootstrapPassword(adminPassword);
    const passwordHash = await hashPassword(adminPassword);

    await db.createUserWithPassword({
      openId,
      email: adminEmail,
      name: adminName,
      passwordHash,
      loginMethod: "email",
      role: "admin",
      mustChangePassword: true,
      lastSignedIn: new Date(),
    });

    console.log(`[Init] ✅ Default admin user created successfully!`);
    console.log(`[Init] Email: ${adminEmail}`);
    console.log(`[Init] Please change the password after first login!`);
  } catch (error) {
    console.error("[Init] Failed to create default admin:", error);
    throw error;
  }
}

