import type { Client, ModalInteraction } from "@buape/carbon"
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { readFileSync } from "node:fs"
import { formSettings } from "../forms.config.js"
import { createSession } from "../src/forms/auth.js"
import { formReviewModals } from "../src/forms/reviewButtons.js"
import { handleFormsRequest } from "../src/forms/server.js"
import { createFormSubmission, getFormSubmission } from "../src/forms/submissions.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const envKeys = ["FORMS_DEV", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"] as const
let savedEnv: Record<string, string | undefined>
let db: SqliteD1Database
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>
const client = {} as Client

beforeEach(() => {
	savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
	delete process.env.FORMS_DEV
	process.env.DISCORD_CLIENT_ID = "synthetic-client"
	process.env.DISCORD_CLIENT_SECRET = "synthetic-secret"
	process.env.GITHUB_OAUTH_CLIENT_ID = "synthetic-client"
	process.env.GITHUB_OAUTH_CLIENT_SECRET = "synthetic-secret"
	db = new SqliteD1Database()
	db.database.exec(readFileSync("drizzle/0002_mysterious_skaar.sql", "utf8"))
	setRuntimeEnv({ DB: db, DEPLOY_SECRET: "synthetic-session-secret" } as unknown as Env)
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
		throw new Error("Retired Reddit flows must not make network requests.")
	})
})

afterEach(() => {
	fetchSpy.mockRestore()
	for (const key of envKeys) {
		if (savedEnv[key] === undefined) delete process.env[key]
		else process.env[key] = savedEnv[key]
	}
	db.close()
})

describe("Reddit moderation retirement", () => {
	it("does not accept appeal intake, OAuth, or Devvit context requests", async () => {
		for (const path of ["/reddit", "/reddit/submit", "/api/devvit/reddit/context"]) {
			for (const hostname of ["appeals.openclaw.ai", "forms.openclaw.ai", "hermit-discord.openclaw.ai"]) {
				for (const method of ["GET", "POST"]) {
					const response = await handleFormsRequest(new Request(`https://${hostname}${path}`, { method }), client)
					expect(response).toBeNull()
				}
			}
		}
		for (const path of ["/oauth/reddit/start?form=report-mod", "/oauth/reddit/callback?code=old-code"]) {
			const response = await handleFormsRequest(new Request(`https://appeals.openclaw.ai${path}`), client)
			expect(response?.status).toBe(404)
		}
		expect(fetchSpy).not.toHaveBeenCalled()
		expect(db.database.query("SELECT count(*) AS count FROM form_submissions").get()).toEqual({ count: 0 })
		expect(db.database.query("SELECT count(*) AS count FROM reddit_moderation_contexts").get()).toEqual({ count: 0 })
	})

	it("rejects an existing Reddit session for moderator reports and retains other sign-in methods", async () => {
		const session = await createSession({ formId: "report-mod", provider: "reddit", id: "old-user", username: "u/applicant" })
		const body = new FormData()
		body.set("session", session)
		body.set("moderator", "Moderator")
		body.set("reason", "Report reason")
		const response = await handleFormsRequest(new Request("https://appeals.openclaw.ai/report-mod/submit", { method: "POST", body }), client)
		expect(response?.status).toBe(400)
		const html = await response!.text()
		expect(html).toContain("Sign in with Discord")
		expect(html).toContain("Sign in with GitHub")
		expect(html).not.toContain("Sign in with Reddit")
		expect(db.database.query("SELECT count(*) AS count FROM form_submissions").get()).toEqual({ count: 0 })
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it.each(["accepted", "denied"])("leaves historical Reddit appeals unchanged when an old review is %s", async (status) => {
		const submission = await createFormSubmission({
			formId: "reddit",
			authProvider: "reddit",
			applicantId: "old-user",
			applicantUsername: "u/applicant",
			payload: { action: "banned", appealReason: "Please review" },
			reviewChannelId: formSettings.reviewChannelId
		})
		const replies: unknown[] = []
		await formReviewModals[0].run({
			user: { id: "reviewer" },
			member: { roles: [{ id: formSettings.reviewRoleId }] },
			reply: async (payload: unknown) => { replies.push(payload) },
			update: async () => { throw new Error("Retired reviews must not update messages.") },
			client
		} as unknown as ModalInteraction, { id: submission.id, status })
		expect(replies).toHaveLength(1)
		expect(await getFormSubmission(submission.id)).toEqual(submission)
		expect(fetchSpy).not.toHaveBeenCalled()
	})
})
