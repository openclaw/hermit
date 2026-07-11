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
import type {
	NominationVoteChoice,
	NominationVoteTotals
} from "../data/nominations.js"
import type { Nomination } from "../db/schema.js"

const statusCopy = (nomination: Nomination) => {
	switch (nomination.status) {
		case "granting":
			return "**Status:** Role grant pending"
		case "approved":
			return "**Status:** Approved\nShell Society role granted."
		case "declined":
			return "**Status:** Declined"
		case "expired":
			return "**Status:** Expired"
		default:
			return "**Status:** Open"
	}
}

const statusColor = (nomination: Nomination) => {
	switch (nomination.status) {
		case "approved":
			return "#3fb950"
		case "declined":
			return "#f85149"
		case "expired":
			return "#8b949e"
		case "granting":
			return "#58a6ff"
		default:
			return "#f1c40f"
	}
}

export const buildNominationNoticeContainer = (
	body: string,
	accentColor = "#f1c40f"
) => new Container([new TextDisplay(body)], { accentColor })

export const buildNominationContainer = (
	nomination: Nomination,
	totals: NominationVoteTotals
) => {
	const votingClosed = nomination.status !== "submitted"

	return new Container(
		[
			new TextDisplay(`### ${nominationConfig.copy.title}`),
			new TextDisplay(
				`**Nominee:** <@${nomination.nomineeId}>\n**Nominator:** <@${nomination.nominatorId}>`
			),
			new TextDisplay(`**Reason**\n${nomination.reason}`),
			new Separator({ divider: true, spacing: "small" }),
			new TextDisplay(
				`👍 Approvals: ${Math.min(totals.approvals, nomination.requiredApprovals)}/${nomination.requiredApprovals}\n👎 Declines: ${Math.min(totals.declines, nomination.requiredApprovals)}/${nomination.requiredApprovals}`
			),
			new TextDisplay(statusCopy(nomination)),
			new Separator({ divider: true, spacing: "small" }),
			new Row([
				new NominationApproveButton(nomination.id, votingClosed),
				new NominationDeclineButton(nomination.id, votingClosed)
			])
		],
		{ accentColor: statusColor(nomination) }
	)
}

abstract class NominationVoteButton extends Button {
	abstract choice: NominationVoteChoice
	ephemeral = true
	defer = true
	disabled = false

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const { handleNominationVote } = await import(
			"../services/nominationVoting.js"
		)
		await handleNominationVote(interaction, data, this.choice)
	}
}

export class NominationApproveButton extends NominationVoteButton {
	customId = "nomination-approve"
	label = nominationConfig.copy.approveButtonLabel
	emoji = { name: "👍" }
	style = ButtonStyle.Success
	choice = "approve" as const

	constructor(id?: number, disabled = false) {
		super()
		if (typeof id === "number") {
			this.customId = `nomination-approve:id=${id}`
		}
		this.disabled = disabled
	}
}

export class NominationDeclineButton extends NominationVoteButton {
	customId = "nomination-decline"
	label = nominationConfig.copy.declineButtonLabel
	emoji = { name: "👎" }
	style = ButtonStyle.Danger
	choice = "decline" as const

	constructor(id?: number, disabled = false) {
		super()
		if (typeof id === "number") {
			this.customId = `nomination-decline:id=${id}`
		}
		this.disabled = disabled
	}
}

export const nominationComponents = [
	new NominationApproveButton(),
	new NominationDeclineButton()
]
