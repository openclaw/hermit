import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import * as schema from "../../db/schema.js"

// Full schema DDL — mirrors drizzle/0000_fixed_may_parker.sql
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS keyValue (
  key text PRIMARY KEY NOT NULL,
  value text NOT NULL,
  createdAt integer NOT NULL,
  updatedAt integer NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  guild_id text NOT NULL,
  team text NOT NULL,
  timezone text DEFAULT '' NOT NULL,
  availability text DEFAULT '' NOT NULL,
  motivation text DEFAULT '' NOT NULL,
  custom_fields text DEFAULT '{}',
  status text DEFAULT 'FORM_SENT' NOT NULL,
  initiated_by text NOT NULL,
  approved_by text DEFAULT '[]',
  denied_by text,
  reviewed_at integer,
  review_message_id text,
  vote_message_id text,
  lead_approval_deadline integer,
  lead_decision_by text,
  lead_decided_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY NOT NULL,
  application_id text,
  trial_id text,
  actor_id text NOT NULL,
  action text NOT NULL,
  details text DEFAULT '{}',
  created_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS promotion_votes (
  id text PRIMARY KEY NOT NULL,
  application_id text NOT NULL,
  voter_id text NOT NULL,
  vote text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_app_voter ON promotion_votes (application_id, voter_id);
CREATE TABLE IF NOT EXISTS trials (
  id text PRIMARY KEY NOT NULL,
  application_id text NOT NULL,
  user_id text NOT NULL,
  team text NOT NULL,
  start_time integer NOT NULL,
  end_time integer,
  status text DEFAULT 'ACTIVE' NOT NULL,
  metrics text DEFAULT '{}',
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON UPDATE no action ON DELETE no action
);
`

export function createTestDb() {
  const sqlite = new Database(":memory:")
  sqlite.exec(SCHEMA_SQL)
  const db = drizzle(sqlite, { schema })

  function resetDb() {
    sqlite.exec(`
      DELETE FROM promotion_votes;
      DELETE FROM trials;
      DELETE FROM audit_logs;
      DELETE FROM applications;
      DELETE FROM keyValue;
    `)
  }

  return { db, sqlite, resetDb }
}
