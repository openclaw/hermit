import { describe, expect, it } from "bun:test"
import type { Client } from "@buape/carbon"
import {
	handlePublisherAbuseDigestApi,
	handlePublisherAbuseDigestApiRequest,
	publisherAbuseDigestApiToken,
	publisherAbuseDigestTrustedOrigins
} from "../src/clawhubPublisherAbuse/api.js"
import { setRuntimeEnv } from "../src/runtime/env.js"

const channelId = "signals-channel"
const roleId = "signals-role"
const endpoint = "https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest"

const collectText = (component: unknown): string[] => {
	if (!component || typeof component !== "object") return []
	const record = component as Record<string, unknown>
	const content = typeof record.content === "string" ? [record.content] : []
	const children = Array.isArray(record.components)
		? record.components.flatMap(collectText)
		: []
	return [...content, ...children]
}

const legacyPayload = {
	kind: "publisher_abuse_signals_changed",
	changedCount: 1,
	hasMore: false,
	dashboardUrl: "https://clawhub.ai/management?view=abuse&tab=signals",
	topSignals: [
		{
			signalId: "publisherAbuseSignals:legacy",
			signalType: "download_spike_flat_installs",
			severity: "high",
			publisher: "local-owner",
			skillSlug: "local-skill",
			skillDisplayName: "Local Skill",
			seenCount: 1,
			firstSeenAt: null,
			lastSeenAt: null,
			recent7Downloads: null,
			recent7Installs: null,
			recent7InstallDownloadRatio: null,
			recent30Downloads: null,
			recent30Installs: null,
			recent30InstallDownloadRatio: null,
			allTimeDownloads: null,
			allTimeInstalls: null,
			allTimeInstallDownloadRatio: null,
			skillUrl: null,
			publisherUrl: null
		}
	]
}

const scanFailurePayload = {
	kind: "publisher_abuse_signal_scan_failed",
	runId: "publisherAbuseScoreRuns:failed-run",
	failureCount: 5,
	errorMessage: "Query exceeded the document read limit.",
	failedAt: 1_716_000_000_000,
	dashboardUrl: "https://clawhub.ai/management?view=abuse&tab=signals"
}

const ownerContactFailurePayload = {
	kind: "publisher_abuse_signal_owner_contact_failed",
	signalId: "publisherAbuseSignals:contact-failed",
	signalType: "download_spike_flat_installs",
	scope: "skill",
	publisher: "local-owner",
	skillSlug: "local-skill",
	skillDisplayName: "Local Skill",
	failureReason: "Recipient address was rejected.",
	attemptCount: 4,
	failedAt: 1_716_000_000_000,
	dashboardUrl: "https://clawhub.ai/management?view=abuse&tab=signals&signal=contact-failed"
}

const ownerResponsePayload = {
	kind: "publisher_abuse_signal_owner_response_submitted",
	signalId: "publisherAbuseSignals:responded",
	signalType: "owner_synchronized_download_trends",
	scope: "publisher",
	publisher: "portfolio-owner",
	skillSlug: null,
	skillDisplayName: null,
	responseKind: "expected",
	responsePreview: "Shared in our newsletter.",
	submittedAt: 1_716_000_000_000,
	dashboardUrl: "https://clawhub.ai/management?view=abuse&tab=signals&signal=responded"
}

const requestFor = (payload: unknown, token = "secret") =>
	new Request(endpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify(payload)
	})

const dependencies = (options: { trustedOrigins?: string[]; configured?: boolean } = {}) => {
	const sends: unknown[] = []
	const fetchedChannels: string[] = []
	return {
		sends,
		fetchedChannels,
		value: {
			token: "secret",
			channelId: options.configured === false ? "" : channelId,
			roleId: options.configured === false ? "" : roleId,
			deliverLegacyDigest: true,
			...(options.trustedOrigins ? { trustedOrigins: options.trustedOrigins } : {}),
			fetchChannel: async (requestedChannelId: string) => {
				fetchedChannels.push(requestedChannelId)
				return {
					send: async (message: unknown) => {
						sends.push(message)
						return { id: "message-123" }
					}
				}
			}
		}
	}
}

const sentText = (send: unknown) => {
	const record = send as { components?: unknown[] }
	return (record.components ?? []).flatMap(collectText).join("\n")
}

