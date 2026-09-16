import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { Client, ModalInteraction } from "@buape/carbon"
import { readFileSync } from "node:fs"
import { formConfigs } from "../forms.config.js"
import { createSession } from "../src/forms/auth.js"
import { handleFormsRequest } from "../src/forms/server.js"
import { formReviewModals } from "../src/forms/reviewButtons.js"
import { createFormSubmission, getFormSubmission, parseSubmissionPayload } from "../src/forms/submissions.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const form = formConfigs.find((item) => item.id === "clawhub")!
const originalFetch = globalThis.fetch
const envKeys = ["FORMS_DEV", "CLAWHUB_API_BASE", "CLAWHUB_BAN_APPEALS_TOKEN", "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"] as const
let savedEnv: Record<string, string | undefined>
let db: SqliteD1Database
let context: Record<string, unknown>
let contextStatus: number
let lookups: string[]
let unbans: Record<string, unknown>[]
let reviewMessages: unknown[]
const client = {
	fetchChannel: async () => ({
		send: async (payload: unknown) => {
			reviewMessages.push(payload)
			return { id: "review-message" }
		}
	})
} as unknown as Client

beforeEach(() => {
	savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
	process.env.GITHUB_OAUTH_CLIENT_ID = "synthetic-client"
	process.env.GITHUB_OAUTH_CLIENT_SECRET = "synthetic-client-secret"
	delete process.env.FORMS_DEV
	process.env.CLAWHUB_API_BASE = "https://clawhub.test"
	process.env.CLAWHUB_BAN_APPEALS_TOKEN = "synthetic-test-token"
	db = new SqliteD1Database()
	db.database.exec(readFileSync("drizzle/0002_mysterious_skaar.sql", "utf8"))
	setRuntimeEnv({ DB: db, DEPLOY_SECRET: "synthetic-session-secret", DISCORD_BOT_TOKEN: "synthetic-bot-token" } as unknown as Env)
	context = { action: "banned", userId: "bound-account", handle: "applicant" }
	contextStatus = 200
	lookups = []
	unbans = []
	reviewMessages = []
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input))
		if (url.origin === "https://clawhub.test" && url.pathname === "/api/v1/users/ban-appeal-context") {
			lookups.push(url.searchParams.get("githubProviderAccountId") ?? "")
			return Response.json(context, { status: contextStatus })
		}
		if (url.origin === "https://clawhub.test" && url.pathname === "/api/v1/users/ban-appeal-unban") {
			unbans.push(JSON.parse(String(init?.body)))
			return Response.json({ ok: true })
		}
		if (url.origin === "https://discord.com" && url.pathname.endsWith("/threads")) {
			return Response.json({ id: "review-thread" })
		}
		throw new Error(`Unexpected test request: ${url}`)
	}) as typeof fetch
})

afterEach(() => {
	globalThis.fetch = originalFetch
	for (const key of envKeys) {
		if (savedEnv[key] === undefined) delete process.env[key]
		else process.env[key] = savedEnv[key]
	}
	db.close()
})

const submit = async (overrides: Record<string, string> = {}) => {
	const session = await createSession({ formId: form.id, provider: "github", id: "12345", username: "applicant" })
	const body = new FormData()
	body.set("session", session)
	for (const field of form.fields) {
		if (field.type !== "autofill") body.set(field.id, "Please review my appeal.")
	}
	for (const [key, value] of Object.entries(overrides)) body.set(key, value)
	return handleFormsRequest(new Request("https://appeals.openclaw.ai/clawhub/submit", { method: "POST", body }), client)
}

const pending = (target: string, authProvider: string | null = "github", applicantId: string | null = "12345") =>
	createFormSubmission({
		formId: form.id, authProvider, applicantId, applicantUsername: "applicant",
		payload: { clawhubUserId: target, action: "banned" }, reviewChannelId: form.reviewChannelId
	})

const accept = async (id: number, authorized = true) => {
	const replies: unknown[] = []
	const updates: unknown[] = []
	await formReviewModals[0].run({
		user: { id: "reviewer" },
		member: { roles: authorized ? [{ id: form.reviewRoleId }] : [] },
		fields: { getText: () => undefined },
		reply: async (payload: unknown) => { replies.push(payload) },
		update: async (payload: unknown) => { updates.push(payload) },
		client
	} as unknown as ModalInteraction, { id, status: "accepted" })
	return { replies, updates }
}

describe("ClawHub appeal identity through submission and review", () => {
	it("ignores forged context, persists the authenticated account, and accepts it", async () => {
		const response = await submit({ clawhubUserId: "other-account", action: "moderated", injected: "unexpected" })
		expect(response?.status).toBe(200)
		const submission = (await getFormSubmission(1))!
		expect(submission.applicantId).toBe("12345")
		expect(parseSubmissionPayload(submission)).toMatchObject({ clawhubUserId: "bound-account", action: "banned" })
		expect(parseSubmissionPayload(submission).injected).toBeUndefined()
		expect(reviewMessages).toHaveLength(1)
		const result = await accept(submission.id)
		expect(result.updates).toHaveLength(1)
		expect((await getFormSubmission(submission.id))?.status).toBe("accepted")
		expect(lookups).toEqual(["12345", "12345"])
		expect(unbans).toEqual([{ userId: "bound-account", reason: "Appeal accepted.", reviewerDiscordId: "reviewer" }])
	})

	it("rejects a forged account stored in a pre-fix pending appeal", async () => {
		const submission = await pending("other-account")
		const result = await accept(submission.id)
		expect(unbans).toEqual([])
		expect(result.updates).toEqual([])
		expect(result.replies).toHaveLength(1)
		expect((await getFormSubmission(submission.id))?.status).toBe("submitted")
	})

	it("continues to accept a legitimate pre-fix pending appeal", async () => {
		const submission = await pending("bound-account")
		await accept(submission.id)
		expect(lookups).toEqual(["12345"])
		expect(unbans[0]?.userId).toBe("bound-account")
		expect((await getFormSubmission(submission.id))?.status).toBe("accepted")
	})

	for (const [label, value] of [["removed", null], ["reassigned", "new-account"], ["malformed", 123]] as const) {
		it(`refuses unban after the account binding is ${label}`, async () => {
			const submission = await pending("bound-account")
			context.userId = value
			await accept(submission.id)
			expect(unbans).toEqual([])
			expect((await getFormSubmission(submission.id))?.status).toBe("submitted")
		})
	}

	for (const [provider, id] of [["discord", "12345"], [null, "12345"], ["github", null]] as const) {
		it(`refuses unban without GitHub identity (${provider}, ${id})`, async () => {
			const submission = await pending("bound-account", provider, id)
			await accept(submission.id)
			expect(lookups).toEqual([])
			expect(unbans).toEqual([])
			expect((await getFormSubmission(submission.id))?.status).toBe("submitted")
		})
	}

	it("leaves the appeal pending when account revalidation is unavailable", async () => {
		const submission = await pending("bound-account")
		contextStatus = 503
		await accept(submission.id)
		expect(unbans).toEqual([])
		expect((await getFormSubmission(submission.id))?.status).toBe("submitted")
	})

	it("does not contact ClawHub for an unauthorized reviewer", async () => {
		const submission = await pending("bound-account")
		await accept(submission.id, false)
		expect(lookups).toEqual([])
		expect(unbans).toEqual([])
		expect((await getFormSubmission(submission.id))?.status).toBe("submitted")
	})
})
