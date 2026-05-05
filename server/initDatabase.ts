import mysql from "mysql2/promise";
import crypto from "crypto";
import fs from "fs";
import path from "path";

type AdminCredentials = {
  email: string;
  password: string;
  name: string;
};

const DEFAULT_ADMIN_PASSWORD = "admin123";

function readAdminCredentials(): AdminCredentials {
  const defaultCreds: AdminCredentials = {
    email: process.env.ADMIN_EMAIL || "admin@admin.local",
    password: process.env.ADMIN_PASSWORD || "admin123",
    name: process.env.ADMIN_NAME || "Administrator",
  };

  try {
    const loginPath = path.join(process.cwd(), "LOGIN_INFO.txt");
    if (!fs.existsSync(loginPath)) return defaultCreds;

    const content = fs.readFileSync(loginPath, "utf8");
    const emailMatch = content.match(/Email:\s*(.+)/i);
    const passwordMatch = content.match(/Password:\s*(.+)/i);

    return {
      email: emailMatch?.[1]?.trim() || defaultCreds.email,
      password: passwordMatch?.[1]?.trim() || defaultCreds.password,
      name: defaultCreds.name,
    };
  } catch (e) {
    console.warn("[DB Init] Could not read LOGIN_INFO.txt, using defaults", e);
    return defaultCreds;
  }
}

/**
 * Initialize database schema and default admin
 */
