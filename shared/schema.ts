import { pgTable, text, serial, integer, timestamp, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users);
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// Telegram bot conversions table
export const conversions = pgTable("conversions", {
  id: serial("id").primaryKey(),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  conversionType: text("conversion_type").notNull(), // "TXT_TO_VCF" or "ADMIN_CV"
  fileName: text("file_name"),
  contactName: text("contact_name"),
  adminName: text("admin_name"),
  navyName: text("navy_name"),
  numberCount: integer("number_count"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertConversionSchema = createInsertSchema(conversions).omit({ 
  id: true, 
  createdAt: true 
});
export type Conversion = typeof conversions.$inferSelect;
export type InsertConversion = z.infer<typeof insertConversionSchema>;

// Conversion configuration types
export const conversionConfigSchema = z.object({
  contactName: z.string().min(1, "Contact name is required"),
  fileName: z.string().min(1, "File name is required"),
  splitLimit: z.coerce.number().min(1, "Limit must be at least 1").default(100),
});

export type ConversionConfig = z.infer<typeof conversionConfigSchema>;