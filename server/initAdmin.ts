import * as db from "./db";
import crypto from "crypto";

/**
 * Initialize default admin user on first startup
 */
export async function initializeDefaultAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@admin.local";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const adminName = process.env.ADMIN_NAME || "Administrator";

  console.log(`[Init] Checking for admin user: ${adminEmail}`);

  try {
    // Check if admin already exists
    const existingAdmin = await db.getUserByEmail(adminEmail);
    
    if (existingAdmin) {
      console.log(`[Init] Admin user already exists: ${adminEmail}`);
      return;
    }

    // Create admin user
    const openId = `admin-${crypto.randomUUID()}`;
    const passwordHash = crypto.createHash('sha256').update(adminPassword).digest('hex');

    await db.createUserWithPassword({
      openId,
      email: adminEmail,
      name: adminName,
      passwordHash,
      loginMethod: "email",
      role: "admin",
      lastSignedIn: new Date(),
    });

    console.log(`[Init] ✅ Default admin user created successfully!`);
    console.log(`[Init] Email: ${adminEmail}`);
    console.log(`[Init] Password: ${adminPassword}`);
    console.log(`[Init] Please change the password after first login!`);
  } catch (error) {
    console.error("[Init] Failed to create default admin:", error);
  }
}

