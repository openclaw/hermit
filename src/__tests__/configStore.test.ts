import { describe, it, expect, beforeEach } from "bun:test"
import { mock } from "bun:test"
import { DEFAULT_GLOBAL_CONFIG, DEFAULT_TEAM_CONFIG } from "../config/onboarding-defaults.js"
import { createTestDb } from "./helpers/db.js"

const { db: testDb, resetDb } = createTestDb()

mock.module("../db.js", () => ({ db: testDb }))

const { getGlobalConfig, setGlobalConfig, getTeamConfig, setTeamConfig } =
  await import("../lib/configStore.js")

describe("configStore", () => {
  beforeEach(() => resetDb())

  describe("getGlobalConfig", () => {
    it("returns defaults when no DB row exists", async () => {
      const config = await getGlobalConfig()
      expect(config).toEqual(DEFAULT_GLOBAL_CONFIG)
    })

    it("merges DB values over defaults", async () => {
      await setGlobalConfig({ minServerTenureDays: 30 })
      const config = await getGlobalConfig()
      expect(config.minServerTenureDays).toBe(30)
      // other defaults remain unchanged
      expect(config.reapplyCooldownDays).toBe(DEFAULT_GLOBAL_CONFIG.reapplyCooldownDays)
    })

    it("a partial update does not erase unset fields", async () => {
      await setGlobalConfig({ reapplyCooldownDays: 14 })
      await setGlobalConfig({ minServerTenureDays: 21 })
      const config = await getGlobalConfig()
      expect(config.reapplyCooldownDays).toBe(14)
      expect(config.minServerTenureDays).toBe(21)
    })
  })

  describe("setGlobalConfig", () => {
    it("upserts without duplicating on repeated calls", async () => {
      await setGlobalConfig({ minServerTenureDays: 10 })
      await setGlobalConfig({ minServerTenureDays: 20 })
      const config = await getGlobalConfig()
      expect(config.minServerTenureDays).toBe(20)
    })
  })

  describe("getTeamConfig", () => {
    it("returns defaults when no row exists", async () => {
      const config = await getTeamConfig("discord_mod")
      expect(config.trialDurationDays).toBe(DEFAULT_TEAM_CONFIG.trialDurationDays)
      expect(config.voteWindowHours).toBe(DEFAULT_TEAM_CONFIG.voteWindowHours)
      expect(config.voteThreshold).toBe(DEFAULT_TEAM_CONFIG.voteThreshold)
      expect(config.leadApprovalTimeoutDays).toBe(DEFAULT_TEAM_CONFIG.leadApprovalTimeoutDays)
    })

    it("returns empty strings for required ID fields when no row exists", async () => {
      const config = await getTeamConfig("helper")
      expect(config.channelId).toBe("")
      expect(config.leadUserId).toBe("")
      expect(config.trialRoleId).toBe("")
      expect(config.fullRoleId).toBe("")
    })
  })

  describe("setTeamConfig", () => {
    it("persists team config values", async () => {
      await setTeamConfig("discord_mod", { leadUserId: "U123", trialDurationDays: 14 })
      const config = await getTeamConfig("discord_mod")
      expect(config.leadUserId).toBe("U123")
      expect(config.trialDurationDays).toBe(14)
    })

    it("does not cross-contaminate separate teams", async () => {
      await setTeamConfig("discord_mod", { leadUserId: "lead-mod" })
      const modConfig = await getTeamConfig("discord_mod")
      const helperConfig = await getTeamConfig("helper")
      expect(modConfig.leadUserId).toBe("lead-mod")
      expect(helperConfig.leadUserId).toBe("")
    })

    it("upserts without duplicating on repeated calls", async () => {
      await setTeamConfig("vc_mod", { trialDurationDays: 14 })
      await setTeamConfig("vc_mod", { trialDurationDays: 21 })
      const config = await getTeamConfig("vc_mod")
      expect(config.trialDurationDays).toBe(21)
    })

    it("a partial update does not erase other team fields", async () => {
      await setTeamConfig("configurator", { leadUserId: "U99", trialDurationDays: 10 })
      await setTeamConfig("configurator", { fullRoleId: "R88" })
      const config = await getTeamConfig("configurator")
      expect(config.leadUserId).toBe("U99")
      expect(config.trialDurationDays).toBe(10)
      expect(config.fullRoleId).toBe("R88")
    })
  })
})
