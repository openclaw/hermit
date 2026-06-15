import {
	Button,
	type ButtonInteraction,
	ButtonStyle,
	type ComponentData,
	ComponentType,
	Container,
	Label,
	Modal,
	type ModalInteraction,
	Row,
	Section,
	Separator,
	TextDisplay,
	TextInput,
	TextInputStyle
} from "@buape/carbon"
import { getFormConfig, renderFormText } from "./forms.js"
import type { FormConfig } from "./types.js"
import {
	getFormSubmission,
	parseSubmissionPayload,
	recordFormDecision,
	recordFormLock,
	recordFormUnlock
} from "./submissions.js"
import type { FormSubmission } from "../db/schema.js"
import { runFormActions } from "./actions.js"

const reasonInputId = "form-review-reason"
const durationInputId = "form-review-duration"
const reviewUnlockUserId = "439223656200273932"

type FormReviewStatus = "submitted" | "locked" | "accepted" | "denied"

const statusColor = (status: FormReviewStatus) => {
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
	if (form.id === "clawhub") {
		return `ClawHub Ban Appeal sent by @${applicantName(submission)}`
	}
	if (form.id === "clawhub-content-rights") {
		const payload = parseSubmissionPayload(submission)
		return `ClawHub Content Rights Request - ${payload.organization || payload.requesterName || "Unknown"}`
	}
	if (form.id === "reddit") {
		return `Reddit Ban Appeal sent by @${applicantName(submission)}`
	}
	return `${form.title} sent by @${applicantName(submission)}`
}

const dateTimestamp = (value?: string) => {
	const match = value?.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/)
	if (!match) {
		return null
	}
	const date = new Date(match[0].replace(/\.(\d{3})\d+/, ".$1"))
	return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000)
}

const formatDuration = (value?: string) => {
	if (!value) {
		return "Not provided"
	}
	const timestamp = dateTimestamp(value)
	if (!timestamp) {
		return value
	}
	return `${value.trim().toLowerCase().startsWith("until") ? "Until " : ""}<t:${timestamp}:f> (<t:${timestamp}:R>)`
}

const detailField = (label: string, value?: string | null) => `**${label}:** ${value || "Not provided"}`

const detailComponentsFor = (form: FormConfig, submission: FormSubmission) => {
	const payload = parseSubmissionPayload(submission)
	if ((form.id === "discord-ban" || form.id === "discord-mute")) {
		return [
			new Section(
				[new TextDisplay(detailField("ID", submission.applicantId ?? "Unknown"))],
				new FormReviewCopyButton(submission.id, "applicantId", "Copy ID")
			),
			new Section(
				[new TextDisplay(detailField("Case ID", payload.caseId))],
				new FormReviewCopyButton(submission.id, "caseId", "Copy Case ID")
			),
			new TextDisplay([
				...(payload.timestamp ? [detailField("Timestamp", payload.timestamp)] : []),
				detailField("Reason", payload.banReason || payload.moderationReason),
				detailField("Duration", formatDuration(payload.duration)),
				detailField("Moderator", payload.moderator)
			].join("\n"))
		]
	}
	if (form.id === "github") {
		return [new TextDisplay([
			detailField("GitHub user", `@${applicantName(submission)}`),
			detailField("GitHub ID", submission.applicantId ?? "Unknown"),
			detailField("Scope", payload.scope || "Unknown"),
			detailField("Reason", payload.banReason),
			detailField("Moderator", payload.moderator),
			detailField("Timestamp", payload.timestamp),
			detailField("Links", payload.links)
		].join("\n"))]
	}
	if (form.id === "clawhub") {
		return [new TextDisplay([
			detailField("GitHub user", `@${applicantName(submission)}`),
			detailField("GitHub ID", submission.applicantId ?? "Unknown"),
			detailField("ClawHub user", payload.clawhubHandle || payload.account),
			detailField("ClawHub ID", payload.clawhubUserId),
			detailField("Scope", payload.scope || "Unknown"),
			detailField("Reason", payload.banReason),
			detailField("Date", payload.date),
			detailField("Audit action", payload.auditAction),
			detailField("Audit actor", payload.auditActorUserId),
			detailField("Links", payload.links)
		].join("\n"))]
	}
	if (form.id === "clawhub-content-rights") {
		return [
			new Section(
				[new TextDisplay(detailField("Case ID", payload.caseId))],
				new FormReviewCopyButton(submission.id, "caseId", "Copy Case ID")
			),
			new TextDisplay([
				detailField("Requester", payload.requesterName),
				detailField("Organization", payload.organization),
				detailField("Email", payload.email),
				detailField("ClawHub URLs", payload.clawhubUrls)
			].join("\n"))
		]
	}
	if (form.id === "reddit") {
		return [new TextDisplay([
			detailField("Reddit user", applicantName(submission)),
			detailField("Reddit ID", submission.applicantId ?? "Unknown"),
			detailField("Scope", payload.scope || "Unknown"),
			detailField("Reason", payload.banReason),
			detailField("Links", payload.links)
		].join("\n"))]
	}
	return [new TextDisplay([
		detailField("Applicant", `@${applicantName(submission)}`),
		detailField("Auth", submission.authProvider ?? "none"),
		detailField("Form ID", form.id)
	].join("\n"))]
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
			if (form.id === "clawhub") {
				return !["scope", "links", "auditAction", "auditActorUserId", "clawhubUserId", "clawhubHandle", "date"].includes(field.id)
			}
			if (form.id === "clawhub-content-rights") {
				return !["requesterName", "organization", "email", "clawhubUrls"].includes(field.id)
			}
			return true
		})
		.map((field) => `**${renderFormText(field.label, payload)}**\n${payload[field.id] || "—"}`)
}

