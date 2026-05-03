import {
  uuid,
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),

  firstName: varchar("first_name", { length: 25 }),
  lastName: varchar("last_name", { length: 25 }),

  profileImageURL: text("profile_image_url"),

  email: varchar("email", { length: 322 }).notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),

  password: varchar("password", { length: 66 }),
  salt: text("salt"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
});

export const applicationsTable = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),

  clientId: varchar("client_id", { length: 64 }).notNull().unique(),
  clientSecretHash: varchar("client_secret_hash", { length: 64 }).notNull(),

  displayName: varchar("display_name", { length: 100 }).notNull(),
  applicationUrl: text("application_url").notNull(),
  redirectUri: text("redirect_uri").notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const authorizationCodesTable = pgTable("authorization_codes", {
  id: uuid("id").primaryKey().defaultRandom(),

  code: varchar("code", { length: 64 }).notNull().unique(),
  clientId: varchar("client_id", { length: 64 }).notNull(),
  userId: uuid("user_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),

  used: boolean("used").default(false).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
