// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { mysqlEnum, mysqlTable, text, timestamp, varchar, int, decimal, boolean } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "owner", "tenant"]).default("user").notNull(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow()
});
var properties = mysqlTable("properties", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address").notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  zipCode: varchar("zipCode", { length: 10 }).notNull(),
  price: decimal("price", { precision: 12, scale: 2 }).notNull(),
  type: mysqlEnum("type", ["Rent", "Sale"]).notNull(),
  beds: int("beds").notNull(),
  baths: decimal("baths", { precision: 3, scale: 1 }).notNull(),
  sqft: int("sqft").notNull(),
  description: text("description"),
  amenities: text("amenities"),
  // JSON array stored as text
  images: text("images"),
  // JSON array of image URLs
  featured: boolean("featured").default(false),
  active: boolean("active").default(true),
  ownerId: varchar("ownerId", { length: 64 }).references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
  createdBy: varchar("createdBy", { length: 64 }).references(() => users.id)
});
var units = mysqlTable("units", {
  id: varchar("id", { length: 64 }).primaryKey(),
  propertyId: varchar("propertyId", { length: 64 }).notNull().references(() => properties.id),
  unitNumber: varchar("unitNumber", { length: 50 }).notNull(),
  rentAmount: decimal("rentAmount", { precision: 10, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["vacant", "occupied", "maintenance"]).default("vacant"),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow()
});
var tenants = mysqlTable("tenants", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("userId", { length: 64 }).references(() => users.id),
  unitId: varchar("unitId", { length: 64 }).references(() => units.id),
  leaseStartDate: timestamp("leaseStartDate"),
  leaseEndDate: timestamp("leaseEndDate"),
  status: mysqlEnum("status", ["active", "inactive", "evicted"]).default("active"),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow()
});
var inquiries = mysqlTable("inquiries", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  propertyType: varchar("propertyType", { length: 50 }),
  message: text("message"),
  propertyId: varchar("propertyId", { length: 64 }).references(() => properties.id),
  status: mysqlEnum("status", ["new", "contacted", "qualified", "closed"]).default("new"),
  notes: text("notes"),
  assignedTo: varchar("assignedTo", { length: 64 }).references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow()
});
var maintenanceRequests = mysqlTable("maintenanceRequests", {
  id: varchar("id", { length: 64 }).primaryKey(),
  propertyId: varchar("propertyId", { length: 64 }).notNull().references(() => properties.id),
  unitId: varchar("unitId", { length: 64 }).references(() => units.id),
  tenantId: varchar("tenantId", { length: 64 }).references(() => tenants.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"]).default("medium"),
  status: mysqlEnum("status", ["open", "in_progress", "completed", "closed"]).default("open"),
  assignedTo: varchar("assignedTo", { length: 64 }).references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow()
});
var payments = mysqlTable("payments", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("userId", { length: 64 }).notNull().references(() => users.id),
  tenantId: varchar("tenantId", { length: 64 }).references(() => tenants.id),
  unitId: varchar("unitId", { length: 64 }).references(() => units.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD"),
  status: mysqlEnum("status", ["pending", "completed", "failed", "refunded"]).default("pending"),
  paymentMethod: mysqlEnum("paymentMethod", ["stripe", "bank_transfer", "check", "cash"]).default("stripe"),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  stripeInvoiceId: varchar("stripeInvoiceId", { length: 255 }),
  description: text("description"),
  dueDate: timestamp("dueDate"),
  paidDate: timestamp("paidDate"),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow()
});
var invoices = mysqlTable("invoices", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().references(() => tenants.id),
  unitId: varchar("unitId", { length: 64 }).notNull().references(() => units.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  dueDate: timestamp("dueDate").notNull(),
  paidDate: timestamp("paidDate"),
  status: mysqlEnum("status", ["draft", "sent", "paid", "overdue", "cancelled"]).default("draft"),
  stripeInvoiceId: varchar("stripeInvoiceId", { length: 255 }),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow()
});
var subscriptions = mysqlTable("subscriptions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull().references(() => tenants.id),
  unitId: varchar("unitId", { length: 64 }).notNull().references(() => units.id),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  frequency: mysqlEnum("frequency", ["monthly", "quarterly", "yearly"]).default("monthly"),
  status: mysqlEnum("status", ["active", "paused", "cancelled"]).default("active"),
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate"),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow()
});
var documents = mysqlTable("documents", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["lease", "inspection", "maintenance", "invoice", "other"]).notNull(),
  url: text("url").notNull(),
  propertyId: varchar("propertyId", { length: 64 }).references(() => properties.id),
  unitId: varchar("unitId", { length: 64 }).references(() => units.id),
  tenantId: varchar("tenantId", { length: 64 }).references(() => tenants.id),
  uploadedBy: varchar("uploadedBy", { length: 64 }).references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow()
});
var notifications = mysqlTable("notifications", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("userId", { length: 64 }).notNull().references(() => users.id),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  read: boolean("read").default(false),
  createdAt: timestamp("createdAt").defaultNow()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
import { count, sum } from "drizzle-orm";
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.id) {
    throw new Error("User ID is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      id: user.id
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role === void 0) {
      if (user.id === ENV.ownerId) {
        user.role = "admin";
        values.role = "admin";
        updateSet.role = "admin";
      }
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUser(id) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;
  try {
    const [totalPropertiesResult, totalTenantsResult, totalMaintenanceResult, totalPaymentsResult] = await Promise.all([
      db.select({ count: count() }).from(properties),
      db.select({ count: count() }).from(tenants),
      db.select({ count: count() }).from(maintenanceRequests).where(eq(maintenanceRequests.status, "open")),
      db.select({ total: sum(payments.amount) }).from(payments).where(eq(payments.status, "completed"))
    ]);
    return {
      totalProperties: totalPropertiesResult[0]?.count || 0,
      totalTenants: totalTenantsResult[0]?.count || 0,
      openMaintenanceRequests: totalMaintenanceResult[0]?.count || 0,
      totalRevenue: totalPaymentsResult[0]?.total || 0
    };
  } catch (error) {
    console.error("[Database] Failed to get dashboard stats:", error);
    throw error;
  }
}
async function getAllProperties() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(properties);
  } catch (error) {
    console.error("[Database] Failed to get properties:", error);
    throw error;
  }
}
async function getPropertyById(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Failed to get property:", error);
    throw error;
  }
}
async function createProperty(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const id = `prop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.insert(properties).values({
      id,
      ...data,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    });
    return id;
  } catch (error) {
    console.error("[Database] Failed to create property:", error);
    throw error;
  }
}
async function updateProperty(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.update(properties).set({
      ...data,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(properties.id, id));
  } catch (error) {
    console.error("[Database] Failed to update property:", error);
    throw error;
  }
}
async function deleteProperty(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.delete(properties).where(eq(properties.id, id));
  } catch (error) {
    console.error("[Database] Failed to delete property:", error);
    throw error;
  }
}
async function getAllInquiries() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(inquiries);
  } catch (error) {
    console.error("[Database] Failed to get inquiries:", error);
    throw error;
  }
}
async function getInquiryById(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.select().from(inquiries).where(eq(inquiries.id, id)).limit(1);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Failed to get inquiry:", error);
    throw error;
  }
}
async function updateInquiry(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.update(inquiries).set({
      ...data,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(inquiries.id, id));
  } catch (error) {
    console.error("[Database] Failed to update inquiry:", error);
    throw error;
  }
}
async function getAllMaintenanceRequests() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(maintenanceRequests);
  } catch (error) {
    console.error("[Database] Failed to get maintenance requests:", error);
    throw error;
  }
}
async function getMaintenanceRequestById(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id)).limit(1);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Failed to get maintenance request:", error);
    throw error;
  }
}
async function updateMaintenanceRequest(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.update(maintenanceRequests).set({
      ...data,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(maintenanceRequests.id, id));
  } catch (error) {
    console.error("[Database] Failed to update maintenance request:", error);
    throw error;
  }
}
async function getAllPayments() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(payments);
  } catch (error) {
    console.error("[Database] Failed to get payments:", error);
    throw error;
  }
}
async function getPaymentById(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Failed to get payment:", error);
    throw error;
  }
}
async function getAllTenants() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(tenants);
  } catch (error) {
    console.error("[Database] Failed to get tenants:", error);
    throw error;
  }
}
async function getTenantById(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Failed to get tenant:", error);
    throw error;
  }
}
async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(users);
  } catch (error) {
    console.error("[Database] Failed to get users:", error);
    throw error;
  }
}
async function getUsersByRole(role) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(users).where(eq(users.role, role));
  } catch (error) {
    console.error("[Database] Failed to get users by role:", error);
    throw error;
  }
}
async function getOwnerProperties(ownerId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(properties).where(eq(properties.ownerId, ownerId));
  } catch (error) {
    console.error("[Database] Failed to get owner properties:", error);
    throw error;
  }
}
async function getOwnerTenants(ownerId) {
  const db = await getDb();
  if (!db) return [];
  try {
    const ownerProps = await db.select({ id: properties.id }).from(properties).where(eq(properties.ownerId, ownerId));
    const propIds = ownerProps.map((p) => p.id);
    if (propIds.length === 0) return [];
    return await db.select().from(tenants);
  } catch (error) {
    console.error("[Database] Failed to get owner tenants:", error);
    throw error;
  }
}
async function getOwnerPayments(ownerId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(payments);
  } catch (error) {
    console.error("[Database] Failed to get owner payments:", error);
    throw error;
  }
}
async function getOwnerInvoices(ownerId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(invoices);
  } catch (error) {
    console.error("[Database] Failed to get owner invoices:", error);
    throw error;
  }
}
async function getOwnerMaintenanceRequests(ownerId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(maintenanceRequests);
  } catch (error) {
    console.error("[Database] Failed to get owner maintenance requests:", error);
    throw error;
  }
}
async function getOwnerDocuments(ownerId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(documents);
  } catch (error) {
    console.error("[Database] Failed to get owner documents:", error);
    throw error;
  }
}
async function getOwnerStats(ownerId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [propsCount, tenantsCount, maintenanceCount, revenueResult] = await Promise.all([
      db.select({ count: count() }).from(properties).where(eq(properties.ownerId, ownerId)),
      db.select({ count: count() }).from(tenants),
      db.select({ count: count() }).from(maintenanceRequests),
      db.select({ total: sum(payments.amount) }).from(payments)
    ]);
    return {
      totalProperties: propsCount[0]?.count || 0,
      totalTenants: tenantsCount[0]?.count || 0,
      totalRevenue: revenueResult[0]?.total || 0,
      pendingMaintenance: maintenanceCount[0]?.count || 0
    };
  } catch (error) {
    console.error("[Database] Failed to get owner stats:", error);
    throw error;
  }
}
async function getTenantByUserId(userId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.select().from(tenants).where(eq(tenants.userId, userId)).limit(1);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Failed to get tenant by user ID:", error);
    throw error;
  }
}
async function getTenantPayments(tenantId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(payments).where(eq(payments.tenantId, tenantId));
  } catch (error) {
    console.error("[Database] Failed to get tenant payments:", error);
    throw error;
  }
}
async function getTenantInvoices(tenantId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(invoices).where(eq(invoices.tenantId, tenantId));
  } catch (error) {
    console.error("[Database] Failed to get tenant invoices:", error);
    throw error;
  }
}
async function getTenantMaintenanceRequests(tenantId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.tenantId, tenantId));
  } catch (error) {
    console.error("[Database] Failed to get tenant maintenance requests:", error);
    throw error;
  }
}
async function createMaintenanceRequest(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const id = `maint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.insert(maintenanceRequests).values({
      id,
      ...data,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    });
    return id;
  } catch (error) {
    console.error("[Database] Failed to create maintenance request:", error);
    throw error;
  }
}
async function getTenantDocuments(tenantId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(documents).where(eq(documents.tenantId, tenantId));
  } catch (error) {
    console.error("[Database] Failed to get tenant documents:", error);
    throw error;
  }
}
async function getTenantStats(tenantId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [paymentsCount, invoicesCount, maintenanceCount] = await Promise.all([
      db.select({ count: count() }).from(payments).where(eq(payments.tenantId, tenantId)),
      db.select({ count: count() }).from(invoices).where(eq(invoices.tenantId, tenantId)),
      db.select({ count: count() }).from(maintenanceRequests).where(eq(maintenanceRequests.tenantId, tenantId))
    ]);
    return {
      totalPayments: paymentsCount[0]?.count || 0,
      totalInvoices: invoicesCount[0]?.count || 0,
      totalMaintenanceRequests: maintenanceCount[0]?.count || 0
    };
  } catch (error) {
    console.error("[Database] Failed to get tenant stats:", error);
    throw error;
  }
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a user ID
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.id);
   */
  async createSessionToken(userId, options = {}) {
    return this.signSession(
      {
        openId: userId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUser(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          id: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUser(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      id: user.id,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        id: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/adminRouter.ts
import { z as z2 } from "zod";
var adminProcedure2 = protectedProcedure.use(async (opts) => {
  if (opts.ctx.user?.role !== "admin") {
    throw new Error("Unauthorized: Admin access required");
  }
  return opts.next();
});
var adminRouter = router({
  // Dashboard
  getDashboardStats: adminProcedure2.query(async () => {
    return await getDashboardStats();
  }),
  // Properties
  getAllProperties: adminProcedure2.query(async () => {
    return await getAllProperties();
  }),
  getPropertyById: adminProcedure2.input(z2.string()).query(async ({ input }) => {
    return await getPropertyById(input);
  }),
  createProperty: adminProcedure2.input(
    z2.object({
      name: z2.string(),
      address: z2.string(),
      city: z2.string(),
      state: z2.string(),
      zipCode: z2.string(),
      price: z2.string(),
      type: z2.enum(["Rent", "Sale"]),
      beds: z2.number(),
      baths: z2.number(),
      sqft: z2.number(),
      description: z2.string().optional(),
      amenities: z2.string().optional(),
      images: z2.string().optional(),
      featured: z2.boolean().optional(),
      ownerId: z2.string().optional()
    })
  ).mutation(async ({ input, ctx }) => {
    const id = await createProperty({
      ...input,
      createdBy: ctx.user.id
    });
    return { id };
  }),
  updateProperty: adminProcedure2.input(
    z2.object({
      id: z2.string(),
      name: z2.string().optional(),
      address: z2.string().optional(),
      city: z2.string().optional(),
      state: z2.string().optional(),
      zipCode: z2.string().optional(),
      price: z2.string().optional(),
      type: z2.enum(["Rent", "Sale"]).optional(),
      beds: z2.number().optional(),
      baths: z2.number().optional(),
      sqft: z2.number().optional(),
      description: z2.string().optional(),
      amenities: z2.string().optional(),
      images: z2.string().optional(),
      featured: z2.boolean().optional(),
      active: z2.boolean().optional()
    })
  ).mutation(async ({ input }) => {
    const { id, ...data } = input;
    await updateProperty(id, data);
    return { success: true };
  }),
  deleteProperty: adminProcedure2.input(z2.string()).mutation(async ({ input }) => {
    await deleteProperty(input);
    return { success: true };
  }),
  // Inquiries
  getAllInquiries: adminProcedure2.query(async () => {
    return await getAllInquiries();
  }),
  getInquiryById: adminProcedure2.input(z2.string()).query(async ({ input }) => {
    return await getInquiryById(input);
  }),
  updateInquiry: adminProcedure2.input(
    z2.object({
      id: z2.string(),
      status: z2.enum(["new", "contacted", "qualified", "closed"]).optional(),
      notes: z2.string().optional(),
      assignedTo: z2.string().optional()
    })
  ).mutation(async ({ input }) => {
    const { id, ...data } = input;
    await updateInquiry(id, data);
    return { success: true };
  }),
  // Maintenance Requests
  getAllMaintenanceRequests: adminProcedure2.query(async () => {
    return await getAllMaintenanceRequests();
  }),
  getMaintenanceRequestById: adminProcedure2.input(z2.string()).query(async ({ input }) => {
    return await getMaintenanceRequestById(input);
  }),
  updateMaintenanceRequest: adminProcedure2.input(
    z2.object({
      id: z2.string(),
      status: z2.enum(["open", "in_progress", "completed", "closed"]).optional(),
      priority: z2.enum(["low", "medium", "high", "urgent"]).optional(),
      assignedTo: z2.string().optional()
    })
  ).mutation(async ({ input }) => {
    const { id, ...data } = input;
    await updateMaintenanceRequest(id, data);
    return { success: true };
  }),
  // Payments
  getAllPayments: adminProcedure2.query(async () => {
    return await getAllPayments();
  }),
  getPaymentById: adminProcedure2.input(z2.string()).query(async ({ input }) => {
    return await getPaymentById(input);
  }),
  // Tenants
  getAllTenants: adminProcedure2.query(async () => {
    return await getAllTenants();
  }),
  getTenantById: adminProcedure2.input(z2.string()).query(async ({ input }) => {
    return await getTenantById(input);
  }),
  // Users
  getAllUsers: adminProcedure2.query(async () => {
    return await getAllUsers();
  }),
  getUsersByRole: adminProcedure2.input(z2.enum(["admin", "owner", "tenant", "user"])).query(async ({ input }) => {
    return await getUsersByRole(input);
  })
});

// server/ownerRouter.ts
import { z as z3 } from "zod";
var ownerProcedure = protectedProcedure.use(async (opts) => {
  if (opts.ctx.user?.role !== "owner" && opts.ctx.user?.role !== "admin") {
    throw new Error("Unauthorized: Owner access required");
  }
  return opts.next();
});
var ownerRouter = router({
  // Dashboard
  getStats: ownerProcedure.query(async ({ ctx }) => {
    return await getOwnerStats(ctx.user.id);
  }),
  // Properties
  getProperties: ownerProcedure.query(async ({ ctx }) => {
    return await getOwnerProperties(ctx.user.id);
  }),
  getPropertyById: ownerProcedure.input(z3.string()).query(async ({ input }) => {
    return await getOwnerProperties(input);
  }),
  updateProperty: ownerProcedure.input(
    z3.object({
      id: z3.string(),
      name: z3.string().optional(),
      address: z3.string().optional(),
      city: z3.string().optional(),
      state: z3.string().optional(),
      zipCode: z3.string().optional(),
      price: z3.string().optional(),
      type: z3.enum(["Rent", "Sale"]).optional(),
      beds: z3.number().optional(),
      baths: z3.number().optional(),
      sqft: z3.number().optional(),
      description: z3.string().optional(),
      amenities: z3.string().optional(),
      images: z3.string().optional(),
      featured: z3.boolean().optional(),
      active: z3.boolean().optional()
    })
  ).mutation(async ({ input }) => {
    const { id, ...data } = input;
    await updateProperty(id, data);
    return { success: true };
  }),
  // Tenants
  getTenants: ownerProcedure.query(async ({ ctx }) => {
    return await getOwnerTenants(ctx.user.id);
  }),
  // Payments
  getPayments: ownerProcedure.query(async ({ ctx }) => {
    return await getOwnerPayments(ctx.user.id);
  }),
  // Invoices
  getInvoices: ownerProcedure.query(async ({ ctx }) => {
    return await getOwnerInvoices(ctx.user.id);
  }),
  // Maintenance Requests
  getMaintenanceRequests: ownerProcedure.query(async ({ ctx }) => {
    return await getOwnerMaintenanceRequests(ctx.user.id);
  }),
  // Documents
  getDocuments: ownerProcedure.query(async ({ ctx }) => {
    return await getOwnerDocuments(ctx.user.id);
  })
});

// server/tenantRouter.ts
import { z as z4 } from "zod";
var tenantProcedure = protectedProcedure.use(async (opts) => {
  if (opts.ctx.user?.role !== "tenant" && opts.ctx.user?.role !== "admin") {
    throw new Error("Unauthorized: Tenant access required");
  }
  return opts.next();
});
var tenantRouter = router({
  // Dashboard
  getStats: tenantProcedure.query(async ({ ctx }) => {
    const tenant = await getTenantByUserId(ctx.user.id);
    if (!tenant) {
      return {
        totalPayments: 0,
        totalInvoices: 0,
        totalMaintenanceRequests: 0
      };
    }
    return await getTenantStats(tenant.id);
  }),
  // Tenant Info
  getTenantInfo: tenantProcedure.query(async ({ ctx }) => {
    return await getTenantByUserId(ctx.user.id);
  }),
  // Payments
  getPayments: tenantProcedure.query(async ({ ctx }) => {
    const tenant = await getTenantByUserId(ctx.user.id);
    if (!tenant) return [];
    return await getTenantPayments(tenant.id);
  }),
  // Invoices
  getInvoices: tenantProcedure.query(async ({ ctx }) => {
    const tenant = await getTenantByUserId(ctx.user.id);
    if (!tenant) return [];
    return await getTenantInvoices(tenant.id);
  }),
  // Maintenance Requests
  getMaintenanceRequests: tenantProcedure.query(async ({ ctx }) => {
    const tenant = await getTenantByUserId(ctx.user.id);
    if (!tenant) return [];
    return await getTenantMaintenanceRequests(tenant.id);
  }),
  createMaintenanceRequest: tenantProcedure.input(
    z4.object({
      title: z4.string(),
      description: z4.string(),
      priority: z4.enum(["low", "medium", "high", "urgent"]).default("medium")
    })
  ).mutation(async ({ input, ctx }) => {
    const tenant = await getTenantByUserId(ctx.user.id);
    if (!tenant) {
      throw new Error("Tenant profile not found");
    }
    const id = await createMaintenanceRequest({
      propertyId: tenant.unitId,
      // Using unitId as propertyId for now
      tenantId: tenant.id,
      unitId: tenant.unitId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: "open"
    });
    return { id };
  }),
  // Documents
  getDocuments: tenantProcedure.query(async ({ ctx }) => {
    const tenant = await getTenantByUserId(ctx.user.id);
    if (!tenant) return [];
    return await getTenantDocuments(tenant.id);
  })
});

// server/routers.ts
var appRouter = router({
  system: systemRouter,
  admin: adminRouter,
  owner: ownerRouter,
  tenant: tenantRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var plugins = [
  vitePluginManusRuntime(),
  tailwindcss(),
  jsxLocPlugin(),
  react({
    jsxRuntime: "automatic"
  })
];
var vite_config_default = defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development")
  },
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    },
    middlewareMode: false
  },
  optimizeDeps: {
    include: ["react", "react-dom"]
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
