import {
	type Client,
	type ListenerEventData,
	MessageCreateListener
} from "@buape/carbon"
import { reviewConfig } from "../config/review.js"
import {
	recordObservation,
	getRecentUserObservations,
	createReviewCase,
	getReviewCase,
	getUserObservationCount
} from "../data/review.js"
import { contentFeatures } from "../review/features.js"
import { analyze } from "../review/analyzer.js"
import { evaluateWithKrill } from "../review/krillEvaluator.js"
import { postReviewEscalationCard } from "../services/reviewNotifier.js"

const getSecretKey = () =>
	process.env.DEPLOY_SECRET || "hermit-review-salt-key-minimum-32-chars-length-padding"

export default class ReviewIngestMessageCreate extends MessageCreateListener {
	async handle(data: ListenerEventData[this["type"]], client: Client) {
		// Strictly enforce the community server guild boundary before ingestion or evaluation
		if (
			!data.guild_id ||
			data.guild_id !== reviewConfig.guildId ||
			!data.channel_id ||
			data.webhook_id
		) {
			return
		}

		// Enforce bounded staff pilot rollout boundary:
		// In pilot mode (default), automatic background message ingestion and evaluation are disabled.
		// Review operations are invoked manually by staff via /review against Discrawl exports.
		if (!reviewConfig.automaticScreeningEnabled) {
			return
		}
		if (
			reviewConfig.pilotChannelIds &&
			!reviewConfig.pilotChannelIds.includes(data.channel_id)
		) {
			return
		}

		if (!data.content && (!data.attachments || data.attachments.length === 0)) {
			return
		}

		const secret = getSecretKey()
		const features = contentFeatures(
			data.content || "",
			secret,
			data.guild_id,
			data.author.id,
			{
				hasMedia: Boolean(data.attachments && data.attachments.length > 0)
			}
		)

		// Get replyToId if message is a reply
		const replyToId = data.message_reference?.message_id || null

		try {
			const isExportBackend = Boolean(
				reviewConfig.discrawlExportPath || reviewConfig.discrawlExportUrl
			)
			if (!isExportBackend) {
				await recordObservation({
					messageId: data.id,
					guildId: data.guild_id,
					channelId: data.channel_id,
					authorId: data.author.id,
					createdAt: data.timestamp || new Date().toISOString(),
					replyToId,
					contentLength: features.contentLength,
					lineCount: features.lineCount,
					fingerprint: features.fingerprint,
					artifacts: JSON.stringify(features.artifacts)
				})
			}

			// Check evaluation eligibility:
			// 1. Immediately if operational/tool markers appear (e.g. tool execution, thought tags)
			// 2. Periodically every 10 messages so pure timing + repetition/stylometry combinations evaluate without tool markers
			const hasCriticalMarker =
				features.artifacts.includes("execution-marker") ||
				features.artifacts.includes("tool-envelope")

			const obsCount = await getUserObservationCount(
				data.guild_id,
				data.author.id,
				reviewConfig.windowDays
			)
			const isPeriodicCheck = obsCount >= 10 && obsCount % 10 === 0

			if (hasCriticalMarker || isPeriodicCheck) {
				const caseId = `case-${data.guild_id}-${data.author.id}`
				const existing = await getReviewCase(caseId)
				const isWatchlistExpired =
					existing?.status === "watchlist" &&
					existing.expiresAt &&
					new Date(existing.expiresAt).getTime() <= Date.now()

				// If already decided (dismissed / confirmed bot) or on active watchlist, skip automated re-escalation
				if (existing && existing.status !== "open" && !isWatchlistExpired) {
					return
				}

				const recent = await getRecentUserObservations(
					data.guild_id,
					data.author.id,
					reviewConfig.windowDays,
					reviewConfig.maxObservationsPerSample
				)

				if (recent.length >= 10) {
					const now = Date.now()
					const windowStart = now - reviewConfig.windowDays * 86400000
					const report = analyze({
						guildId: data.guild_id,
						authorId: data.author.id,
						startAt: windowStart,
						endAt: now,
						messages: recent,
						scoreGate: { minMessages: 10, minSpanMs: 60000 }
					})

					if (report.priority === "review-recommended") {
						// Evaluate with Krill (gpt-6-astra low-thinking)
						const krill = await evaluateWithKrill(report)

						const createdCase = await createReviewCase({
							caseId,
							guildId: data.guild_id,
							targetUserId: data.author.id,
							status: "escalated",
							deliveryStatus: "pending",
							heuristicScore: report.heuristicScore ?? 0,
							concordance: report.concordance,
							behavioralFamilies: JSON.stringify(
								Object.keys(report.familyScores)
							),
							evidenceMessageId: data.id,
							krillProbability: krill
								? `${(krill.automationProbability * 100).toFixed(1)}%`
								: null,
							krillBrief: krill?.brief ?? null,
							krillModel: krill?.model ?? null,
							reviewChannelId: reviewConfig.reviewChannelId
						})

						if (
							createdCase &&
							createdCase.status === "escalated" &&
							createdCase.deliveryStatus === "pending"
						) {
							await postReviewEscalationCard(client, createdCase, report, krill)
						}
					}
				}
			}
		} catch (error) {
			console.error("Error in ReviewIngestMessageCreate:", error)
		}
	}
}
