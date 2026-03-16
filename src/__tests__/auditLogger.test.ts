import { describe, it, expect, beforeEach, spyOn } from "bun:test"
import { mock } from "bun:test"
import { createTestDb } from "./helpers/db.js"

const { db: testDb, sqlite, resetDb } = createTestDb()

mock.module("../db.js", () => ({ db: testDb }))

const { writeAuditLog } = await import("../lib/auditLogger.js")

describe("auditLogger — writeAuditLog", () => {
  beforeEach(() => resetDb())

  it("writes a row with the correct actorId and action", async () => {
    await writeAuditLog({ actorId: "U1", action: "TRIAL_STARTED" })
    const row = sqlite.query("SELECT * FROM audit_logs").get() as Record<string, unknown> | undefined
    expect(row).toBeDefined()
    expect(row!.actor_id).toBe("U1")
    expect(row!.action).toBe("TRIAL_STARTED")
  })

  it("writes optional applicationId and trialId when provided", async () => {
    await writeAuditLog({
      actorId: "U2",
      action: "VOTE_PASSED",
      applicationId: "app-abc",
      trialId: "trial-xyz",
    })
    const row = sqlite.query("SELECT * FROM audit_logs").get() as Record<string, unknown> | undefined
    expect(row!.application_id).toBe("app-abc")
    expect(row!.trial_id).toBe("trial-xyz")
  })

  it("writes details JSON when provided", async () => {
    await writeAuditLog({
      actorId: "system",
      action: "AUTO_PROMOTED",
      details: { team: "discord_mod", approveCount: 3 },
    })
    const row = sqlite.query("SELECT * FROM audit_logs").get() as Record<string, unknown> | undefined
    const details = JSON.parse(row!.details as string) as Record<string, unknown>
    expect(details.team).toBe("discord_mod")
    expect(details.approveCount).toBe(3)
  })

  it("defaults details to an empty object when not provided", async () => {
    await writeAuditLog({ actorId: "U3", action: "APP_DENIED" })
    const row = sqlite.query("SELECT * FROM audit_logs").get() as Record<string, unknown> | undefined
    const details = JSON.parse(row!.details as string) as Record<string, unknown>
    expect(details).toEqual({})
  })

  it("does not throw when the DB write fails, and logs to console.error", async () => {
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {})
    sqlite.exec("DROP TABLE audit_logs")
    try {
      await expect(writeAuditLog({ actorId: "U4", action: "TEST" })).resolves.toBeUndefined()
      expect(consoleSpy).toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
      // Restore table so afterEach reset doesn't fail
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id text PRIMARY KEY NOT NULL,
          application_id text,
          trial_id text,
          actor_id text NOT NULL,
          action text NOT NULL,
          details text DEFAULT '{}',
          created_at integer NOT NULL
        )
      `)
    }
  })
})