export async function initializeDatabase() {
  if (process.env.NODE_ENV === "production") {
    const jwtSecret = process.env.JWT_SECRET?.trim();
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error(
        "JWT_SECRET must be configured and at least 32 characters in production"
      );
    }
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("[DB Init] DATABASE_URL not set, skipping initialization");
    return;
  }

  try {
    // Parse connection string
    const match = dbUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    if (!match) {
      console.error("[DB Init] Invalid DATABASE_URL format");
      return;
    }

    const [, user, password, host, port, databaseWithParams] = match;
    
    // Separate database name from URL parameters
    const database = databaseWithParams.split('?')[0];

    const maxAttempts = 40; // ~2 minutes with 3s delay
    const attemptDelayMs = 3000;

    let connection: mysql.Connection | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        connection = await mysql.createConnection({
          host,
          port: parseInt(port),
          user,
          password,
          database,
          charset: "utf8mb4",
        });
        break;
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.warn(
          `[DB Init] Waiting for MySQL (${attempt}/${maxAttempts}): ${msg}`
        );
        if (attempt === maxAttempts) {
          throw e;
        }
        await new Promise((r) => setTimeout(r, attemptDelayMs));
      }
    }

    if (!connection) {
      console.error("[DB Init] Could not establish DB connection");
      return;
    }

    console.log("[DB Init] Connected to database");

    // In production, schema changes should come only from drizzle migrations.
    const bootstrapSchema =
      process.env.DB_SCHEMA_BOOTSTRAP === "true" ||
      process.env.NODE_ENV !== "production";
    if (!bootstrapSchema) {
      console.log("[DB Init] Schema bootstrap disabled (using migrations only)");
    }

    const execStatementsSafely = async (
      statements: string[],
      allowedErrnos: number[] = [1060, 1061, 1267, 1291, 1146, 1050]
    ) => {
      for (const statement of statements) {
        try {
          await connection.execute(statement);
        } catch (e: any) {
          if (!allowedErrnos.includes(e?.errno)) {
            throw e;
          }
        }
      }
    };

    // Full schema creation (matches drizzle/schema.ts)
    const createStatements = [
      `
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        openId VARCHAR(64) NOT NULL UNIQUE,
        name TEXT,
        email VARCHAR(320) UNIQUE,
        passwordHash VARCHAR(255),
        loginMethod VARCHAR(64),
        role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
        mustChangePassword BOOLEAN NOT NULL DEFAULT FALSE,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX email_idx (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        fileType VARCHAR(20) NOT NULL,
        fileSize INT NOT NULL,
        uploadedBy INT NOT NULL,
        uploadedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status ENUM('processing', 'indexed', 'failed') NOT NULL DEFAULT 'processing',
        errorMessage LONGTEXT,
        chunksCount INT NOT NULL DEFAULT 0,
        s3Key VARCHAR(512),
        processingType ENUM('general', 'instruction', 'catalog', 'certificate', 'passport', 'warranty_faq') NOT NULL DEFAULT 'general',
        docType ENUM('catalog', 'instruction', 'general', 'certificate', 'passport', 'warranty_faq') NOT NULL DEFAULT 'general',
        title VARCHAR(512),
        year INT,
        pages INT,
        processingStage ENUM('queued','parsing','chunking','embedding','saving','completed','failed') NOT NULL DEFAULT 'queued',
        processingProgress INT NOT NULL DEFAULT 0,
        processingMessage LONGTEXT,
        documentMetadata JSON,
        tocJson JSON,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX uploadedBy_idx (uploadedBy),
        INDEX status_idx (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS document_chunks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        documentId INT NOT NULL,
        chunkIndex INT NOT NULL,
        content LONGTEXT NOT NULL,
        embedding LONGTEXT,
        tokenCount INT NOT NULL DEFAULT 0,
        pageNumber INT,
        sectionPath VARCHAR(512),
        elementType ENUM('text','table','figure','list','header') NOT NULL DEFAULT 'text',
        tableJson JSON,
        language VARCHAR(8) NOT NULL DEFAULT 'ru',
        bm25Terms LONGTEXT,
        chunkMetadata JSON,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX documentId_idx (documentId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS sections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        documentId INT NOT NULL,
        sectionPath VARCHAR(512) NOT NULL,
        title VARCHAR(512) NOT NULL,
        level INT NOT NULL DEFAULT 1,
        parentPath VARCHAR(512),
        pageStart INT,
        pageEnd INT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX sections_document_idx (documentId),
        INDEX sections_sectionPath_idx (sectionPath)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        documentId INT NOT NULL,
        sectionId INT,
        groupId INT,
        sku VARCHAR(128) NOT NULL,
        name VARCHAR(512),
        attributes JSON,
        pageNumber INT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX products_document_idx (documentId),
        INDEX products_sku_idx (sku),
        INDEX products_group_idx (groupId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS product_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        documentId INT NOT NULL,
        name VARCHAR(512) NOT NULL,
        description TEXT,
        sectionPath VARCHAR(512),
        pageStart INT,
        pageEnd INT,
        createdBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX product_groups_document_idx (documentId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS product_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        documentId INT NOT NULL,
        groupId INT NOT NULL,
        name VARCHAR(512) NOT NULL,
        description TEXT,
        sortOrder INT NOT NULL DEFAULT 0,
        createdBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX product_items_document_idx (documentId),
        INDEX product_items_group_idx (groupId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS document_annotations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        documentId INT NOT NULL,
        chunkIndex INT NOT NULL,
        annotationType ENUM('table','technical_table','table_with_articles','text','figure','list','manual_region_group') NOT NULL,
        isNomenclatureTable BOOLEAN NOT NULL DEFAULT FALSE,
        productGroupId INT,
        notes TEXT,
        annotatedBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX annotations_document_idx (documentId),
        INDEX annotations_chunk_idx (documentId, chunkIndex),
        INDEX annotations_group_idx (productGroupId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS manual_regions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        documentId INT NOT NULL,
        pageNumber INT NOT NULL,
        regionType ENUM('text','table','technical_table','table_with_articles','figure','list','faq_question','faq_answer','certificate_answer') NOT NULL,
        coordinates JSON NOT NULL,
        extractedText TEXT,
        isNomenclatureTable BOOLEAN NOT NULL DEFAULT FALSE,
        productGroupId INT,
        productItemId INT,
        qaPairId INT,
        notes TEXT,
        createdBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX manual_regions_document_idx (documentId),
        INDEX manual_regions_page_idx (documentId, pageNumber)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS faq_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(512) NOT NULL,
        answerText LONGTEXT NOT NULL,
        content LONGTEXT NOT NULL,
        images JSON,
        embedding LONGTEXT,
        bm25Terms LONGTEXT,
        tags JSON,
        createdBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX faq_entries_createdBy_idx (createdBy)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS system_prompts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        prompt LONGTEXT NOT NULL,
        version INT NOT NULL DEFAULT 1,
        createdBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        INDEX isActive_idx (isActive)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS chat_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT,
        sessionId VARCHAR(128),
        query LONGTEXT NOT NULL,
        response LONGTEXT NOT NULL,
        source ENUM('website', 'bitrix24', 'test') NOT NULL,
        responseTime INT NOT NULL DEFAULT 0,
        tokensUsed INT NOT NULL DEFAULT 0,
        documentsUsed INT NOT NULL DEFAULT 0,
        diagnostics JSON,
        rating INT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX userId_idx (userId),
        INDEX source_idx (source),
        INDEX createdAt_idx (createdAt),
        INDEX sessionId_idx (sessionId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS query_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        date VARCHAR(10) NOT NULL,
        totalQueries INT NOT NULL DEFAULT 0,
        avgResponseTime DECIMAL(10,2) NOT NULL DEFAULT 0,
        websiteQueries INT NOT NULL DEFAULT 0,
        bitrix24Queries INT NOT NULL DEFAULT 0,
        avgTokensUsed DECIMAL(10,2) NOT NULL DEFAULT 0,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX date_idx (date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS llm_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        provider ENUM('local','external') NOT NULL DEFAULT 'local',
        externalApiUrl VARCHAR(512) DEFAULT 'https://openrouter.ai/api/v1',
        externalApiKey TEXT,
        externalModel VARCHAR(128) DEFAULT 'anthropic/claude-sonnet-4',
        useQuickResponses BOOLEAN NOT NULL DEFAULT TRUE,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
    ];

    if (bootstrapSchema) {
      await execStatementsSafely(createStatements, [1050]);
    }

    // Align existing tables with new columns/enums if database was created earlier
    const alterStatements = [
      // Users table backfills (older schema compatibility)
      `ALTER TABLE users ADD COLUMN passwordHash VARCHAR(255);`,
      `ALTER TABLE users ADD COLUMN loginMethod VARCHAR(64);`,
      `ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user';`,
      `ALTER TABLE users ADD COLUMN mustChangePassword BOOLEAN NOT NULL DEFAULT FALSE;`,
      `ALTER TABLE users ADD COLUMN lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`,

      // Ensure key enum columns exist even on older schemas
      `ALTER TABLE documents ADD COLUMN processingType ENUM('general','instruction','catalog','certificate','passport','warranty_faq') NOT NULL DEFAULT 'general';`,
      `ALTER TABLE documents ADD COLUMN docType ENUM('catalog','instruction','general','certificate','passport','warranty_faq') NOT NULL DEFAULT 'general';`,
      `ALTER TABLE documents ADD COLUMN processingStage ENUM('queued','parsing','chunking','embedding','saving','completed','failed') NOT NULL DEFAULT 'queued';`,
      `ALTER TABLE documents MODIFY COLUMN processingType ENUM('general','instruction','catalog','certificate','passport','warranty_faq') NOT NULL DEFAULT 'general';`,
      `ALTER TABLE documents MODIFY COLUMN docType ENUM('catalog','instruction','general','certificate','passport','warranty_faq') NOT NULL DEFAULT 'general';`,
      `ALTER TABLE documents MODIFY COLUMN processingStage ENUM('queued','parsing','chunking','embedding','saving','completed','failed') NOT NULL DEFAULT 'queued';`,
      `ALTER TABLE documents ADD COLUMN title VARCHAR(512);`,
      `ALTER TABLE documents ADD COLUMN year INT;`,
      `ALTER TABLE documents ADD COLUMN pages INT;`,
      `ALTER TABLE documents ADD COLUMN processingProgress INT NOT NULL DEFAULT 0;`,
      `ALTER TABLE documents ADD COLUMN processingMessage LONGTEXT;`,
      `ALTER TABLE documents ADD COLUMN documentMetadata JSON;`,
      `ALTER TABLE documents ADD COLUMN tocJson JSON;`,
      // document_chunks columns must exist before MODIFY
      `ALTER TABLE document_chunks ADD COLUMN elementType ENUM('text','table','figure','list','header') NOT NULL DEFAULT 'text';`,
      `ALTER TABLE document_chunks ADD COLUMN language VARCHAR(8) NOT NULL DEFAULT 'ru';`,
      `ALTER TABLE document_chunks ADD COLUMN pageNumber INT;`,
      `ALTER TABLE document_chunks ADD COLUMN sectionPath VARCHAR(512);`,
      `ALTER TABLE document_chunks ADD COLUMN tableJson JSON;`,
      `ALTER TABLE document_chunks ADD COLUMN bm25Terms LONGTEXT;`,
      `ALTER TABLE document_chunks ADD COLUMN chunkMetadata JSON;`,
      `ALTER TABLE document_chunks MODIFY COLUMN elementType ENUM('text','table','figure','list','header') NOT NULL DEFAULT 'text';`,
      `ALTER TABLE document_chunks MODIFY COLUMN language VARCHAR(8) NOT NULL DEFAULT 'ru';`,
      `ALTER TABLE chat_history MODIFY COLUMN source ENUM('website','bitrix24','test') NOT NULL;`,
      `ALTER TABLE chat_history ADD COLUMN diagnostics JSON;`,
      `ALTER TABLE products ADD COLUMN attributes JSON;`,
      `ALTER TABLE products ADD COLUMN pageNumber INT;`,
      `ALTER TABLE manual_regions MODIFY COLUMN regionType ENUM('text','table','technical_table','table_with_articles','figure','list','faq_question','faq_answer','certificate_answer') NOT NULL;`,
      `ALTER TABLE manual_regions ADD COLUMN isNomenclatureTable BOOLEAN NOT NULL DEFAULT FALSE;`,
      `ALTER TABLE manual_regions ADD COLUMN productGroupId INT;`,
      `ALTER TABLE manual_regions ADD COLUMN productItemId INT;`,
      `ALTER TABLE manual_regions ADD COLUMN qaPairId INT;`,
      `ALTER TABLE manual_regions ADD COLUMN notes TEXT;`,
      `ALTER TABLE product_items ADD COLUMN documentId INT NOT NULL;`,
      `ALTER TABLE product_items ADD COLUMN groupId INT NOT NULL;`,
      `ALTER TABLE product_items ADD COLUMN name VARCHAR(512) NOT NULL;`,
      `ALTER TABLE product_items ADD COLUMN description TEXT;`,
      `ALTER TABLE product_items ADD COLUMN sortOrder INT NOT NULL DEFAULT 0;`,
      `ALTER TABLE product_items ADD COLUMN createdBy INT NOT NULL;`,
      `ALTER TABLE product_items ADD COLUMN createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
      `ALTER TABLE product_items ADD COLUMN updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;`,
      `ALTER TABLE faq_entries ADD COLUMN title VARCHAR(512) NOT NULL;`,
      `ALTER TABLE faq_entries ADD COLUMN answerText LONGTEXT NOT NULL;`,
      `ALTER TABLE faq_entries ADD COLUMN content LONGTEXT NOT NULL;`,
      `ALTER TABLE faq_entries ADD COLUMN images JSON;`,
      `ALTER TABLE faq_entries ADD COLUMN embedding LONGTEXT;`,
      `ALTER TABLE faq_entries ADD COLUMN bm25Terms LONGTEXT;`,
      `ALTER TABLE faq_entries ADD COLUMN tags JSON;`,
      `ALTER TABLE faq_entries ADD COLUMN createdBy INT NOT NULL;`,
      `ALTER TABLE faq_entries ADD COLUMN createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
      `ALTER TABLE faq_entries ADD COLUMN updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;`,
      `ALTER TABLE document_annotations MODIFY COLUMN annotationType ENUM('table','technical_table','table_with_articles','text','figure','list','manual_region_group') NOT NULL;`,
      `ALTER TABLE document_annotations ADD COLUMN isNomenclatureTable BOOLEAN NOT NULL DEFAULT FALSE;`,
      `ALTER TABLE document_annotations ADD COLUMN productGroupId INT;`,
      `ALTER TABLE document_annotations ADD COLUMN notes TEXT;`,
      `ALTER TABLE llm_settings ADD COLUMN useQuickResponses BOOLEAN NOT NULL DEFAULT TRUE;`,
    ];

    if (bootstrapSchema) {
      await execStatementsSafely(alterStatements);
    }

    // Critical compatibility guardrails:
    // even in migration-only mode we must have auth/settings tables and required columns
    // so runtime init does not crash if a prior migration chain is partial.
    await execStatementsSafely([
      `
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        openId VARCHAR(64) NOT NULL UNIQUE,
        name TEXT,
        email VARCHAR(320) UNIQUE,
        passwordHash VARCHAR(255),
        loginMethod VARCHAR(64),
        role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
        mustChangePassword BOOLEAN NOT NULL DEFAULT FALSE,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX email_idx (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS system_prompts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        prompt LONGTEXT NOT NULL,
        version INT NOT NULL DEFAULT 1,
        createdBy INT NOT NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        isActive BOOLEAN NOT NULL DEFAULT TRUE,
        INDEX isActive_idx (isActive)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `
      CREATE TABLE IF NOT EXISTS llm_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        provider ENUM('local','external') NOT NULL DEFAULT 'local',
        externalApiUrl VARCHAR(512) DEFAULT 'https://openrouter.ai/api/v1',
        externalApiKey TEXT,
        externalModel VARCHAR(128) DEFAULT 'anthropic/claude-sonnet-4',
        useQuickResponses BOOLEAN NOT NULL DEFAULT TRUE,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `,
      `ALTER TABLE users ADD COLUMN passwordHash VARCHAR(255);`,
      `ALTER TABLE users ADD COLUMN loginMethod VARCHAR(64);`,
      `ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user';`,
      `ALTER TABLE users ADD COLUMN mustChangePassword BOOLEAN NOT NULL DEFAULT FALSE;`,
      `ALTER TABLE users ADD COLUMN lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
      `ALTER TABLE llm_settings ADD COLUMN useQuickResponses BOOLEAN NOT NULL DEFAULT TRUE;`,
    ]);

    // Check if admin exists
    const { email: adminEmail, password: adminPassword, name: adminName } = readAdminCredentials();

    const [rows] = await connection.execute(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [adminEmail]
    );

    let adminId: number;

    if (Array.isArray(rows) && rows.length === 0) {
      // Create admin
      const openId = `admin-${crypto.randomUUID()}`;
      const passwordHash = crypto.createHash('sha256').update(adminPassword).digest('hex');

      const [result] = await connection.execute(
        `INSERT INTO users (openId, name, email, passwordHash, loginMethod, role, mustChangePassword, lastSignedIn)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          openId,
          adminName,
          adminEmail,
          passwordHash,
          "email",
          "admin",
          adminPassword === DEFAULT_ADMIN_PASSWORD,
        ]
      );

      adminId = (result as any).insertId;

      console.log("[DB Init] ✅ Default admin created!");
      console.log(`[DB Init] Email: ${adminEmail}`);
      console.log(`[DB Init] Password: ${adminPassword}`);
    } else {
      adminId = (rows as any)[0].id;
      if (adminPassword === DEFAULT_ADMIN_PASSWORD) {
        const defaultPasswordHash = crypto
          .createHash("sha256")
          .update(DEFAULT_ADMIN_PASSWORD)
          .digest("hex");
        await connection.execute(
          "UPDATE users SET mustChangePassword = TRUE WHERE id = ? AND passwordHash = ?",
          [adminId, defaultPasswordHash]
        );
      }
      console.log("[DB Init] Admin already exists");
    }

    // Check if system prompt exists
    const [promptRows] = await connection.execute(
      "SELECT id FROM system_prompts WHERE isActive = TRUE LIMIT 1"
    );

    if (Array.isArray(promptRows) && promptRows.length === 0) {
      // Create default system prompt
      const defaultPrompt = `Вы - профессиональный AI-ассистент базы знаний.

ВАША РОЛЬ:
- Помогаете пользователям находить информацию в загруженных документах
- Отвечаете точно, опираясь только на предоставленный контекст
- Общаетесь профессионально, но дружелюбно

ПРАВИЛА ОТВЕТОВ:
1. Используйте только информацию из предоставленного контекста
2. Если информации нет в контексте - честно скажите об этом
3. Цитируйте конкретные фрагменты из документов, когда это уместно
4. Структурируйте ответы: используйте списки, заголовки, выделения
5. Если вопрос неясен - попросите уточнить

СТИЛЬ ОБЩЕНИЯ:
- Профессиональный, но не формальный
- Краткий, но информативный
- Понятный неспециалистам
- Без ненужных вводных фраз

ОГРАНИЧЕНИЯ:
- Не выдумывайте информацию
- Не давайте медицинские, юридические или финансовые советы
- Не обсуждайте политику или религию
- Не предоставляйте личную информацию о людях`;

      await connection.execute(
        `INSERT INTO system_prompts (prompt, version, createdBy, isActive)
         VALUES (?, ?, ?, TRUE)`,
        [defaultPrompt, 1, adminId]
      );

      console.log("[DB Init] ✅ Default system prompt created!");
    } else {
      console.log("[DB Init] System prompt already exists");
    }

    // Seed default LLM settings if none exist
    const [llmRows] = await connection.execute("SELECT id FROM llm_settings LIMIT 1");
    if (Array.isArray(llmRows) && llmRows.length === 0) {
      await connection.execute(
        `INSERT INTO llm_settings (provider, externalApiUrl, externalModel) VALUES ('local', 'https://openrouter.ai/api/v1', 'anthropic/claude-sonnet-4')`
      );
      console.log("[DB Init] ✅ Default LLM settings created (local provider)");
    }

    await connection.end();
  } catch (error) {
    console.error("[DB Init] Error:", error);
  }
}

