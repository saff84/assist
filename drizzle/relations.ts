import { relations } from "drizzle-orm";
import {
  users,
  documents,
  documentChunks,
  sections,
  products,
  systemPrompts,
  chatHistory,
} from "./schema";

/**
 * User relations
 */
export const usersRelations = relations(users, ({ many }) => ({
  uploadedDocuments: many(documents),
  createdPrompts: many(systemPrompts),
  chatHistory: many(chatHistory),
}));

/**
 * Documents relations
 */
export const documentsRelations = relations(documents, ({ one, many }) => ({
  uploader: one(users, {
    fields: [documents.uploadedBy],
    references: [users.id],
  }),
  chunks: many(documentChunks),
  sections: many(sections),
  products: many(products),
}));

/**
 * Document chunks relations
 */
export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

/**
 * Sections relations
 */
export const sectionsRelations = relations(sections, ({ one, many }) => ({
  document: one(documents, {
    fields: [sections.documentId],
    references: [documents.id],
  }),
  products: many(products),
}));

/**
 * Products relations
 */
export const productsRelations = relations(products, ({ one }) => ({
  document: one(documents, {
    fields: [products.documentId],
    references: [documents.id],
  }),
  section: one(sections, {
    fields: [products.sectionId],
    references: [sections.id],
  }),
}));

/**
 * System prompts relations
 */
export const systemPromptsRelations = relations(systemPrompts, ({ one }) => ({
  creator: one(users, {
    fields: [systemPrompts.createdBy],
    references: [users.id],
  }),
}));

/**
 * Chat history relations
 */
export const chatHistoryRelations = relations(chatHistory, ({ one }) => ({
  user: one(users, {
    fields: [chatHistory.userId],
    references: [users.id],
  }),
}));
