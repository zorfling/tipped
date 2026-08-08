import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const eventStatus = pgEnum("event_status", [
  "draft",
  "open",
  "tipped",
  "locked",
  "live",
  "matched",
  "fizzled",
  "cancelled",
]);

export const registrationState = pgEnum("registration_state", [
  "reserved",
  "waitlisted",
  "confirmed",
  "released",
  "refunded",
  "cancelled",
  "checked_in",
  "no_show",
]);

export const chargeStatus = pgEnum("charge_status", [
  "pending",
  "succeeded",
  "requires_action",
  "failed",
]);

export const pickChoice = pgEnum("pick_choice", ["yes", "no"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  photoUrl: text("photo_url"),
  stripeCustomerId: text("stripe_customer_id"),
  acceptedConductAt: timestamp("accepted_conduct_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  city: text("city").notNull(),
  venueName: text("venue_name").notNull(),
  venueAddress: text("venue_address").notNull(),
  venueNotes: text("venue_notes"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  tipDeadlineAt: timestamp("tip_deadline_at", { withTimezone: true }).notNull(),
  deadlineExtendedAt: timestamp("deadline_extended_at", { withTimezone: true }),
  maxImbalance: integer("max_imbalance").notNull().default(2),
  roundLengthSec: integer("round_length_sec").notNull().default(300),
  breakLengthSec: integer("break_length_sec").notNull().default(90),
  status: eventStatus("status").notNull().default("open"),
  format: text("format").notNull().default("speed_dating"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const buckets = pgTable("buckets", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  label: text("label").notNull(),
  minSize: integer("min_size").notNull().default(6),
  maxSize: integer("max_size").notNull().default(12),
  priceCents: integer("price_cents").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    bucketId: uuid("bucket_id")
      .notNull()
      .references(() => buckets.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    state: registrationState("state").notNull().default("reserved"),
    manageToken: text("manage_token").notNull().unique(),
    stripeSetupIntentId: text("stripe_setup_intent_id"),
    stripePaymentMethodId: text("stripe_payment_method_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    waitlistedAt: timestamp("waitlisted_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.eventId, t.userId)],
);

export const charges = pgTable("charges", {
  id: uuid("id").primaryKey().defaultRandom(),
  registrationId: uuid("registration_id")
    .notNull()
    .references(() => registrations.id),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  amountCents: integer("amount_cents").notNull(),
  status: chargeStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").references(() => events.id),
    registrationId: uuid("registration_id").references(() => registrations.id),
    type: text("type").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.eventId, t.registrationId, t.type)],
);

// --- v0.2 tables ---

export const rounds = pgTable("rounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  number: integer("number").notNull(),
  scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }).notNull(),
  scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }).notNull(),
});

export const assignments = pgTable("assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  roundId: uuid("round_id")
    .notNull()
    .references(() => rounds.id),
  registrationAId: uuid("registration_a_id")
    .notNull()
    .references(() => registrations.id),
  registrationBId: uuid("registration_b_id").references(() => registrations.id),
});

export const picks = pgTable(
  "picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    fromRegistrationId: uuid("from_registration_id")
      .notNull()
      .references(() => registrations.id),
    toRegistrationId: uuid("to_registration_id")
      .notNull()
      .references(() => registrations.id),
    choice: pickChoice("choice").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.fromRegistrationId, t.toRegistrationId)],
);

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  registrationAId: uuid("registration_a_id")
    .notNull()
    .references(() => registrations.id),
  registrationBId: uuid("registration_b_id")
    .notNull()
    .references(() => registrations.id),
  revealedAt: timestamp("revealed_at", { withTimezone: true }),
});

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerUserId: uuid("blocker_user_id")
      .notNull()
      .references(() => users.id),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.blockerUserId, t.blockedUserId)],
);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  reporterUserId: uuid("reporter_user_id")
    .notNull()
    .references(() => users.id),
  reportedUserId: uuid("reported_user_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Bucket = typeof buckets.$inferSelect;
export type Registration = typeof registrations.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Pick = typeof picks.$inferSelect;
export type Match = typeof matches.$inferSelect;
