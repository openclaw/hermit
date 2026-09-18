import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import {
	getRecentDiscrawlObservations,
	getDiscrawlObservationCount,
	clearDiscrawlCache
} from "../src/services/discrawl.js"
import { reviewConfig } from "../src/config/review.js"
import { getRecentUserObservations, getUserObservationCount } from "../src/data/review.js"
import { startDiscrawlServer } from "../forwarder/src/discrawlServer.js"

describe("Discrawl Backend Integration", () => {
	let tempDir: string
	const previousEnv = process.env.DISCRAWL_EXPORT_PATH

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-discrawl-test-"))
		clearDiscrawlCache()
	})

	afterEach(() => {
		clearDiscrawlCache()
		if (previousEnv !== undefined) {
			process.env.DISCRAWL_EXPORT_PATH = previousEnv
		} else {
			delete process.env.DISCRAWL_EXPORT_PATH
		}
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {
			// ignore cleanup errors
		}
	})

	it("parses single JSON export file and extracts review observations", () => {
		const filePath = path.join(tempDir, "messages.json")
		const now = Date.now()

		const sampleData = [
			{
				id: "msg-p1",
				guild_id: reviewConfig.guildId,
				channel_id: "chan-1",
				author: { id: "human-other", username: "other" },
				content: "What is the status of the build?",
				timestamp: new Date(now - 10000).toISOString()
			},
			{
				id: "msg-1",
				guild_id: reviewConfig.guildId,
				channel_id: "chan-1",
				author: { id: "author-ai-1", username: "ai-bot" },
				content: "> 🧠 **Thinking Process**\n> 1. Check build\nBuild passed successfully.",
				timestamp: new Date(now - 8000).toISOString(),
				message_reference: { message_id: "msg-p1" }
			},
			{
				id: "msg-2",
				guild_id: reviewConfig.guildId,
				channel_id: "chan-1",
				author: { id: "author-ai-1", username: "ai-bot" },
				content: "Here is the summary of the logs:\n* Step 1: Complete\n* Step 2: Verified",
				timestamp: new Date(now - 4000).toISOString()
			},
			{
				id: "msg-unrelated",
				guild_id: reviewConfig.guildId,
				channel_id: "chan-1",
				author: { id: "author-human-2", username: "human2" },
				content: "sounds good thanks",
				timestamp: new Date(now - 2000).toISOString()
			}
		]

		fs.writeFileSync(filePath, JSON.stringify(sampleData, null, 2))

		const observations = getRecentDiscrawlObservations(
			filePath,
			reviewConfig.guildId,
			"author-ai-1",
			7,
			100
		)

		expect(observations.length).toBe(2)
		expect(observations[0].authorId).toBe("author-ai-1")
		// Most recent message is msg-2
		expect(observations[0].messageId).toBe("msg-2")
		expect(observations[1].messageId).toBe("msg-1")
		// Reply latency computed from parent msg-p1 (8000ms ago vs 10000ms ago -> 2000ms latency)
		expect(observations[1].replyLatencyMs).toBe(2000)
		expect(observations[1].artifacts).toContain("execution-marker")

		const count = getDiscrawlObservationCount(
			filePath,
			reviewConfig.guildId,
			"author-ai-1",
			7
		)
		expect(count).toBe(2)
	})

	it("parses directory of channel JSON and JSONL exports", () => {
		const now = Date.now()
		const chan1Path = path.join(tempDir, "chan-1.json")
		const chan2Path = path.join(tempDir, "chan-2.jsonl")

		const chan1Messages = [
			{
				id: "m-c1-1",
				guildId: reviewConfig.guildId,
				channelId: "chan-1",
				authorId: "multi-channel-user",
				content: "First message in general",
				timestamp: now - 30000
			}
		]
		fs.writeFileSync(chan1Path, JSON.stringify(chan1Messages))

		const chan2Lines = [
			JSON.stringify({
				id: "m-c2-1",
				guild_id: reviewConfig.guildId,
				channel_id: "chan-2",
				author: { id: "multi-channel-user" },
				content: "Second message in dev channel",
				timestamp: new Date(now - 15000).toISOString()
			}),
			JSON.stringify({
				id: "m-c2-2",
				guild_id: reviewConfig.guildId,
				channel_id: "chan-2",
				author: { id: "other-user" },
				content: "unrelated message",
				timestamp: new Date(now - 10000).toISOString()
			})
		].join("\n")
		fs.writeFileSync(chan2Path, chan2Lines)

		const observations = getRecentDiscrawlObservations(
			tempDir,
			reviewConfig.guildId,
			"multi-channel-user",
			7,
			100
		)

		expect(observations.length).toBe(2)
		expect(observations[0].messageId).toBe("m-c2-1")
		expect(observations[1].messageId).toBe("m-c1-1")

		const count = getDiscrawlObservationCount(
			tempDir,
			reviewConfig.guildId,
			"multi-channel-user",
			7
		)
		expect(count).toBe(2)
	})

	it("integrates seamlessly into getRecentUserObservations when DISCRAWL_EXPORT_PATH is set", async () => {
		const filePath = path.join(tempDir, "export.json")
		const now = Date.now()

		const sample = [
			{
				id: "discrawl-live-1",
				guild_id: reviewConfig.guildId,
				channel_id: "chan-1",
				author: { id: "test-subject-42" },
				content: "Automated analysis via Discrawl backend",
				timestamp: now - 5000
			}
		]
		fs.writeFileSync(filePath, JSON.stringify(sample))

		process.env.DISCRAWL_EXPORT_PATH = filePath

		const obs = await getRecentUserObservations(
			reviewConfig.guildId,
			"test-subject-42",
			7,
			50
		)
		expect(obs.length).toBe(1)
		expect(obs[0].messageId).toBe("discrawl-live-1")

		const count = await getUserObservationCount(
			reviewConfig.guildId,
			"test-subject-42",
			7
		)
		expect(count).toBe(1)
	})

	it("fetches observations remotely when DISCRAWL_EXPORT_URL is configured", async () => {
		const filePath = path.join(tempDir, "export-remote.json")
		const now = Date.now()

		const sample = [
			{
				id: "remote-msg-1",
				guild_id: reviewConfig.guildId,
				channel_id: "chan-1",
				author: { id: "remote-user-1" },
				content: "Remote test via forwarder HTTP server",
				timestamp: now - 3000
			}
		]
		fs.writeFileSync(filePath, JSON.stringify(sample))

		const server = startDiscrawlServer({
			exportPath: filePath,
			secret: "test-secret-discrawl",
			port: 39182
		})

		const prevUrl = process.env.DISCRAWL_EXPORT_URL
		const prevSec = process.env.DISCRAWL_SECRET
		process.env.DISCRAWL_EXPORT_URL = "http://127.0.0.1:39182"
		process.env.DISCRAWL_SECRET = "test-secret-discrawl"

		try {
			const obs = await getRecentUserObservations(
				reviewConfig.guildId,
				"remote-user-1",
				7,
				50
			)
			expect(obs.length).toBe(1)
			expect(obs[0].messageId).toBe("remote-msg-1")

			const count = await getUserObservationCount(
				reviewConfig.guildId,
				"remote-user-1",
				7
			)
			expect(count).toBe(1)
		} finally {
			server.stop(true)
			if (prevUrl !== undefined) process.env.DISCRAWL_EXPORT_URL = prevUrl
			else delete process.env.DISCRAWL_EXPORT_URL
			if (prevSec !== undefined) process.env.DISCRAWL_SECRET = prevSec
			else delete process.env.DISCRAWL_SECRET
		}
	})

	it("authenticates discrawl server requests and rejects unauthorized calls", async () => {
		const filePath = path.join(tempDir, "auth-export.json")
		fs.writeFileSync(
			filePath,
			JSON.stringify([
				{
					id: "auth-msg-1",
					guild_id: reviewConfig.guildId,
					channel_id: "chan-1",
					author: { id: "auth-user" },
					content: "hello",
					timestamp: Date.now()
				}
			])
		)

		const discrawlSecret = "custom-discrawl-secret"
		const deploySecret = "fallback-deploy-secret"
		// Test precedence: DISCRAWL_SECRET || DEPLOY_SECRET
		const activeSecret = discrawlSecret || deploySecret

		const server = startDiscrawlServer({
			exportPath: filePath,
			secret: activeSecret,
			port: 39183
		})

		try {
			// Unauthorized request without secret
			const unauthRes = await fetch(
				`http://127.0.0.1:39183/api/discrawl/observations?guildId=${reviewConfig.guildId}&authorId=auth-user`
			)
			expect(unauthRes.status).toBe(401)

			// Authorized request with custom-discrawl-secret
			const authRes = await fetch(
				`http://127.0.0.1:39183/api/discrawl/observations?guildId=${reviewConfig.guildId}&authorId=auth-user`,
				{
					headers: { Authorization: `Bearer ${activeSecret}` }
				}
			)
			expect(authRes.status).toBe(200)
			const body = (await authRes.json()) as any[]
			expect(body.length).toBe(1)
			expect(body[0].messageId).toBe("auth-msg-1")
		} finally {
			server.stop(true)
		}
	})
})
