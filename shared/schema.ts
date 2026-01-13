import { pgTable, text, serial, integer, boolean, timestamp, bigint } from "drizzle-orm/pg-core";
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

// Membership packages table
export const membershipPackages = pgTable("membership_packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // "7 Hari", "15 Hari", "1 Bulan"
  days: integer("days").notNull(), // 7, 15, 30
  price: integer("price").notNull(), // 5000, 10000, 20000 (in rupiah)
});

export const insertMembershipPackageSchema = createInsertSchema(membershipPackages).omit({ id: true });
export type MembershipPackage = typeof membershipPackages.$inferSelect;

// User membership table
export const userMemberships = pgTable("user_memberships", {
  id: serial("id").primaryKey(),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull().unique(),
  packageId: integer("package_id").notNull(),
  status: text("status").notNull().default("pending"), // "pending", "active", "expired"
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserMembershipSchema = createInsertSchema(userMemberships).omit({ id: true, createdAt: true });
export type UserMembership = typeof userMemberships.$inferSelect;

// Payment records table
export const paymentRecords = pgTable("payment_records", {
  id: serial("id").primaryKey(),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  packageId: integer("package_id").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("pending"), // "pending", "verified", "rejected"
  proofUrl: text("proof_url"), // Link ke bukti transfer
  verifiedBy: bigint("verified_by", { mode: "number" }), // Admin user ID yang verify
  createdAt: timestamp("created_at").defaultNow(),
  verifiedAt: timestamp("verified_at"),
});

export const insertPaymentRecordSchema = createInsertSchema(paymentRecords).omit({ id: true, createdAt: true, verifiedAt: true });
export type PaymentRecord = typeof paymentRecords.$inferSelect;

// Conversion configuration types
export const conversionConfigSchema = z.object({
  contactName: z.string().min(1, "Contact name is required"),
  fileName: z.string().min(1, "File name is required"),
  splitLimit: z.coerce.number().min(1, "Limit must be at least 1").default(100),
});

export type ConversionConfig = z.infer<typeof conversionConfigSchema>;
