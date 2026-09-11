import { afterEach, describe, expect, test } from "bun:test"
import { formConfigs } from "../../forms.config.js"
import type { FormSubmission } from "../../src/db/schema.js"
import { clawHubUnbanRequest, resolveTarget } from "../../src/forms/actions.js"
import { buildSubmissionPayload, collectPayload } from "../../src/forms/payload.js"

const clawhubForm = formConfigs.find((form) => form.id === "clawhub")
if (!clawhubForm) {
	throw new Error("clawhub form config is missing")
}

const contextId = "oauth-clawhub-user"
const attackerId = "attacker"

const context = {
	action: "banned",
	unaction: "unbanned",
	clawhubUserId: contextId,
	clawhubHandle: "@victim",
	account: "Victim",
	banReason: "spam",
	moderationReason: "spam",
	date: "2026-01-01T00:00:00.000Z",
	scope: "ClawHub account",
	auditAction: "ban",
	auditActorUserId: "mod-1",
	links: "https://clawhub.ai/victim"
}

const attackFormData = () => {
	const body = new FormData()
	body.set("session", "sess")
	body.set("appealReason", "please unban me")
	body.set("changedSince", "I will follow the rules")
	body.set("extraContext", "thanks")
	body.set("clawhubUserId", attackerId)
	body.set("clawhubHandle", "@attacker")
	body.set("injected", "nope")
	return body
}

const attackRequest = () =>
	new Request("https://appeals.openclaw.ai/clawhub/submit", {
		method: "POST",
		body: attackFormData()
	})

const makeSubmission = (payload: Record<string, string>): FormSubmission => ({
	id: 1,
	formId: "clawhub",
	status: "submitted",
	authProvider: "github",
	applicantId: "gh-123",
	applicantUsername: "victim",
	payload: JSON.stringify(payload),
	reviewChannelId: "1",
	reviewMessageId: null,
	reviewThreadId: null,
	decidedAt: null,
	decidedById: null,
	decisionReason: null,
	actionResult: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z"
})

const storedAppealPayload = async () => {
	const collected = await collectPayload(attackRequest(), clawhubForm)
	return buildSubmissionPayload(collected.payload, context)
}

describe("ClawHub appeal submit payload", () => {
	test("collectPayload keeps configured fields and drops client clawhubUserId", async () => {
		const collected = await collectPayload(attackRequest(), clawhubForm)
		expect(collected.session).toBe("sess")
		expect(collected.payload.appealReason).toBe("please unban me")
		expect(collected.payload.changedSince).toBe("I will follow the rules")
		expect(collected.payload.extraContext).toBe("thanks")
		expect(collected.payload.clawhubUserId).toBeUndefined()
		expect(collected.payload.clawhubHandle).toBeUndefined()
		expect(collected.payload.injected).toBeUndefined()
	})

	test("stored payload keeps OAuth context identity over injected FormData", async () => {
		const payload = await storedAppealPayload()
		expect(payload.clawhubUserId).toBe(contextId)
		expect(payload.clawhubHandle).toBe("@victim")
		expect(payload.appealReason).toBe("please unban me")
		expect(payload.injected).toBeUndefined()
	})

	test("buildSubmissionPayload overlays context last for identity fields", () => {
		const payload = buildSubmissionPayload(
			{
				appealReason: "please unban me",
				clawhubUserId: attackerId,
				clawhubHandle: "@attacker"
			},
			{
				clawhubUserId: contextId,
				clawhubHandle: "@victim"
			}
		)
		expect(payload.clawhubUserId).toBe(contextId)
		expect(payload.clawhubHandle).toBe("@victim")
		expect(payload.appealReason).toBe("please unban me")
	})
})

describe("ClawHub unban target", () => {
	const originalFetch = globalThis.fetch
	const originalToken = process.env.CLAWHUB_BAN_APPEALS_TOKEN

	afterEach(() => {
		globalThis.fetch = originalFetch
		if (originalToken === undefined) {
			delete process.env.CLAWHUB_BAN_APPEALS_TOKEN
		} else {
			process.env.CLAWHUB_BAN_APPEALS_TOKEN = originalToken
		}
	})

	test("resolveTarget uses context clawhubUserId not the injected id", async () => {
		const payload = await storedAppealPayload()
		expect(resolveTarget("clawhubUserId", makeSubmission(payload))).toBe(contextId)
	})

	test("clawHubUnbanRequest posts the context id not attacker FormData", async () => {
		process.env.CLAWHUB_BAN_APPEALS_TOKEN = "test-token"
		const posted: Array<{ url: string; body: { userId?: string } }> = []
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			posted.push({
				url: String(input),
				body: JSON.parse(String(init?.body ?? "{}")) as { userId?: string }
			})
			return new Response("{}", { status: 200 })
		}) as typeof fetch

		await clawHubUnbanRequest(
			{ type: "clawhub.unbanUser", target: "clawhubUserId", reason: "Appeal accepted." },
			makeSubmission(await storedAppealPayload()),
			{ reviewerDiscordId: "reviewer-1" }
		)

		expect(posted).toHaveLength(1)
		expect(posted[0]?.body.userId).toBe(contextId)
		expect(posted[0]?.body.userId).not.toBe(attackerId)
	})
})
