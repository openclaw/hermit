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
import { nominationConfig } from "../config/nominations.js"
import {
	getNomination,
	getNominationApproverIds,
	markNominationApproved,
	recordNominationApproval
} from "../data/nominations.js"
import type { Nomination } from "../db/schema.js"
import { getRuntimeEnv } from "../runtime/env.js"

const discordApiBase = "https://discord.com/api/v10"

const parseNominationId = (id: unknown) => {
	if (typeof id === "number" && Number.isInteger(id)) {
		return id
	}
	if (typeof id === "string" && /^\d+$/.test(id)) {
		return Number(id)
	}
	return null
}

const hasApproverRole = (interaction: ButtonInteraction) =>
	interaction.member?.roles.some((role) =>
		nominationConfig.approverRoleIds.includes(role.id)
	) ?? false

export const buildNominationNoticeContainer = (
	body: string,
	accentColor = "#f1c40f"
) => new Container([new TextDisplay(body)], { accentColor })

const addTargetRole = async (nomination: Nomination) => {
	const roleResponse = await fetch(
		`${discordApiBase}/guilds/${nomination.guildId}/members/${nomination.nomineeId}/roles/${nomination.targetRoleId}`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bot ${getRuntimeEnv().DISCORD_BOT_TOKEN}`
			}
		}
	)

	return roleResponse.ok || roleResponse.status === 204
}

export const buildNominationContainer = (
	nomination: Nomination,
	approverIds: string[]
) => {
	const approved = nomination.status === "approved"
	const body = approved
		? `<@${nomination.nomineeId}> welcome to the Shell Society!
This is a private section of the server that is high signal, low noise, for the valued members of the server to gather together without the chaotic madness that is <#1456350065223270435>.

Just remember, this is not a channel to share your PRs, etc; it’s only a social channel so please treat it as such and above all else, enjoy! 🐚🦞`
		: `<@${nomination.nomineeId}> has been nominated by <@${nomination.nominatorId}> for ${nomination.reason}.`

	return new Container(
		[
			new TextDisplay(`### ${nominationConfig.copy.title}`),
			new TextDisplay(body),
			new TextDisplay(`Approvals: ${Math.min(approverIds.length, nomination.requiredApprovals)}/${nomination.requiredApprovals}`),
			new Separator({ divider: true, spacing: "small" }),
			new Row([new NominationApproveButton(nomination.id, approved)])
		],
		{ accentColor: approved ? "#3fb950" : "#f1c40f" }
	)
}

export class NominationApproveButton extends Button {
	customId = "nomination-approve"
	label = nominationConfig.copy.buttonLabel
	style = ButtonStyle.Success
	ephemeral = true
	defer = true
	disabled = false

	constructor(id?: number, disabled = false) {
		super()
		if (typeof id === "number") {
			this.customId = `nomination-approve:id=${id}`
		}
		this.disabled = disabled
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const id = parseNominationId(data.id)
		if (!id) {
			await interaction.reply({
				components: [
					buildNominationNoticeContainer(
						nominationConfig.copy.invalidNomination,
						"#f85149"
					)
				],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		const nomination = await getNomination(id)
		if (!nomination) {
			await interaction.reply({
				components: [
					buildNominationNoticeContainer(
						nominationConfig.copy.invalidNomination,
						"#f85149"
					)
				],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		if (nomination.status === "approved") {
			await interaction.reply({
				components: [
					buildNominationNoticeContainer(nominationConfig.copy.alreadyComplete)
				],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		if (!hasApproverRole(interaction)) {
			await interaction.reply({
				components: [
					buildNominationNoticeContainer(
						nominationConfig.copy.noPermission,
						"#f85149"
					)
				],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		const approverId = interaction.user?.id ?? interaction.userId
		if (!approverId) {
			await interaction.reply({
				components: [
					buildNominationNoticeContainer(
						nominationConfig.copy.invalidNomination,
						"#f85149"
					)
				],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		const recorded = await recordNominationApproval(nomination.id, approverId)
		const approverIds = await getNominationApproverIds(nomination.id)
		if (!recorded && approverIds.length < nomination.requiredApprovals) {
			await interaction.reply({
				components: [
					buildNominationNoticeContainer(nominationConfig.copy.alreadyApproved)
				],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		if (approverIds.length < nomination.requiredApprovals) {
			await interaction.message?.edit({
				components: [buildNominationContainer(nomination, approverIds)],
				allowedMentions: { parse: [] }
			}).catch(() => null)
			await interaction.reply({
				components: [
					buildNominationNoticeContainer(
						`${nominationConfig.copy.approvalRecorded} ${approverIds.length}/${nomination.requiredApprovals}.`,
						"#3fb950"
					)
				],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		if (!(await addTargetRole(nomination))) {
			await interaction.message?.edit({
				components: [buildNominationContainer(nomination, approverIds)],
				allowedMentions: { parse: [] }
			}).catch(() => null)
			await interaction.reply({
				components: [
					buildNominationNoticeContainer(
						nominationConfig.copy.roleAddFailed,
						"#f85149"
					)
				],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		const approvedNomination = await markNominationApproved(nomination.id)
		if (!approvedNomination) {
			await interaction.reply({
				components: [
					buildNominationNoticeContainer(nominationConfig.copy.alreadyComplete)
				],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}

		await interaction.message?.edit({
			components: [buildNominationContainer(approvedNomination, approverIds)],
			allowedMentions: { parse: [] }
		}).catch(() => null)
		await interaction.reply({
			components: [
				buildNominationNoticeContainer(
					nominationConfig.copy.approvalRecorded,
					"#3fb950"
				)
			],
			ephemeral: true,
			allowedMentions: { parse: [] }
		})
	}
}

export const nominationComponents = [
	new NominationApproveButton()
]
