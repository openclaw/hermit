import {
	Button,
	type ButtonInteraction,
	ButtonStyle,
	type ComponentData,
	Container,
	Row,
	Separator,
	TextDisplay
} from "@buape/carbon"
import { reviewConfig } from "../config/review.js"
import {
	markReviewCardStaleWrite,
	markReviewCardSynced,
	recordReviewCaseDecision
} from "../data/review.js"
import type { ReviewCase } from "../db/schema.js"
import type { AnalysisReport, KrillEvaluation } from "../review/types.js"

const hasStaffRole = (interaction: ButtonInteraction) =>
	interaction.member?.roles.some((role) =>
		(reviewConfig.staffRoleIds as readonly string[]).includes(role.id)
	) ?? false

export const buildReviewCardContainer = (
	reviewCase: ReviewCase,
	report?: AnalysisReport | null,
	krill?: KrillEvaluation | null,
	closed = false
) => {
	const accentColor =
		reviewCase.status === "confirmed_bot"
			? "#f85149"
			: reviewCase.status === "dismissed"
				? "#3fb950"
				: reviewCase.status === "watchlist"
					? "#f1c40f"
					: "#d29922"

	const statusText =
		reviewCase.status === "watchlist" && reviewCase.expiresAt
			? `WATCHLIST (expires <t:${Math.floor(new Date(reviewCase.expiresAt).getTime() / 1000)}:R>)`
			: reviewCase.status.toUpperCase()

	const lines: (TextDisplay | Separator | Row<Button>)[] = [
		new TextDisplay("### 🦞 Claw & Order | Automation Review"),
		new TextDisplay(
			`**Target Account:** <@${reviewCase.targetUserId}>\n**Status:** ${statusText}`
		),
		new Separator({ divider: true, spacing: "small" }),
		new TextDisplay(
			`**Heuristic Score:** ${reviewCase.heuristicScore}/100\n` +
				`**Signal Concordance:** ${reviewCase.concordance} (${reviewCase.behavioralFamilies})\n` +
				`**Krill Assessment Probability (Model Estimate):** ${reviewCase.krillProbability || "Not evaluated"}\n` +
				`**Model:** ${reviewCase.krillModel || "N/A"}`
		)
	]

	if (reviewCase.krillBrief) {
		lines.push(
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(`**Krill Assessment Brief**\n${reviewCase.krillBrief}`)
		)
	}

	if (report && report.signals.length > 0) {
		lines.push(
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(
				`**Key Detected Signals:**\n` +
					report.signals
						.slice(0, 3)
						.map((s) => `• **${s.code}** (${s.family}): ${s.description}`)
						.join("\n")
			)
		)
	}

	if (reviewCase.decidedById) {
		lines.push(
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(
				`-# Decision by <@${reviewCase.decidedById}>: ${reviewCase.decisionReason || "No reason given"}`
			)
		)
	}

	if (!closed && reviewCase.status === "escalated") {
		lines.push(
			new Separator({ divider: true, spacing: "small" }),
			new Row([
				new ReviewDismissButton(reviewCase.caseId),
				new ReviewWatchlistButton(reviewCase.caseId),
				new ReviewConfirmBotButton(reviewCase.caseId)
			])
		)
	}

	// This identity survives removal of all decision buttons.
	lines.push(new TextDisplay(`-# hermit-review:v1:${reviewCase.caseId}`))
	return new Container(lines, { accentColor })
}

const buildPermissionDeniedContainer = () =>
	new Container(
		[
			new TextDisplay("### Permission required"),
			new TextDisplay("Community Team or Maintainer role required.")
		],
		{ accentColor: "#f85149" }
	)

