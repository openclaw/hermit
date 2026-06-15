import { and, eq, sql } from "drizzle-orm"
import { getDb } from "../db.js"
import { formSubmissions, type FormSubmission } from "../db/schema.js"

const now = sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

export const createFormSubmission = async (input: {
	formId: string
	authProvider?: string | null
	applicantId?: string | null
	applicantUsername?: string | null
	payload: Record<string, string>
	reviewChannelId: string
}) => {
	const [submission] = await getDb()
		.insert(formSubmissions)
		.values({
			formId: input.formId,
			authProvider: input.authProvider ?? null,
			applicantId: input.applicantId ?? null,
			applicantUsername: input.applicantUsername ?? null,
			payload: JSON.stringify(input.payload),
			reviewChannelId: input.reviewChannelId
		})
		.returning()

	return submission
}

export const getFormSubmission = async (id: number) => {
	const [submission] = await getDb()
		.select()
		.from(formSubmissions)
		.where(eq(formSubmissions.id, id))
		.limit(1)

	return submission ?? null
}

export const updateFormSubmissionPayload = async (id: number, payload: Record<string, string>) => {
	await getDb()
		.update(formSubmissions)
		.set({
			payload: JSON.stringify(payload),
			updatedAt: now
		})
		.where(eq(formSubmissions.id, id))
}

export const markFormSubmissionSent = async (
	id: number,
	input: { reviewMessageId: string; reviewThreadId?: string | null }
) => {
	await getDb()
		.update(formSubmissions)
		.set({
			status: "submitted",
			reviewMessageId: input.reviewMessageId,
			reviewThreadId: input.reviewThreadId ?? null,
			updatedAt: now
		})
		.where(eq(formSubmissions.id, id))
}

export const recordFormDecision = async (
	id: number,
	input: {
		status: "accepted" | "denied"
		decidedById?: string | null
		decisionReason?: string | null
		actionResult?: string | null
	}
) => {
	await getDb()
		.update(formSubmissions)
		.set({
			status: input.status,
			decidedAt: now,
			decidedById: input.decidedById ?? null,
			decisionReason: input.decisionReason ?? null,
			actionResult: input.actionResult ?? null,
			updatedAt: now
		})
		.where(eq(formSubmissions.id, id))
}

export const recordFormLock = async (id: number) => {
	const [submission] = await getDb()
		.update(formSubmissions)
		.set({
			status: "locked",
			updatedAt: now
		})
		.where(and(eq(formSubmissions.id, id), eq(formSubmissions.status, "submitted")))
		.returning()
	return submission ?? null
}

export const recordFormUnlock = async (id: number) => {
	const [submission] = await getDb()
		.update(formSubmissions)
		.set({
			status: "submitted",
			updatedAt: now
		})
		.where(and(eq(formSubmissions.id, id), eq(formSubmissions.status, "locked")))
		.returning()
	return submission ?? null
}

export const parseSubmissionPayload = (submission: FormSubmission) => {
	try {
		return JSON.parse(submission.payload) as Record<string, string>
	} catch {
		return {}
	}
}
