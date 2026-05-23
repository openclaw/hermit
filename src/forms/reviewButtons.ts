import {
	Button,
	type ButtonInteraction,
	ButtonStyle,
	type ComponentData,
	Container,
	Label,
	Modal,
	type ModalInteraction,
	Row,
	TextDisplay,
	TextInput,
	TextInputStyle
} from "@buape/carbon"
import { getFormConfig, renderFormText } from "./forms.js"
import type { FormConfig } from "./types.js"
import {
	getFormSubmission,
	parseSubmissionPayload,
	recordFormDecision
} from "./submissions.js"
import type { FormSubmission } from "../db/schema.js"
import { runFormActions } from "./actions.js"

const reasonInputId = "form-review-reason"
const durationInputId = "form-review-duration"

const statusColor = (status: "submitted" | "accepted" | "denied") => {
	if (status === "accepted") {
		return "#7bdc65"
	}
	if (status === "denied") {
		return "#f85149"
	}
	return "#f2c94c"
}

const applicantName = (submission: FormSubmission) =>
	submission.applicantUsername ?? submission.applicantId ?? "Unknown"

const titleFor = (form: FormConfig, submission: FormSubmission) => {
	const payload = parseSubmissionPayload(submission)
	if ((form.id === "discord-ban" || form.id === "discord-mute")) {
		return `${payload.punishment || "Discord"} Appeal sent by @${applicantName(submission)}`
	}
	if (form.id === "github") {
		return `GitHub Ban Appeal sent by @${applicantName(submission)}`
	}
	if (form.id === "reddit") {
		return `Reddit Ban Appeal sent by @${applicantName(submission)}`
	}
	return `${form.title} sent by @${applicantName(submission)}`
}

const detailLinesFor = (form: FormConfig, submission: FormSubmission) => {
	const payload = parseSubmissionPayload(submission)
	if ((form.id === "discord-ban" || form.id === "discord-mute")) {
		return [
			`- **ID:** ${submission.applicantId ?? "Unknown"}`,
			`- **Punishment:** ${payload.punishment || "Unknown"}`,
			`- **Case ID:** ${payload.caseId || "Not provided"}`,
			`- **Reason:** ${payload.banReason || payload.moderationReason || "Not provided"}`,
			`- **Duration:** ${payload.duration || "Not provided"}`,
			`- **Moderator:** ${payload.moderator || "Not provided"}`
		]
	}
	if (form.id === "github") {
		return [
			`- **GitHub user:** @${applicantName(submission)}`,
			`- **GitHub ID:** ${submission.applicantId ?? "Unknown"}`,
			`- **Scope:** ${payload.scope || "Unknown"}`,
			`- **Reason:** ${payload.banReason || "Not provided"}`,
			`- **Links:** ${payload.links || "Not provided"}`
		]
	}
	if (form.id === "reddit") {
		return [
			`- **Reddit user:** ${applicantName(submission)}`,
			`- **Reddit ID:** ${submission.applicantId ?? "Unknown"}`,
			`- **Scope:** ${payload.scope || "Unknown"}`,
			`- **Reason:** ${payload.banReason || "Not provided"}`,
			`- **Links:** ${payload.links || "Not provided"}`
		]
	}
	return [
		`- **Applicant:** @${applicantName(submission)}`,
		`- **Auth:** ${submission.authProvider ?? "none"}`,
		`- **Form ID:** ${form.id}`
	]
}

const answerLinesFor = (form: FormConfig, submission: FormSubmission) => {
	const payload = parseSubmissionPayload(submission)
	return form.fields
		.filter((field) => field.type !== "autofill")
		.filter((field) => {
			if ((form.id === "discord-ban" || form.id === "discord-mute")) {
				return ![
					"caseId",
					"duration",
					"moderationReason",
					"moderator",
					"punishment"
				].includes(field.id)
			}
			if (form.id === "github") {
				return !["scope", "links"].includes(field.id)
			}
			return true
		})
		.map((field) => `**${renderFormText(field.label, payload)}**\n${payload[field.id] || "—"}`)
}