describe("ClawHub publisher abuse event API", () => {
	it("reads the dedicated token and trusted origin configuration", () => {
		expect(publisherAbuseDigestApiToken({
			CLAWHUB_HERMIT_TOKEN: " dedicated-token ",
			CLAWHUB_BAN_APPEALS_TOKEN: "legacy-token"
		})).toBe("dedicated-token")
		expect(publisherAbuseDigestTrustedOrigins({
			CLAWHUB_SITE_URL: " https://clawhub.example.test/management "
		})).toEqual(["https://clawhub.example.test"])
	})

	it("keeps legacy changed-signals delivery active during the cutover", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(requestFor(legacyPayload), deps.value)

		expect(response?.status).toBe(200)
		expect(await response?.json()).toEqual({
			ok: true,
			delivered: true,
			changedCount: 1
		})
		expect(deps.fetchedChannels).toEqual([channelId])
		expect(sentText(deps.sends[0])).toContain("ClawHub publisher abuse signals changed")
	})

	it("can disable legacy digest delivery only through the coordinated config cutover", async () => {
		const deps = dependencies()
		deps.value.deliverLegacyDigest = false
		const response = await handlePublisherAbuseDigestApi(requestFor(legacyPayload), deps.value)

		expect(response?.status).toBe(200)
		expect(await response?.json()).toEqual({
			ok: true,
			delivered: false,
			deprecated: true,
			kind: "publisher_abuse_signals_changed"
		})
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("renders each actionable variant to the configured channel and role", async () => {
		const cases = [
			{
				payload: scanFailurePayload,
				expected: ["ClawHub signal scan stopped", "Stopped after 5 failed attempts", "Query exceeded"]
			},
			{
				payload: ownerContactFailurePayload,
				expected: ["ClawHub owner contact failed", "Local Skill", "Recipient address was rejected"]
			},
			{
				payload: ownerResponsePayload,
				expected: ["ClawHub owner explanation received", "@portfolio-owner", "Expected traffic", "newsletter"]
			}
		]

		for (const testCase of cases) {
			const deps = dependencies()
			const response = await handlePublisherAbuseDigestApi(requestFor(testCase.payload), deps.value)
			expect(response?.status).toBe(200)
			expect(deps.fetchedChannels).toEqual([channelId])
			expect(deps.sends).toHaveLength(1)
			const send = deps.sends[0] as { allowedMentions?: unknown }
			expect(send.allowedMentions).toEqual({ roles: [roleId], users: [] })
			const text = sentText(send)
			expect(text).toContain(`<@&${roleId}>`)
			expect(text).toContain("[Open")
			for (const expectedText of testCase.expected) expect(text).toContain(expectedText)
		}
	})

	it("escapes publisher text and bounds the owner response preview to 500 characters", async () => {
		const deps = dependencies()
		const marker = "[trap](https://evil.example)"
		const response = await handlePublisherAbuseDigestApi(
			requestFor({
				...ownerResponsePayload,
				publisher: `owner ${marker}`,
				responsePreview: `${marker} ${"x".repeat(700)}`
			}),
			deps.value
		)

		expect(response?.status).toBe(200)
		const text = sentText(deps.sends[0])
		expect(text).toContain("\\[trap\\]\\(https://evil.example\\)")
		expect(text).not.toContain(marker)
		const ownerNote = text.split("**Owner note:** ")[1]?.split("\n")[0] ?? ""
		const unescapedOwnerNote = ownerNote.replaceAll("\\", "")
		expect([...unescapedOwnerNote]).toHaveLength(500)
	})

	it("rejects untrusted ClawHub links before Discord delivery", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			requestFor({ ...ownerResponsePayload, dashboardUrl: "https://evil.example/signal" }),
			deps.value
		)

		expect(response?.status).toBe(400)
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("rejects malformed actionable payloads before Discord delivery", async () => {
		for (const payload of [
			{ ...scanFailurePayload, failureCount: 0 },
			{ ...ownerContactFailurePayload, attemptCount: -1 },
			{ ...ownerResponsePayload, responseKind: "maybe" },
			{ ...ownerResponsePayload, scope: "skill", skillSlug: null }
		]) {
			const deps = dependencies()
			const response = await handlePublisherAbuseDigestApi(requestFor(payload), deps.value)
			expect(response?.status).toBe(400)
			expect(deps.fetchedChannels).toEqual([])
		}
	})

	it("keeps actionable delivery retryable when routing is not configured", async () => {
		const deps = dependencies({ configured: false })
		const response = await handlePublisherAbuseDigestApi(requestFor(ownerResponsePayload), deps.value)

		expect(response?.status).toBe(503)
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("passes runtime configuration into the production request wrapper", async () => {
		setRuntimeEnv({
			CLAWHUB_HERMIT_TOKEN: " dedicated-token ",
			CLAWHUB_SITE_URL: "https://clawhub.example.test"
		} as Env)
		const sends: unknown[] = []
		const fetchedChannels: string[] = []
		const client = {
			fetchChannel: async (requestedChannelId: string) => {
				fetchedChannels.push(requestedChannelId)
				return { send: async (message: unknown) => sends.push(message) }
			}
		} as unknown as Client
		const response = await handlePublisherAbuseDigestApiRequest(
			requestFor({
				...ownerResponsePayload,
				dashboardUrl: "https://clawhub.example.test/management?signal=responded"
			}, "dedicated-token"),
			client
		)

		expect(response?.status).toBe(200)
		expect(fetchedChannels).toEqual(["1498032057337647295"])
		expect(sentText(sends[0])).toContain("<@&1509967254870298794>")
	})

	it("requires bearer authentication and POST before reading a payload", async () => {
		const deps = dependencies()
		const unauthorized = await handlePublisherAbuseDigestApi(
			new Request(endpoint, { method: "POST", body: JSON.stringify(ownerResponsePayload) }),
			deps.value
		)
		const wrongMethod = await handlePublisherAbuseDigestApi(
			new Request(endpoint, { headers: { Authorization: "Bearer secret" } }),
			deps.value
		)

		expect(unauthorized?.status).toBe(401)
		expect(wrongMethod?.status).toBe(405)
		expect(deps.fetchedChannels).toEqual([])
	})

	it("lets unrelated routes continue", async () => {
		const deps = dependencies()
		expect(
			await handlePublisherAbuseDigestApi(new Request("https://forms.openclaw.ai/health"), deps.value)
		).toBeNull()
	})
})
