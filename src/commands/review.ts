import {
	ApplicationCommandOptionType,
	ApplicationIntegrationType,
	Button,
	type CommandInteraction,
	Container,
	InteractionContextType,
	Row,
	Separator,
	TextDisplay
} from "@buape/carbon"
import BaseCommand from "./base.js"
import { reviewConfig } from "../config/review.js"
import {
	createReviewCase,
	getRecentUserObservations,
	getReviewCase
} from "../data/review.js"
import { analyze } from "../review/analyzer.js"
import { evaluateWithKrill } from "../review/krillEvaluator.js"
import {
	ReviewConfirmBotButton,
	ReviewDismissButton,
	ReviewWatchlistButton
} from "../components/reviewButtons.js"

const hasStaffRole = (interaction: CommandInteraction) =>
	interaction.member?.roles.some((role) =>
		(reviewConfig.staffRoleIds as readonly string[]).includes(role.id)
	) ?? false

export default class ReviewCommand extends BaseCommand {
	name = "review"
	description = "Run automation & AI behavioral review on a user"
	defer = true
	ephemeral = true
	contexts = [InteractionContextType.Guild]
	integrationTypes = [ApplicationIntegrationType.GuildInstall]

	options = [
		{
			type: ApplicationCommandOptionType.User as const,
			name: "user",
			description: "The user to evaluate",
			required: true
		},
		{
			type: ApplicationCommandOptionType.Boolean as const,
			name: "krill",
			description:
				"Request deep Krill evaluation using gpt-6-astra low-thinking",
			required: false
		}
	]

	async run(interaction: CommandInteraction) {
		if (!hasStaffRole(interaction)) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### Staff role required"),
							new TextDisplay(
								"You need Community Team or Maintainer role to use this command."
							)
						],
						{ accentColor: "#f85149" }
					)
				],
				ephemeral: true
			})
			return
		}

		const guildId = interaction.guild?.id
		if (!guildId || guildId !== reviewConfig.guildId) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### Invalid server"),
							new TextDisplay(
								"This command is only enabled for the primary community server."
							)
						],
						{ accentColor: "#f85149" }
					)
				],
				ephemeral: true
			})
			return
		}

		const targetUser = interaction.options.getUser("user", true)
		const targetUserId = targetUser.id
		const forceKrill =
			interaction.options.getBoolean("krill", false) ?? false

		const observations = await getRecentUserObservations(
			guildId,
			targetUserId,
			reviewConfig.windowDays,
			reviewConfig.maxObservationsPerSample
		)

		if (observations.length === 0) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### 🦞 Claw & Order | Automation Review"),
							new TextDisplay(`**Target:** <@${targetUserId}>`),
							new TextDisplay(
								`No messages observed for this user in the last ${reviewConfig.windowDays} days.`
							)
						],
						{ accentColor: "#8b949e" }
					)
				],
				ephemeral: true
			})
			return
		}

		const now = Date.now()
		const windowStart = now - reviewConfig.windowDays * 86400000
		const report = analyze({
			guildId,
			authorId: targetUserId,
			startAt: windowStart,
			endAt: now,
			messages: observations,
			scoreGate: { minMessages: 10, minSpanMs: 60000 }
		})

		let krill = null
		if (report.priority === "review-recommended" || forceKrill) {
			krill = await evaluateWithKrill(report)
		}

		const caseId = `case-${guildId}-${targetUserId}`
		let reviewCase = await getReviewCase(caseId)

		const isWatchlistActive =
			reviewCase?.status === "watchlist" &&
			reviewCase.expiresAt &&
			Date.parse(reviewCase.expiresAt) > Date.now()

		let targetStatus: string
		if (
			reviewCase?.status === "dismissed" ||
			reviewCase?.status === "confirmed_bot"
		) {
			targetStatus = reviewCase.status
		} else if (isWatchlistActive) {
			targetStatus = "watchlist"
		} else if (report.priority === "review-recommended") {
			targetStatus = "escalated"
		} else {
			targetStatus = reviewCase?.status || "open"
		}

		if (report.priority === "review-recommended" || forceKrill || reviewCase) {
			reviewCase = await createReviewCase({
				caseId,
				guildId,
				targetUserId,
				status: targetStatus,
				heuristicScore: report.heuristicScore ?? 0,
				concordance: report.concordance,
				behavioralFamilies: JSON.stringify(Object.keys(report.familyScores)),
				evidenceMessageId: observations[0]?.messageId,
				krillProbability: krill
					? `${(krill.automationProbability * 100).toFixed(1)}%`
					: reviewCase?.krillProbability ?? null,
				krillBrief: krill?.brief ?? reviewCase?.krillBrief ?? null,
				krillModel: krill?.model ?? reviewCase?.krillModel ?? null,
				reviewChannelId: reviewConfig.reviewChannelId
			})
		}

		const accentColor =
			report.priority === "review-recommended"
				? "#f85149"
				: report.priority === "some-indicators"
					? "#d29922"
					: "#3fb950"

		const cardSections: (TextDisplay | Separator | Row<Button>)[] = [
			new TextDisplay(`### 🦞 Claw & Order | ${report.priority}`),
			new TextDisplay(
				`**Member ID:** ${targetUserId} (<@${targetUserId}>)\n` +
					`**Sample:** ${report.sample.messages} messages, ${report.sample.channels} channel(s). Span: ${(report.sample.spanMs / 3600000).toFixed(1)}h.\n` +
					`**Heuristic score:** ${report.heuristicScore ?? 0}/100 (not a probability)\n` +
					`**Automation probability:** ${krill ? `${(krill.automationProbability * 100).toFixed(1)}% (Krill model estimate)` : "unavailable (not evaluated)"}\n` +
					`**Signal concordance:** ${report.concordance} (${Object.keys(report.familyScores).length} behavioral families: ${Object.keys(report.familyScores).join(", ") || "none"}).`
			)
		]

		if (krill?.brief) {
			cardSections.push(
				new Separator({ divider: true, spacing: "small" }),
				new TextDisplay(
					`**Krill Assessment (${krill.model}, low-thinking):**\n${krill.brief}\n` +
						`**Recommended Action:** \`${krill.recommendedAction}\` (Disposition: \`${krill.disposition}\`)`
				)
			)
		}

		if (report.signals.length > 0) {
			cardSections.push(new Separator({ divider: true, spacing: "small" }))
			for (const sig of report.signals) {
				cardSections.push(
					new TextDisplay(
						`• **[${sig.family}] ${sig.description}**\n` +
							`_- Alternative:_ ${sig.alternative}`
					)
				)
			}
		}

		if (report.priority === "review-recommended" && reviewCase) {
			cardSections.push(
				new Separator({ divider: true, spacing: "small" }),
				new Row([
					new ReviewDismissButton(reviewCase.caseId),
					new ReviewWatchlistButton(reviewCase.caseId),
					new ReviewConfirmBotButton(reviewCase.caseId)
				])
			)
		}

		await interaction.reply({
			components: [new Container(cardSections, { accentColor })],
			ephemeral: true
		})
	}
}