export const buildFormReviewContainer = (
	form: FormConfig,
	submission: FormSubmission,
	options: {
		status?: "submitted" | "accepted" | "denied"
		decidedById?: string | null
		decisionReason?: string | null
		actionResult?: string | null
	} = {}
) => {
	const status = options.status ?? "submitted"
	const submittedAt = submission.createdAt ? Math.floor(new Date(submission.createdAt).getTime() / 1000) : Math.floor(Date.now() / 1000)
	const decidedAt = Math.floor(Date.now() / 1000)
	const footer = status === "submitted"
		? `Submitted • <t:${submittedAt}:f>`
		: [
			`Submitted • <t:${submittedAt}:f>`,
			`${status === "accepted" ? "Accepted" : "Rejected"} by <@${options.decidedById ?? "unknown"}> • <t:${decidedAt}:f>`
		].join("\n")
	const extra = [
		options.decisionReason ? `**Decision reason**\n${options.decisionReason}` : null,
		options.actionResult ? `**Action result**\n${options.actionResult}` : null
	].filter((line): line is string => Boolean(line))
	return new Container(
		[
			new TextDisplay(`## ${titleFor(form, submission)}`),
			new TextDisplay(detailLinesFor(form, submission).join("\n")),
			new TextDisplay([...answerLinesFor(form, submission), ...extra, footer].join("\n\n")),
			...(status === "submitted"
				? [
					new Row([
						new FormReviewAcceptButton(submission.id),
						new FormReviewDenyButton(submission.id)
					])
				]
				: [])
		],
		{ accentColor: statusColor(status) }
	)
}

const resultContainer = (title: string, body: string, color: string) =>
	new Container([new TextDisplay(`### ${title}`), new TextDisplay(body)], {
		accentColor: color
	})

const loadSubmission = async (id: unknown) => {
	if (typeof id !== "number") {
		return { error: "Missing submission id." }
	}
	const submission = await getFormSubmission(id)
	const form = submission ? getFormConfig(submission.formId) : null
	if (!submission || !form) {
		return { error: "Could not load this form submission." }
	}
	if (submission.status === "accepted" || submission.status === "denied") {
		return { error: `This submission is already ${submission.status}.` }
	}
	return { id, submission, form }
}

const notifyApplicant = async (
	interaction: ModalInteraction,
	submission: FormSubmission,
	form: FormConfig,
	status: "accepted" | "denied",
	reason?: string | null
) => {
	if (submission.authProvider !== "discord" || !submission.applicantId) {
		return
	}
	const user = await interaction.client.fetchUser(submission.applicantId).catch(() => null)
	await user?.send({
		components: [
			new Container(
				[
					new TextDisplay(`### ${form.title} ${status === "accepted" ? "Accepted" : "Denied"}`),
					new TextDisplay(reason ? `Reason: ${reason}` : "Your submission has been reviewed.")
				],
				{ accentColor: status === "accepted" ? "#7bdc65" : "#f85149" }
			)
		],
		allowedMentions: { parse: [] }
	}).catch(() => null)
}

