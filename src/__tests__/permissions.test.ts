import { describe, it, expect, beforeEach } from "bun:test"
import { mock } from "bun:test"
import { createTestDb } from "./helpers/db.js"

const { db: testDb, resetDb } = createTestDb()

mock.module("../db.js", () => ({ db: testDb }))

const { setTeamConfig } = await import("../lib/configStore.js")
const { isTeamLead, isFullTeamMember, isTrialMember, getFullMemberTeams, getLeadTeams } =
  await import("../lib/permissions.js")

describe("permissions", () => {
  beforeEach(async () => {
    resetDb()
    // Seed a known team config for most tests
    await setTeamConfig("discord_mod", {
      leadUserId: "lead-001",
      fullRoleId: "role-full-mod",
      trialRoleId: "role-trial-mod",
    })
  })

  describe("isTeamLead", () => {
    it("returns true when userId matches leadUserId", async () => {
      expect(await isTeamLead("lead-001", "discord_mod")).toBe(true)
    })

    it("returns false for a non-lead user", async () => {
      expect(await isTeamLead("other-user", "discord_mod")).toBe(false)
    })

    it("returns false when no lead is configured", async () => {
      // helper team has no config seeded → leadUserId defaults to ""
      expect(await isTeamLead("lead-001", "helper")).toBe(false)
    })
  })

  describe("isFullTeamMember", () => {
    it("returns true when member has the full role", async () => {
      const roles = [{ id: "role-full-mod" }]
      expect(await isFullTeamMember(roles, "discord_mod")).toBe(true)
    })

    it("returns false when member does not have the full role", async () => {
      const roles = [{ id: "role-trial-mod" }, { id: "some-other-role" }]
      expect(await isFullTeamMember(roles, "discord_mod")).toBe(false)
    })

    it("returns false when member has no roles", async () => {
      expect(await isFullTeamMember([], "discord_mod")).toBe(false)
    })
  })

  describe("isTrialMember", () => {
    it("returns true when member has the trial role", async () => {
      const roles = [{ id: "role-trial-mod" }]
      expect(await isTrialMember(roles, "discord_mod")).toBe(true)
    })

    it("returns false when member does not have the trial role", async () => {
      const roles = [{ id: "role-full-mod" }]
      expect(await isTrialMember(roles, "discord_mod")).toBe(false)
    })
  })

  describe("getFullMemberTeams", () => {
    it("returns empty array when member has no full roles", async () => {
      expect(await getFullMemberTeams([])).toEqual([])
    })

    it("returns a single team when member has one full role", async () => {
      const roles = [{ id: "role-full-mod" }]
      expect(await getFullMemberTeams(roles)).toEqual(["discord_mod"])
    })

    it("returns multiple teams when member has multiple full roles", async () => {
      await setTeamConfig("helper", { fullRoleId: "role-full-helper" })
      const roles = [{ id: "role-full-mod" }, { id: "role-full-helper" }]
      const teams = await getFullMemberTeams(roles)
      expect(teams).toContain("discord_mod")
      expect(teams).toContain("helper")
    })
  })

  describe("getLeadTeams", () => {
    it("returns empty array for a non-lead user", async () => {
      expect(await getLeadTeams("other-user")).toEqual([])
    })

    it("returns the team the user leads", async () => {
      const teams = await getLeadTeams("lead-001")
      expect(teams).toContain("discord_mod")
      expect(teams).not.toContain("helper")
    })

    it("returns multiple teams if user leads more than one", async () => {
      await setTeamConfig("vc_mod", { leadUserId: "multi-lead" })
      await setTeamConfig("helper", { leadUserId: "multi-lead" })
      const teams = await getLeadTeams("multi-lead")
      expect(teams).toContain("vc_mod")
      expect(teams).toContain("helper")
      expect(teams).not.toContain("discord_mod")
    })
  })
})