const reviewHistoryLine = (action: "Locked" | "Unlocked", userId?: string) =>
	`${action} by <@${userId ?? "unknown"}> • <t:${Math.floor(Date.now() / 1000)}:f>`

const historyLinesFrom = (components: unknown) => {
	const lines: string[] = []
	const read = (items: unknown) => {
		if (!Array.isArray(items)) {
			return
		}
		for (const component of items) {
			if (!component || typeof component !== "object") {
				continue
			}
			const item = component as { type?: unknown; content?: unknown; components?: unknown }
			if (item.type === ComponentType.TextDisplay && typeof item.content === "string") {
				lines.push(
					...item.content
						.replace(/^-#\s*/, "")
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => /^(Locked|Unlocked) by <@(?:\d+|unknown)> • <t:\d+:f>$/.test(line))
				)
			}
			read(item.components)
		}
	}
	read(components)
	return lines
}

export const buildFormReviewContainer = (
	form: FormConfig,
	submission: FormSubmission,
	options: {
		status?: FormReviewStatus
		decidedById?: string | null
		decisionReason?: string | null
		actionResult?: string | null
		historyLines?: string[]
	} = {}
) => {
	const status = options.status ?? "submitted"
	const submittedAt = submission.createdAt ? Math.floor(new Date(submission.createdAt).getTime() / 1000) : Math.floor(Date.now() / 1000)
	const decidedAt = Math.floor(Date.now() / 1000)
	const footer = [
		`Submitted • <t:${submittedAt}:f>`,
		...(options.historyLines ?? []),
		...(status === "accepted" || status === "denied"
			? [`${status === "accepted" ? "Accepted" : "Rejected"} by <@${options.decidedById ?? "unknown"}> • <t:${decidedAt}:f>`]
			: [])
	].join("\n")
	const extra = [
		options.decisionReason ? `**Decision reason**\n${options.decisionReason}` : null,
		options.actionResult ? `**Action result**\n${options.actionResult}` : null
	].filter((line): line is string => Boolean(line))
	return new Container(
		[
			...(form.reviewRoleId ? [new TextDisplay(`-# <@&${form.reviewRoleId}>`)] : []),
			new TextDisplay(`## ${titleFor(form, submission)}`),
			...detailComponentsFor(form, submission),
			new Separator({ divider: true, spacing: "small" }),
			...answerLinesFor(form, submission).map((line) => new TextDisplay(line)),
			...extra.map((line) => new TextDisplay(line)),
			new Separator({ divider: false, spacing: "small" }),
			new TextDisplay(`-# ${footer}`),
			...(status === "submitted" || status === "locked"
				? [
					...(status === "locked" ? [new TextDisplay("Locked until further discussion.")] : []),
					new Row([
						new FormReviewAcceptButton(submission.id, status === "locked"),
						new FormReviewDenyButton(submission.id, status === "locked"),
						status === "locked"
							? new FormReviewUnlockButton(submission.id)
							: new FormReviewLockButton(submission.id)
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

const canReview = (interaction: ButtonInteraction | ModalInteraction, form: FormConfig) =>
	!form.reviewRoleId || (interaction.member?.roles.some((role) => role.id === form.reviewRoleId) ?? false)

const requireReviewRole = async (interaction: ButtonInteraction | ModalInteraction, form: FormConfig) => {
	if (canReview(interaction, form)) {
		return true
	}
	await interaction.reply({
		components: [resultContainer("Review role required", `You need <@&${form.reviewRoleId}> to review this submission.`, "#f85149")],
		ephemeral: true,
		allowedMentions: { parse: [] }
	})
	return false
}

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
	if (submission.status === "locked") {
		return { error: "This submission is locked until further discussion." }
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

	if (!(await requireReviewRole(interaction, loaded.form))) {
		return
	}

	const reason = interaction.fields.getText(reasonInputId, false)?.trim()
	const duration = interaction.fields.getText(durationInputId, false)?.trim()
	let actionResult = duration ? `New duration requested: ${duration}` : "No external action required."
	try {
		actionResult = status === "accepted"
			? await runFormActions(loaded.form, loaded.submission, "accept", { reviewerDiscordId: interaction.user?.id })
			: await runFormActions(loaded.form, loaded.submission, "deny", { reviewerDiscordId: interaction.user?.id })
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
				actionResult,
				historyLines: historyLinesFrom(interaction.message?.rawData.components)
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

class FormReviewCopyButton extends Button {
	customId = "form-review-copy"
	label = "Copy"
	style = ButtonStyle.Secondary
	ephemeral = true

	constructor(id?: number, field = "applicantId", label = "Copy") {
		super()
		this.label = label
		if (id) {
			this.customId = `form-review-copy:id=${id};field=${field}`
		}
	}

	async run(interaction: ButtonInteraction, data: Record<string, unknown>) {
		if (typeof data.id !== "number") {
			await interaction.reply({
				components: [resultContainer("Missing value", "This copy button is missing submission data.", "#f85149")]
			})
			return
		}
		const submission = await getFormSubmission(data.id)
		if (!submission) {
			await interaction.reply({
				components: [resultContainer("Missing value", "Could not load this form submission.", "#f85149")]
			})
			return
		}
		const payload = parseSubmissionPayload(submission)
		const isCaseId = data.field === "caseId"
		const name = isCaseId ? "Case ID" : "ID"
		const value = isCaseId ? payload.caseId : submission.applicantId
		await interaction.reply({
			components: [resultContainer(name, value ? `\`${value}\`` : `${name} not found.`, value ? "#7bdc65" : "#f85149")]
		})
	}
}

export class FormReviewAcceptButton extends Button {
	customId = "form-review-accept"
	label = "Accept"
	style = ButtonStyle.Success
	ephemeral = true

	constructor(id?: number, disabled = false) {
		super()
		this.disabled = disabled
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
		if (!(await requireReviewRole(interaction, loaded.form))) {
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

	constructor(id?: number, disabled = false) {
		super()
		this.disabled = disabled
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
		if (!(await requireReviewRole(interaction, loaded.form))) {
			return
		}
		await interaction.showModal(new FormReviewDecisionModal("denied", loaded.id))
	}
}

export class FormReviewLockButton extends Button {
	customId = "form-review-lock"
	label = "Lock"
	style = ButtonStyle.Secondary
	ephemeral = true

	constructor(id?: number) {
		super()
		if (id) {
			this.customId = `form-review-lock:id=${id}`
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
		if (!(await requireReviewRole(interaction, loaded.form))) {
			return
		}
		const locked = await recordFormLock(loaded.id)
		if (!locked) {
			await interaction.reply({
				components: [resultContainer("Already reviewed", "This submission is no longer available to lock.", "#f85149")],
				ephemeral: true
			})
			return
		}
		await interaction.update({
			components: [
				buildFormReviewContainer(loaded.form, locked, {
					status: "locked",
					historyLines: [
						...historyLinesFrom(interaction.message?.rawData.components),
						reviewHistoryLine("Locked", interaction.user?.id)
					]
				})
			],
			allowedMentions: { parse: [] }
		})
	}
}

export class FormReviewUnlockButton extends Button {
	customId = "form-review-unlock"
	label = "Unlock"
	style = ButtonStyle.Secondary
	ephemeral = true

	constructor(id?: number) {
		super()
		if (id) {
			this.customId = `form-review-unlock:id=${id}`
		}
	}

	async run(interaction: ButtonInteraction, data: Record<string, unknown>) {
		if (interaction.user?.id !== reviewUnlockUserId) {
			await interaction.reply({
				components: [resultContainer("Locked", "Only <@439223656200273932> can unlock this submission.", "#f85149")],
				ephemeral: true,
				allowedMentions: { parse: [] }
			})
			return
		}
		if (typeof data.id !== "number") {
			await interaction.reply({
				components: [resultContainer("Invalid form submission", "Missing submission id.", "#f85149")],
				ephemeral: true
			})
			return
		}
		const submission = await getFormSubmission(data.id)
		const form = submission ? getFormConfig(submission.formId) : null
		if (!submission || !form) {
			await interaction.reply({
				components: [resultContainer("Invalid form submission", "Could not load this form submission.", "#f85149")],
				ephemeral: true
			})
			return
		}
		if (submission.status === "accepted" || submission.status === "denied") {
			await interaction.reply({
				components: [resultContainer("Already reviewed", `This submission is already ${submission.status}.`, "#f85149")],
				ephemeral: true
			})
			return
		}
		const unlocked = await recordFormUnlock(data.id)
		if (!unlocked) {
			await interaction.reply({
				components: [resultContainer("Already unlocked", "This submission is no longer locked.", "#f85149")],
				ephemeral: true
			})
			return
		}
		await interaction.update({
			components: [
				buildFormReviewContainer(form, unlocked, {
					status: "submitted",
					historyLines: [
						...historyLinesFrom(interaction.message?.rawData.components),
						reviewHistoryLine("Unlocked", interaction.user?.id)
					]
				})
			],
			allowedMentions: { parse: [] }
		})
	}
}

export const formReviewComponents = [
	new FormReviewAcceptButton(),
	new FormReviewDenyButton(),
	new FormReviewLockButton(),
	new FormReviewUnlockButton(),
	new FormReviewCopyButton()
]

export const formReviewModals = [new FormReviewDecisionModal()]
