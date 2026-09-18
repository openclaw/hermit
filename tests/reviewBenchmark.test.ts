import { describe, expect, it } from "bun:test"
import { contentFeatures } from "../src/review/features.js"
import { analyze } from "../src/review/analyzer.js"
import type { ReviewMessage } from "../src/review/types.js"

const SECRET_KEY = "test-salt-key-that-is-at-least-32-chars-long-padding"

describe("Claw & Order / Hermit Offline Benchmark", () => {
	it("reproduces 100/100 High concordance review-recommended on Rowan bot profile", () => {
		const startAt = Date.now() - 7 * 86400000
		const messages: ReviewMessage[] = []

		// 88 messages total, replicating Rowan bot session
		for (let i = 0; i < 88; i++) {
			const createdAt = startAt + i * 70000
			let content = "Acknowledging task and checking telemetry."
			let replyLatencyMs: number | null = null

			if (i % 2 === 0) {
				// Rapid response with synthetic thinking and markdown headers
				content = `> 🧠 **Thinking Process**\n> 1. Formulate plan\n> 2. Execute steps\n\n### Execution Results\n* **Status:** Complete\n* **Details:** Checked service endpoint.\n\nCertainly! Here is the full breakdown. Hope this helps!`
				replyLatencyMs = 1200 // 1.2s -> superhuman chars/sec (>500 c/s)
			} else if (i % 3 === 0) {
				content = `Running diagnostics: completed in 0.45s. Summary of findings: All checks passed.`
				replyLatencyMs = 1800
			}

			const feat = contentFeatures(content, SECRET_KEY, "g1", "rowan-bot-1531171766179856496")

			messages.push({
				guildId: "g1",
				authorId: "rowan-bot-1531171766179856496",
				messageId: `msg-${i}`,
				channelId: "channel-general",
				createdAt,
				replyToId: i % 2 === 0 ? `parent-${i}` : null,
				replyLatencyMs,
				contentLength: feat.contentLength,
				lineCount: feat.lineCount,
				fingerprint: feat.fingerprint,
				artifacts: feat.artifacts
			})
		}

		const report = analyze({
			guildId: "g1",
			authorId: "rowan-bot-1531171766179856496",
			startAt,
			endAt: Date.now(),
			messages
		})

		// Rowan bot must achieve review-recommended and high score across multi-families
		expect(report.priority).toBe("review-recommended")
		expect(report.concordance).toBe("High")
		expect(report.heuristicScore).toBeGreaterThanOrEqual(80)
		expect(report.familyScores["timing"]).toBeDefined()
		expect(report.familyScores["operational-artifact"]).toBeDefined()
		expect(report.familyScores["stylometry"]).toBeDefined()
	})

	it("reproduces Low concordance safe-pass on Human test account profile", () => {
		const startAt = Date.now() - 7 * 86400000
		const messages: ReviewMessage[] = []

		const humanPhrases = [
			"hey guys what's up",
			"idk tbh that looks fine to me lol",
			"yeah I was thinking the same thing",
			"heading out for lunch, bbl",
			"wait what happened??",
			"haha nice one",
			"ngl that was pretty wild",
			"can you send me that link again?",
			"cool thanks!",
			"yeah let's check it tonight"
		]

		// 52 messages total, replicating Human user session
		for (let i = 0; i < 52; i++) {
			const createdAt = startAt + i * 115000
			const content = humanPhrases[i % humanPhrases.length]!
			const replyLatencyMs = 8000 + (i % 5) * 4000 // 8s - 24s human latency

			const feat = contentFeatures(content, SECRET_KEY, "g1", "human-958510681928400920")

			messages.push({
				guildId: "g1",
				authorId: "human-958510681928400920",
				messageId: `human-msg-${i}`,
				channelId: "channel-general",
				createdAt,
				replyToId: i % 2 === 0 ? `parent-${i}` : null,
				replyLatencyMs,
				contentLength: feat.contentLength,
				lineCount: feat.lineCount,
				fingerprint: feat.fingerprint,
				artifacts: feat.artifacts
			})
		}

		const report = analyze({
			guildId: "g1",
			authorId: "human-958510681928400920",
			startAt,
			endAt: Date.now(),
			messages
		})

		// Human account must NOT escalate to review-recommended
		expect(report.priority).not.toBe("review-recommended")
		expect(report.concordance).not.toBe("High")
		expect(report.heuristicScore ?? 0).toBeLessThan(50)
		expect(report.familyScores["operational-artifact"]).toBeUndefined()
		expect(report.familyScores["timing"]).toBeUndefined()
	})
})
