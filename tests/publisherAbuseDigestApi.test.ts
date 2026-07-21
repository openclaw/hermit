import { describe, expect, it } from "bun:test"
import type { Client } from "@buape/carbon"
import {
	handlePublisherAbuseDigestApi,
	handlePublisherAbuseDigestApiRequest,
	publisherAbuseDigestApiToken,
	publisherAbuseDigestTrustedOrigins
} from "../src/clawhubPublisherAbuse/api.js"
import { setRuntimeEnv } from "../src/runtime/env.js"

const collectText = (component: unknown): string[] => {
	if (!component || typeof component !== "object") {
		return []
	}

	const record = component as Record<string, unknown>
	const content = typeof record.content === "string" ? [record.content] : []
	const children = Array.isArray(record.components)
		? record.components.flatMap(collectText)
		: []

	return [...content, ...children]
}

const validPayload = {
	kind: "publisher_abuse_signals_changed",
	changedCount: 1,
	hasMore: false,
	dashboardUrl: "https://clawhub.ai/management?view=abuse&tab=signals",
	topSignals: [
		{
			signalId: "publisherAbuseSignals:local-loopback",
			signalType: "high_install_download_ratio",
			severity: "high",
			publisher: "local-owner",
			skillSlug: "local-skill",
			skillDisplayName: "Local Skill",
			seenCount: 4,
			firstSeenAt: 1715900000000,
			lastSeenAt: 1716000000000,
			recent7Downloads: 1000,
			recent7Installs: 100,
			recent7InstallDownloadRatio: 0.1,
			recent30Downloads: 3000,
			recent30Installs: 300,
			recent30InstallDownloadRatio: 0.1,
			allTimeDownloads: 12000,
			allTimeInstalls: 1200,
			allTimeInstallDownloadRatio: 0.1,
			skillUrl: "https://clawhub.ai/local-owner/skills/local-skill",
			publisherUrl: "https://clawhub.ai/local-owner"
		}
	]
}

const validScanFailurePayload = {
	kind: "publisher_abuse_signal_scan_failed",
	runId: "publisherAbuseScoreRuns:failed-run",
	failureCount: 5,
	errorMessage: "Query exceeded the document read limit.",
	failedAt: 1716000000000,
	dashboardUrl: "https://clawhub.ai/management?view=abuse&tab=signals"
}