const decide = async (
	interaction: ModalInteraction,
	id: unknown,
	status: "accepted" | "denied"
) => {
	const loaded = await loadSubmission(id)
	if ("error" in loaded) {
		await interaction.reply({
			components: [resultContainer("Invalid form submission", loaded.error ?? "Unknown error.", "#f85149")],
			ephemeral: true
		})
		return
	}

	const reason = interaction.fields.getText(reasonInputId, false)?.trim()
	const duration = interaction.fields.getText(durationInputId, false)?.trim()
	let actionResult = duration ? `New duration requested: ${duration}` : "No external action required."
	try {
		actionResult = status === "accepted"
			? await runFormActions(loaded.form, loaded.submission, "accept")
			: await runFormActions(loaded.form, loaded.submission, "deny")
		if (duration) {
			actionResult = `${actionResult}\nNew duration: ${duration}`
		}
	} catch (error) {
		actionResult = error instanceof Error ? error.message : "Unknown action error."
	}

	await recordFormDecision(loaded.id, {
		status,
		decidedById: interaction.user?.id,
		decisionReason: reason || null,
		actionResult
	})

	await notifyApplicant(interaction, loaded.submission, loaded.form, status, reason)

	await interaction.update({
		components: [
			buildFormReviewContainer(loaded.form, loaded.submission, {
				status,
				decidedById: interaction.user?.id,
				decisionReason: reason,
				actionResult
			})
		],
		allowedMentions: { parse: [] }
	})
}

class FormReviewReasonInput extends TextInput {
	customId = reasonInputId
	style = TextInputStyle.Paragraph
	required = false
	maxLength = 1000
	placeholder = "This reason will be displayed to the user"
}

class FormReviewReasonLabel extends Label {
	label = "Reason"

	constructor() {
		super(new FormReviewReasonInput())
	}
}

class FormReviewDurationInput extends TextInput {
	customId = durationInputId
	style = TextInputStyle.Short
	required = false
	maxLength = 100
	placeholder = "New punishment duration (format: \"10d\" or \"1h30min\")"
}

class FormReviewDurationLabel extends Label {
	label = "New duration"

	constructor() {
		super(new FormReviewDurationInput())
	}
}

class FormReviewDecisionModal extends Modal {
	title = "Review appeal"
	customId = "form-review-decision"
	components = [
		new TextDisplay("Record a decision for this submission."),
		new FormReviewReasonLabel()
	]

	constructor(
		private readonly status: "accepted" | "denied" = "accepted",
		id?: number,
		includeDuration = false
	) {
		super()
		this.title = status === "accepted" ? "Accept appeal" : "Reject appeal"
		if (id) {
			this.customId = `form-review-decision:id=${id};status=${status}`
		}
		if (includeDuration) {
			this.components = [...this.components, new FormReviewDurationLabel()]
		}
	}

	async run(interaction: ModalInteraction, data: ComponentData) {
		const status = data.status === "denied" ? "denied" : this.status
		await decide(interaction, data.id, status)
	}
}

export class FormReviewAcceptButton extends Button {
	customId = "form-review-accept"
	label = "Accept"
	style = ButtonStyle.Success
	ephemeral = true

	constructor(id?: number) {
		super()
		if (id) {
			this.customId = `form-review-accept:id=${id}`
		}
	}

	async run(interaction: ButtonInteraction, data: Record<string, unknown>) {
		const loaded = await loadSubmission(data.id)
		if ("error" in loaded) {
			await interaction.reply({
				components: [resultContainer("Invalid form submission", loaded.error ?? "Unknown error.", "#f85149")]
			})
			return
		}
		await interaction.showModal(new FormReviewDecisionModal("accepted", loaded.id))
	}
}

export class FormReviewDenyButton extends Button {
	customId = "form-review-deny"
	label = "Deny"
	style = ButtonStyle.Danger
	ephemeral = true

	constructor(id?: number) {
		super()
		if (id) {
			this.customId = `form-review-deny:id=${id}`
		}
	}

	async run(interaction: ButtonInteraction, data: Record<string, unknown>) {
		const loaded = await loadSubmission(data.id)
		if ("error" in loaded) {
			await interaction.reply({
				components: [resultContainer("Invalid form submission", loaded.error ?? "Unknown error.", "#f85149")]
			})
			return
		}
		await interaction.showModal(new FormReviewDecisionModal("denied", loaded.id))
	}
}

export const formReviewComponents = [
	new FormReviewAcceptButton(),
	new FormReviewDenyButton()
]

export const formReviewModals = [new FormReviewDecisionModal()]