const finishReviewDecision = async (
	interaction: ButtonInteraction,
	updated: ReviewCase
): Promise<void> => {
	const targetsSharedCard = Boolean(updated.reviewMessageId) &&
		interaction.message?.id === updated.reviewMessageId
	let needsSharedSync = true
	const persistenceErrors: unknown[] = []
	try {
		await interaction.update({
			components: [buildReviewCardContainer(updated, null, null, true)],
			allowedMentions: { parse: [] }
		})
		if (targetsSharedCard) {
			const synced = await markReviewCardSynced(updated.caseId, updated.cardRevision)
			needsSharedSync = !synced
			if (!synced) await markReviewCardStaleWrite(updated.caseId, updated.cardRevision)
		}
	} catch (error) {
		console.warn("Failed to update review decision interaction:", error)
		if (targetsSharedCard) {
			try {
				await markReviewCardStaleWrite(updated.caseId, updated.cardRevision)
			} catch (persistenceError) {
				persistenceErrors.push(persistenceError)
			}
		}
	}

	// An ephemeral success is not a shared-card acknowledgment, and an
	// ephemeral failure must not prevent attempting the shared-card repair.
	if (needsSharedSync) {
		try {
			const { syncSharedReviewCard } = await import("../services/reviewNotifier.js")
			await syncSharedReviewCard(interaction.client, updated)
		} catch (error) {
			persistenceErrors.push(error)
		}
	}
	if (persistenceErrors.length > 0) {
		throw new AggregateError(persistenceErrors, "Failed to persist review card repair work")
	}
}

export class ReviewDismissButton extends Button {
	customId = "review-dismiss"
	label = "Dismiss (Human)"
	style = ButtonStyle.Secondary
	ephemeral = true
	defer = false

	constructor(caseId?: string) {
		super()
		if (caseId) {
			this.customId = `review-dismiss:caseId=${caseId}`
		}
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		if (!hasStaffRole(interaction)) {
			await interaction.reply({
				components: [buildPermissionDeniedContainer()],
				ephemeral: true
			})
			return
		}

		const caseId = typeof data?.caseId === "string" ? data.caseId : undefined
		if (!caseId) return

		const updated = await recordReviewCaseDecision(caseId, {
			status: "dismissed",
			expiresAt: null,
			decidedById: interaction.user?.id || interaction.userId,
			decisionReason: "Marked as human / dismissed by staff."
		})

		if (updated) await finishReviewDecision(interaction, updated)
	}
}

export class ReviewWatchlistButton extends Button {
	customId = "review-watchlist"
	label = "Watchlist (7d)"
	style = ButtonStyle.Primary
	ephemeral = true
	defer = false

	constructor(caseId?: string) {
		super()
		if (caseId) {
			this.customId = `review-watchlist:caseId=${caseId}`
		}
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		if (!hasStaffRole(interaction)) {
			await interaction.reply({
				components: [buildPermissionDeniedContainer()],
				ephemeral: true
			})
			return
		}

		const caseId = typeof data?.caseId === "string" ? data.caseId : undefined
		if (!caseId) return

		const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
		const updated = await recordReviewCaseDecision(caseId, {
			status: "watchlist",
			expiresAt,
			decidedById: interaction.user?.id || interaction.userId,
			decisionReason: "Added to watchlist for 7 days."
		})

		if (updated) await finishReviewDecision(interaction, updated)
	}
}

export class ReviewConfirmBotButton extends Button {
	customId = "review-confirm-bot"
	label = "Confirm Bot"
	style = ButtonStyle.Danger
	ephemeral = true
	defer = false

	constructor(caseId?: string) {
		super()
		if (caseId) {
			this.customId = `review-confirm-bot:caseId=${caseId}`
		}
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		if (!hasStaffRole(interaction)) {
			await interaction.reply({
				components: [buildPermissionDeniedContainer()],
				ephemeral: true
			})
			return
		}

		const caseId = typeof data?.caseId === "string" ? data.caseId : undefined
		if (!caseId) return

		const updated = await recordReviewCaseDecision(caseId, {
			status: "confirmed_bot",
			expiresAt: null,
			decidedById: interaction.user?.id || interaction.userId,
			decisionReason: "Confirmed automated agent account."
		})

		if (updated) await finishReviewDecision(interaction, updated)
	}
}

export const reviewComponents = [
	new ReviewDismissButton(),
	new ReviewWatchlistButton(),
	new ReviewConfirmBotButton()
]