const dependencies = (options: { trustedOrigins?: string[] } = {}) => {
	const sends: unknown[] = []
	const fetchedChannels: string[] = []
	return {
		sends,
		fetchedChannels,
		value: {
			token: "secret",
			...options,
			fetchChannel: async (channelId: string) => {
				fetchedChannels.push(channelId)
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

const clientDependencies = () => {
	const sends: unknown[] = []
	const fetchedChannels: string[] = []
	const client = {
		fetchChannel: async (channelId: string) => {
			fetchedChannels.push(channelId)
			return {
				send: async (message: unknown) => {
					sends.push(message)
					return { id: "message-123" }
				}
			}
		}
	} as unknown as Client

	return { sends, fetchedChannels, client }
}

describe("ClawHub publisher abuse digest API", () => {
	it("prefers the dedicated ClawHub-Hermit token when configured", () => {
		expect(publisherAbuseDigestApiToken({
			CLAWHUB_HERMIT_TOKEN: " dedicated-token ",
			CLAWHUB_BAN_APPEALS_TOKEN: "legacy-token"
		})).toBe("dedicated-token")
		expect(publisherAbuseDigestApiToken({
			CLAWHUB_BAN_APPEALS_TOKEN: "legacy-token"
		})).toBe("legacy-token")
		expect(publisherAbuseDigestApiToken({
			CLAWHUB_BAN_APPEALS_TOKEN: " fallback-token "
		})).toBe("fallback-token")
		expect(publisherAbuseDigestApiToken({})).toBe("")
	})

	it("builds trusted ClawHub link origins from configuration", () => {
		expect(publisherAbuseDigestTrustedOrigins({})).toEqual(["https://clawhub.ai"])
		expect(publisherAbuseDigestTrustedOrigins({
			CLAWHUB_SITE_URL: " https://clawhub.example.test/management?view=abuse "
		})).toEqual(["https://clawhub.example.test"])
	})

	it("sends a valid digest to the ClawHub review channel", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: {
					Authorization: "Bearer secret",
					"Content-Type": "application/json"
				},
				body: JSON.stringify(validPayload)
			}),
			deps.value
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true, delivered: true, changedCount: 1 })
		expect(deps.fetchedChannels).toEqual(["1498032057337647295"])
		expect(deps.sends).toHaveLength(1)

		const send = deps.sends[0] as { components?: unknown[]; allowedMentions?: unknown }
		const text = (send.components ?? []).flatMap(collectText).join("\n")
		expect(send.allowedMentions).toEqual({
			roles: ["1509967254870298794"],
			users: []
		})
		expect(text).toContain("<@&1509967254870298794>")
		expect(text).toContain("ClawHub publisher abuse signals changed")
		expect(text).toContain("1 changed signal needs review.")
		expect(text).toContain("[Open ClawHub abuse signals](<https://clawhub.ai/management?view=abuse&tab=signals>)")
		expect(text).toContain("Local Skill")
		expect(text).toContain("local-owner/local-skill")
		expect(text).toContain("Seen 4x")
		expect(text).toContain("[Skill](<https://clawhub.ai/local-owner/skills/local-skill>)")
		expect(text).toContain("[Publisher](<https://clawhub.ai/local-owner>)")
	})

	it("sends a terminal signal scan failure alert to the ClawHub review channel", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: {
					Authorization: "Bearer secret",
					"Content-Type": "application/json"
				},
				body: JSON.stringify(validScanFailurePayload)
			}),
			deps.value
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			ok: true,
			delivered: true,
			kind: "publisher_abuse_signal_scan_failed"
		})
		expect(deps.fetchedChannels).toEqual(["1498032057337647295"])
		expect(deps.sends).toHaveLength(1)

		const send = deps.sends[0] as { components?: unknown[]; allowedMentions?: unknown }
		const text = (send.components ?? []).flatMap(collectText).join("\n")
		expect(send.allowedMentions).toEqual({
			roles: ["1509967254870298794"],
			users: []
		})
		expect(text).toContain("<@&1509967254870298794>")
		expect(text).toContain("ClawHub signal scan stopped")
		expect(text).toContain("Stopped after 5 failed attempts")
		expect(text).toContain("Query exceeded the document read limit.")
		expect(text).toContain("publisherAbuseScoreRuns:failed-run")
		expect(text).toContain("[Open ClawHub abuse signals](<https://clawhub.ai/management?view=abuse&tab=signals>)")
	})

	it("escapes digest text before rendering Discord markdown", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: {
					Authorization: "Bearer secret",
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					...validPayload,
					dashboardUrl: "https://clawhub.ai/management?next=)[Dash](https://evil.example)",
					topSignals: [
						{
							...validPayload.topSignals[0],
							signalType: "high_install_download_ratio\n[extra](https://evil.example)",
							severity: "high](https://evil.example)",
							publisher: "local-owner\n[Publisher Trap](https://evil.example)",
							skillSlug: "local-skill](https://evil.example)",
							skillDisplayName: "Local Skill\n[Click](https://evil.example)",
							skillUrl: "https://clawhub.ai/local-owner/skills/local-skill)",
							publisherUrl: "https://clawhub.ai/local-owner)"
						}
					]
				})
			}),
			deps.value
		)

		expect(response.status).toBe(200)
		expect(deps.sends).toHaveLength(1)

		const send = deps.sends[0] as { components?: unknown[] }
		const text = (send.components ?? []).flatMap(collectText).join("\n")
		expect(text).toContain("[Open ClawHub abuse signals](<https://clawhub.ai/management?next=)[Dash](https://evil.example)>)")
		expect(text).toContain("Local Skill \\[Click\\]\\(https://evil.example\\)")
		expect(text).toContain("local-owner \\[Publisher Trap\\]\\(https://evil.example\\)")
		expect(text).toContain("local-skill\\]\\(https://evil.example\\)")
		expect(text).toContain("[Skill](<https://clawhub.ai/local-owner/skills/local-skill)>)")
		expect(text).toContain("[Publisher](<https://clawhub.ai/local-owner)>)")
		expect(text).not.toContain("[Click](https://evil.example)")
		expect(text).not.toContain("[Publisher Trap](https://evil.example)")
	})

	it("accepts digest links from the configured ClawHub origin", async () => {
		const deps = dependencies({
			trustedOrigins: publisherAbuseDigestTrustedOrigins({
				CLAWHUB_SITE_URL: "https://clawhub.example.test"
			})
		})
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: {
					Authorization: "Bearer secret",
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					...validPayload,
					dashboardUrl: "https://clawhub.example.test/management?view=abuse&tab=signals",
					topSignals: [
						{
							...validPayload.topSignals[0],
							skillUrl: "https://clawhub.example.test/local-owner/skills/local-skill",
							publisherUrl: "https://clawhub.example.test/local-owner"
						}
					]
				})
			}),
			deps.value
		)

		expect(response.status).toBe(200)
		expect(deps.sends).toHaveLength(1)

		const send = deps.sends[0] as { components?: unknown[] }
		const text = (send.components ?? []).flatMap(collectText).join("\n")
		expect(text).toContain("[Open ClawHub abuse signals](<https://clawhub.example.test/management?view=abuse&tab=signals>)")
		expect(text).toContain("[Skill](<https://clawhub.example.test/local-owner/skills/local-skill>)")
		expect(text).toContain("[Publisher](<https://clawhub.example.test/local-owner>)")
	})

	it("shows a hint when supplied signals are locally truncated", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: {
					Authorization: "Bearer secret",
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					...validPayload,
					changedCount: 6,
					hasMore: false,
					topSignals: Array.from({ length: 6 }, (_, index) => ({
						...validPayload.topSignals[0],
						signalId: `publisherAbuseSignals:local-${index}`,
						skillSlug: `local-skill-${index}`,
						skillUrl: `https://clawhub.ai/local-owner/skills/local-skill-${index}`
					}))
				})
			}),
			deps.value
		)

		expect(response.status).toBe(200)
		expect(deps.sends).toHaveLength(1)

		const send = deps.sends[0] as { components?: unknown[] }
		const text = (send.components ?? []).flatMap(collectText).join("\n")
		expect(text).toContain("local-owner/local-skill-4")
		expect(text).not.toContain("local-owner/local-skill-5")
		expect(text).toContain("More signals are available in ClawHub.")
	})

	it("passes runtime token and trusted origin into the production request wrapper", async () => {
		setRuntimeEnv({
			CLAWHUB_BAN_APPEALS_TOKEN: "legacy-token",
			CLAWHUB_HERMIT_TOKEN: " dedicated-token ",
			CLAWHUB_SITE_URL: " https://clawhub.example.test/management?view=abuse "
		} as Env)
		const deps = clientDependencies()
		const response = await handlePublisherAbuseDigestApiRequest(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: {
					Authorization: "Bearer dedicated-token",
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					...validPayload,
					dashboardUrl: "https://clawhub.example.test/management?view=abuse&tab=signals",
					topSignals: [
						{
							...validPayload.topSignals[0],
							skillUrl: "https://clawhub.example.test/local-owner/skills/local-skill",
							publisherUrl: "https://clawhub.example.test/local-owner"
						}
					]
				})
			}),
			deps.client
		)

		expect(response.status).toBe(200)
		expect(deps.fetchedChannels).toEqual(["1498032057337647295"])
		expect(deps.sends).toHaveLength(1)

		const send = deps.sends[0] as { components?: unknown[] }
		const text = (send.components ?? []).flatMap(collectText).join("\n")
		expect(text).toContain("[Open ClawHub abuse signals](<https://clawhub.example.test/management?view=abuse&tab=signals>)")
		expect(text).toContain("[Skill](<https://clawhub.example.test/local-owner/skills/local-skill>)")
		expect(text).toContain("[Publisher](<https://clawhub.example.test/local-owner>)")
	})

	it("lets unrelated routes continue when ClawHub tokens are unset", async () => {
		setRuntimeEnv({} as Env)
		const deps = clientDependencies()

		const response = await handlePublisherAbuseDigestApiRequest(
			new Request("https://forms.openclaw.ai/health"),
			deps.client
		)

		expect(response).toBeNull()
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("requires the shared ClawHub-Hermit bearer token", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				body: JSON.stringify(validPayload)
			}),
			deps.value
		)

		expect(response.status).toBe(401)
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("rejects authorization headers without the Bearer scheme", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: { Authorization: "secret" },
				body: JSON.stringify(validPayload)
			}),
			deps.value
		)

		expect(response.status).toBe(401)
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("rejects the wrong bearer token before sending to Discord", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: { Authorization: "Bearer wrong-secret" },
				body: JSON.stringify(validPayload)
			}),
			deps.value
		)

		expect(response.status).toBe(401)
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("rejects unsupported methods before sending to Discord", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				headers: { Authorization: "Bearer secret" }
			}),
			deps.value
		)

		expect(response.status).toBe(405)
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("rejects invalid digest payloads before sending to Discord", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: {
					Authorization: "Bearer secret",
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ ...validPayload, topSignals: [] })
			}),
			deps.value
		)

		expect(response.status).toBe(400)
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("rejects invalid JSON before sending to Discord", async () => {
		const deps = dependencies()
		const response = await handlePublisherAbuseDigestApi(
			new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
				method: "POST",
				headers: {
					Authorization: "Bearer secret",
					"Content-Type": "application/json"
				},
				body: "{"
			}),
			deps.value
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: "Invalid JSON" })
		expect(deps.fetchedChannels).toEqual([])
		expect(deps.sends).toEqual([])
	})

	it("rejects non-web digest URLs before sending to Discord", async () => {
		const cases = [
			{ dashboardUrl: "javascript:alert(1)" },
			{ topSignals: [{ ...validPayload.topSignals[0], skillUrl: "javascript:alert(1)" }] },
			{ topSignals: [{ ...validPayload.topSignals[0], publisherUrl: "ftp://clawhub.ai/local-owner" }] }
		]

		for (const payload of cases) {
			const deps = dependencies()
			const response = await handlePublisherAbuseDigestApi(
				new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
					method: "POST",
					headers: {
						Authorization: "Bearer secret",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ ...validPayload, ...payload })
				}),
				deps.value
			)

			expect(response.status).toBe(400)
			expect(deps.fetchedChannels).toEqual([])
			expect(deps.sends).toEqual([])
		}
	})

	it("rejects cross-origin digest URLs before sending to Discord", async () => {
		const cases = [
			{ dashboardUrl: "https://evil.example/management?view=abuse&tab=signals" },
			{ topSignals: [{ ...validPayload.topSignals[0], skillUrl: "https://evil.example/local-owner/skills/local-skill" }] },
			{ topSignals: [{ ...validPayload.topSignals[0], publisherUrl: "https://evil.example/local-owner" }] }
		]

		for (const payload of cases) {
			const deps = dependencies()
			const response = await handlePublisherAbuseDigestApi(
				new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
					method: "POST",
					headers: {
						Authorization: "Bearer secret",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ ...validPayload, ...payload })
				}),
				deps.value
			)

			expect(response.status).toBe(400)
			expect(deps.fetchedChannels).toEqual([])
			expect(deps.sends).toEqual([])
		}
	})

	it("rejects negative digest metrics before sending to Discord", async () => {
		const cases = [
			{ topSignals: [{ ...validPayload.topSignals[0], firstSeenAt: -1 }] },
			{ topSignals: [{ ...validPayload.topSignals[0], recent7Downloads: -1 }] },
			{ topSignals: [{ ...validPayload.topSignals[0], recent7Downloads: 1.5 }] },
			{ topSignals: [{ ...validPayload.topSignals[0], recent7InstallDownloadRatio: -0.1 }] }
		]

		for (const payload of cases) {
			const deps = dependencies()
			const response = await handlePublisherAbuseDigestApi(
				new Request("https://forms.openclaw.ai/api/clawhub-publisher-abuse/signals/digest", {
					method: "POST",
					headers: {
						Authorization: "Bearer secret",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ ...validPayload, ...payload })
				}),
				deps.value
			)

			expect(response.status).toBe(400)
			expect(deps.fetchedChannels).toEqual([])
			expect(deps.sends).toEqual([])
		}
	})
})
