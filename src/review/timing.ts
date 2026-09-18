import type { ReviewMessage, Signal } from "./types.js"

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2
		? sorted[middle]!
		: (sorted[middle - 1]! + sorted[middle]!) / 2
}

const parseTimestamp = (value: string | number): number =>
	typeof value === "string" ? new Date(value).getTime() : value

export function timingSignals(rawRows: ReviewMessage[]): Signal[] {
	// Normalize timestamps
	const rows = rawRows.map((r) => ({
		...r,
		createdAtNum: parseTimestamp(r.createdAt)
	}))

	const seen = new Set<string>()
	const replies = rows.filter((r) => {
		if (
			!r.replyToId ||
			r.replyLatencyMs === null ||
			!Number.isFinite(r.replyLatencyMs) ||
			r.replyLatencyMs < 200 ||
			r.replyLatencyMs > 120000 ||
			seen.has(r.replyToId)
		) {
			return false
		}
		seen.add(r.replyToId)
		return true
	})

	const signals: Signal[] = []

	// 1. Reply Cadence
	if (replies.length >= 10) {
		const middle = median(replies.map((r) => r.replyLatencyMs!))
		const regular = replies.filter(
			(r) => Math.abs(r.replyLatencyMs! - middle) <= Math.max(200, middle * 0.15)
		)
		const span = regular.length
			? regular[regular.length - 1]!.createdAtNum - regular[0]!.createdAtNum
			: 0
		if (
			regular.length >= 10 &&
			regular.length / replies.length >= 0.8 &&
			span >= 20 * 60000
		) {
			signals.push({
				code: "reply-cadence",
				family: "timing",
				points: 30,
				description: `${regular.length}/${replies.length} distinct observed replies cluster around ${(middle / 1000).toFixed(1)} seconds.`,
				messageIds: regular.slice(0, 6).map((r) => r.messageId),
				metrics: {
					distinctReplies: replies.length,
					regularReplies: regular.length,
					medianLatencyMs: middle,
					medianAbsoluteDeviationMs: median(
						replies.map((r) => Math.abs(r.replyLatencyMs! - middle))
					)
				},
				alternative:
					"Active monitoring, human routines, and measurement artifacts can produce consistent response timing."
			})
		}
	}

	// 2. Cross-Channel Bursts
	const substantial = replies.filter(
		(r) => (r.contentLength ?? 0) >= 240 && r.fingerprint
	)
	const episodes: typeof rows[] = []
	let lastEpisode = -Infinity
	for (let i = 0; i < substantial.length; i++) {
		const first = substantial[i]!
		if (first.createdAtNum - lastEpisode < 5 * 60000) continue
		const chosen: typeof rows = []
		const channels = new Set<string>()
		const texts = new Set<string>()
		for (
			let j = i;
			j < Math.min(substantial.length, i + 64) &&
			substantial[j]!.createdAtNum - first.createdAtNum <= 15000;
			j++
		) {
			const row = substantial[j]!
			if (!channels.has(row.channelId) && !texts.has(row.fingerprint)) {
				channels.add(row.channelId)
				texts.add(row.fingerprint)
				chosen.push(row)
			}
			if (chosen.length === 3) break
		}
		if (chosen.length === 3) {
			episodes.push(chosen)
			lastEpisode = first.createdAtNum
		}
	}
	if (episodes.length >= 3) {
		signals.push({
			code: "cross-channel-bursts",
			family: "timing",
			points: 35,
			description: `${episodes.length} separate bursts contain three different substantial replies across three channels within 15 seconds.`,
			messageIds: episodes.slice(0, 3).flatMap((e) => e.map((r) => r.messageId)),
			metrics: {
				episodes: episodes.length,
				minimumChannels: 3,
				maximumBurstMs: 15000,
				minimumSeparationMs: 300000
			},
			alternative:
				"A person can prepare, paste, or dispatch several answers. This measures posting patterns, not how long composition took."
		})
	}

	// 3. Rapid Response Speed (superhuman speed, chars/sec or rapid burst)
	const rapid: { message: ReviewMessage; latencyMs: number; speed: number }[] = []
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i]!
		const len = r.contentLength ?? 0
		if (len < 160) continue
		if (r.replyLatencyMs !== null && r.replyLatencyMs <= 120000) {
			const speed = len / (r.replyLatencyMs / 1000)
			if (speed >= 40 || (r.replyLatencyMs <= 2500 && len >= 200)) {
				rapid.push({ message: r, latencyMs: r.replyLatencyMs, speed })
				continue
			}
		}
		if (i > 0) {
			const prev = rows[i - 1]!
			if (prev.channelId === r.channelId && prev.authorId === r.authorId) {
				const gapMs = r.createdAtNum - prev.createdAtNum
				if (gapMs >= 50 && gapMs <= 3000) {
					const speed = len / (gapMs / 1000)
					if (speed >= 40 || (gapMs <= 2000 && len >= 200)) {
						rapid.push({ message: r, latencyMs: gapMs, speed })
					}
				}
			}
		}
	}
	if (rapid.length >= 4) {
		const speeds = rapid.map((r) => Math.round(r.speed))
		const medianSpeed = median(speeds)
		const fastestLatency = Math.min(...rapid.map((r) => r.latencyMs))
		signals.push({
			code: "rapid-response-speed",
			family: "timing",
			points: 30,
			description: `${rapid.length} substantial messages arrived faster than human composition speed (median ${medianSpeed} chars/sec; fastest interval ${(fastestLatency / 1000).toFixed(1)}s).`,
			messageIds: rapid.slice(0, 6).map((r) => r.message.messageId),
			metrics: {
				rapidReplies: rapid.length,
				medianSpeedCharsPerSec: medianSpeed,
				fastestLatencyMs: fastestLatency
			},
			alternative:
				"Pre-written answers, clipboard macros, or automated response streaming can produce near-instant posting times."
		})
	}

	// 4. Circadian Cadence
	const allReplies = rows.filter((r) => r.replyToId !== null)
	if (allReplies.length >= 16) {
		const spanMs =
			allReplies[allReplies.length - 1]!.createdAtNum -
			allReplies[0]!.createdAtNum
		if (spanMs >= 36 * 3600000) {
			let maxGapMs = 0
			for (let i = 1; i < allReplies.length; i++) {
				const gap =
					allReplies[i]!.createdAtNum - allReplies[i - 1]!.createdAtNum
				if (gap > maxGapMs) maxGapMs = gap
			}
			const activeHours = new Set(
				allReplies.map((r) => new Date(r.createdAtNum).getUTCHours())
			).size
			if (activeHours >= 20 && maxGapMs < 4 * 3600000) {
				signals.push({
					code: "unbroken-circadian",
					family: "timing",
					points: 30,
					description: `Observed replies spanned ${activeHours}/24 daily hours over ${(spanMs / 86400000).toFixed(1)} days without a human sleep interval (maximum gap: ${(maxGapMs / 3600000).toFixed(1)} hours).`,
					messageIds: allReplies.slice(0, 6).map((r) => r.messageId),
					metrics: {
						activeHours,
						maxGapHours: Math.round((maxGapMs / 3600000) * 10) / 10,
						spanDays: Math.round((spanMs / 86400000) * 10) / 10,
						distinctReplies: allReplies.length
					},
					alternative:
						"Shared accounts, round-the-clock shift handoffs, or severe insomnia can produce unbroken diurnal activity."
				})
			}
		}
	}

	return signals
}
