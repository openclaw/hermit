import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { serializePayload } from "@buape/carbon"
import { formConfigs, formSettings } from "../forms.config.js"
import type { FormSubmission } from "../src/db/schema.js"
import {
	buildFormReviewContainer,
	buildFormReviewMessage,
	formReviewComponents
} from "../src/forms/reviewButtons.js"

const reportSubmission: FormSubmission = {
	id: 1,
	formId: "report-mod",
	status: "submitted",
	authProvider: "discord",
	applicantId: "applicant",
	applicantUsername: "Applicant",
	payload: JSON.stringify({
		moderator: "Moderator",
		reason: "Reason",
		falseReportAcknowledgement: "yes"
	}),
	reviewChannelId: formSettings.moderatorReportReviewChannelId,
	reviewMessageId: null,
	reviewThreadId: null,
	decidedAt: null,
	decidedById: null,
	decisionReason: null,
	actionResult: null,
	createdAt: "2026-07-25T00:00:00.000Z",
	updatedAt: "2026-07-25T00:00:00.000Z"
}

describe("form review routing", () => {
	it("routes moderator reports to CT automod for Community Team review", () => {
		const form = formConfigs.find((item) => item.id === "report-mod")

		expect(formSettings.moderatorReportReviewChannelId).toBe("1457498550651851005")
		expect(formSettings.moderatorReportReviewRoleId).toBe("1477360613125787678")
		expect(form?.reviewChannelId).toBe(formSettings.moderatorReportReviewChannelId)
		expect(form?.reviewRoleId).toBe(formSettings.moderatorReportReviewRoleId)
	})

	it.each(["discord-ban", "discord-mute", "github", "report-mod"])(
		"pings the notification role for %s while retaining Community Team review access",
		(formId) => {
			const form = formConfigs.find((item) => item.id === formId)!
			const message = serializePayload(buildFormReviewMessage(form, {
				...reportSubmission,
				formId,
				reviewChannelId: form.reviewChannelId
			}))

			expect(message.allowed_mentions).toEqual({ roles: ["1546936406272778271"], users: [] })
			expect(JSON.stringify(message.components)).toContain("<@&1546936406272778271>")
			expect(JSON.stringify(message.components)).not.toContain("<@&1477360613125787678>")
			expect(form.reviewRoleId).toBe("1477360613125787678")
		}
	)

	it.each(["clawhub", "clawhub-content-rights"])(
		"keeps the existing reviewer ping for %s without a notification override",
		(formId) => {
			const form = formConfigs.find((item) => item.id === formId)!
			const message = serializePayload(buildFormReviewMessage(form, {
				...reportSubmission,
				formId,
				reviewChannelId: form.reviewChannelId
			}))

			expect(message.allowed_mentions).toEqual({ roles: ["1509967254870298794"], users: [] })
			expect(JSON.stringify(message.components)).toContain("<@&1509967254870298794>")
			expect(form.reviewRoleId).toBe("1509967254870298794")
		}
	)

	it("exposes only accept and deny decision controls", () => {
		const form = formConfigs.find((item) => item.id === "report-mod")
		expect(form).toBeDefined()

		const review = buildFormReviewContainer(form!, reportSubmission)
		const serialized = JSON.stringify(serializePayload({ components: [review] }))

		expect(serialized).toContain("form-review-accept")
		expect(serialized).toContain("form-review-deny")
		expect(serialized).not.toContain("form-review-lock")
		expect(serialized).not.toContain("form-review-unlock")
		expect(formReviewComponents.map((component) => component.customId)).toEqual([
			"form-review-accept",
			"form-review-deny",
			"form-review-copy"
		])
	})

	it("releases legacy locked submissions without changing decisions", () => {
		const database = new Database(":memory:")
		database.exec(`
			CREATE TABLE form_submissions (
				id INTEGER PRIMARY KEY,
				status TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			INSERT INTO form_submissions (id, status, updated_at) VALUES
				(1, 'locked', '2026-07-24T00:00:00.000Z'),
				(2, 'submitted', '2026-07-24T00:00:00.000Z'),
				(3, 'accepted', '2026-07-24T00:00:00.000Z');
		`)

		database.exec(readFileSync("drizzle/0012_remove_form_review_locks.sql", "utf8"))

		const statuses = database
			.query("SELECT status FROM form_submissions ORDER BY id")
			.all()
			.map((row) => (row as { status: string }).status)
		expect(statuses).toEqual(["submitted", "submitted", "accepted"])
	})
})
