import { describe, it, expect, beforeEach } from "bun:test"
import { mock } from "bun:test"
import { createTestDb } from "./helpers/db.js"
import type { Client } from "@buape/carbon"

const { db: testDb, sqlite, resetDb } = createTestDb()

mock.module("../db.js", () => ({ db: testDb }))

const { runAutoChecks } = await import("../lib/autoChecks.js")
const { setGlobalConfig } = await import("../lib/configStore.js")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GUILD_ID = "guild-001"
const USER_ID = "user-001"

/** Build a minimal fake Client controlling tenure and ban status. */
function makeClient({
  tenureDays = 30,
  isBanned = false,
}: {
  tenureDays?: number
  isBanned?: boolean
} = {}) {
  return {
    rest: {
      get: async (path: string) => {
        if (path.includes("/bans/")) {
          if (isBanned) return {} // returning means banned
          throw Object.assign(new Error("Not Found"), { status: 404 })
        }
        if (path.includes("/members/")) {
          const joinedAt = new Date(Date.now() - tenureDays * 86400_000)
          return { joined_at: joinedAt.toISOString() }
        }
        throw new Error(`Unexpected REST path: ${path}`)
      },
    },
  } as unknown as Client
}

function insertApplication(
  status: string,
  updatedAtMs: number = Date.now(),
) {
  sqlite.run(
    `INSERT INTO applications
       (id, user_id, guild_id, team, status, initiated_by, created_at, updated_at)
     VALUES
       (lower(hex(randomblob(16))), ?, ?, 'discord_mod', ?, 'initiator', ?, ?)`,
    [USER_ID, GUILD_ID, status, Date.now(), updatedAtMs],
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("autoChecks — runAutoChecks", () => {
  beforeEach(async () => {
    resetDb()
    // Restore defaults before each test
    await setGlobalConfig({ minServerTenureDays: 14, reapplyCooldownDays: 7 })
  })

  it("passes when all checks are satisfied", async () => {
    const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient())
    expect(result.passed).toBe(true)
  })

  describe("SERVER_TENURE check", () => {
    it("fails when member joined less than minServerTenureDays ago", async () => {
      const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient({ tenureDays: 5 }))
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason.type).toBe("SERVER_TENURE")
      }
    })

    it("passes when member joined exactly at the threshold", async () => {
      await setGlobalConfig({ minServerTenureDays: 5 })
      const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient({ tenureDays: 5 }))
      expect(result.passed).toBe(true)
    })

    it("respects minServerTenureDays from config (not a hardcoded value)", async () => {
      await setGlobalConfig({ minServerTenureDays: 30 })
      // 20 days is enough for default-14 but not for 30
      const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient({ tenureDays: 20 }))
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason.type).toBe("SERVER_TENURE")
      }
    })
  })

  describe("HAS_BAN check", () => {
    it("fails when the user is banned", async () => {
      const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient({ isBanned: true }))
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason.type).toBe("HAS_BAN")
      }
    })
  })

  describe("PENDING_APPLICATION check", () => {
    it("fails when user has an active non-terminal application", async () => {
      insertApplication("TRIAL_ACTIVE")
      const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient())
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason.type).toBe("PENDING_APPLICATION")
      }
    })

    it("passes when the only application is in a terminal status", async () => {
      insertApplication("PROMOTED_BY_LEAD")
      const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient())
      expect(result.passed).toBe(true)
    })
  })

  describe("IN_COOLDOWN check", () => {
    it("fails when user was declined within the cooldown window", async () => {
      // Declined 2 days ago, cooldown is 7 days → still in cooldown
      const twoDaysAgo = Date.now() - 2 * 86400_000
      insertApplication("APPLICATION_DENIED", twoDaysAgo)
      const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient())
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason.type).toBe("IN_COOLDOWN")
      }
    })

    it("passes when the cooldown window has elapsed", async () => {
      // Declined 10 days ago, cooldown is 7 days → window has passed
      const tenDaysAgo = Date.now() - 10 * 86400_000
      insertApplication("APPLICATION_DENIED", tenDaysAgo)
      const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient())
      expect(result.passed).toBe(true)
    })

    it("respects reapplyCooldownDays from config", async () => {
      await setGlobalConfig({ reapplyCooldownDays: 14 })
      // Declined 10 days ago — inside the extended cooldown
      const tenDaysAgo = Date.now() - 10 * 86400_000
      insertApplication("APPLICATION_DENIED", tenDaysAgo)
      const result = await runAutoChecks(USER_ID, GUILD_ID, makeClient())
      expect(result.passed).toBe(false)
      if (!result.passed) {
        expect(result.reason.type).toBe("IN_COOLDOWN")
      }
    })
  })
})
