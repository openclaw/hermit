import {
	contentRightsCaseId,
	parseContentRightsFormData,
	type ContentRightsIntake
} from "./intake.js"

type StoredEvidence = {
	objectKey: string
	originalName: string
	contentType: string
	sizeBytes: number
	sha256: string
}

type CaseEventInput = {
	caseId: string
	eventType: string
	actor?: string | null
	metadata: Record<string, unknown>
}

export type ContentRightsWorkflowDependencies<TSubmission extends { id: number }> = {
	createSubmission: (payload: Record<string, string>) => Promise<TSubmission>
	updateSubmissionPayload: (id: number, payload: Record<string, string>) => Promise<void>
	createCase: (input: ContentRightsIntake & { caseId: string; formSubmissionId: number }) => Promise<void>
	storeFile: (caseId: string, kind: "intake" | "correspondence", file: File) => Promise<StoredEvidence>
	recordFile: (input: StoredEvidence & { caseId: string; kind: "intake" | "correspondence" }) => Promise<void>
	appendEvent: (input: CaseEventInput) => Promise<void>
	sendReceipt: (input: ContentRightsIntake & { caseId: string }) => Promise<{
		providerMessageId: string
		to: string
		subject: string
		text: string
	}>
}

export class ContentRightsValidationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ContentRightsValidationError"
	}
}

const submissionPayload = (
	value: ContentRightsIntake,
	caseId?: string,
	attachmentNames: string[] = []
) => ({
	...(caseId ? { caseId } : {}),
	requesterName: value.requesterName,
	organization: value.organization,
	email: value.email,
	clawhubUrls: value.clawhubUrls.join("\n"),
	explanation: value.explanation,
	attachments: attachmentNames.join("\n")
})

export const intakeContentRightsCase = async <TSubmission extends { id: number }>(
	body: FormData,
	dependencies: ContentRightsWorkflowDependencies<TSubmission>
) => {
	const parsed = parseContentRightsFormData(body)
	if (parsed.error || !parsed.value) {
		throw new ContentRightsValidationError(parsed.error ?? "Invalid content rights request.")
	}
	const submission = await dependencies.createSubmission(submissionPayload(parsed.value))
	const caseId = contentRightsCaseId(submission.id)
	await dependencies.updateSubmissionPayload(
		submission.id,
		submissionPayload(parsed.value, caseId, parsed.files.map((file) => file.name))
	)
	await dependencies.createCase({
		...parsed.value,
		caseId,
		formSubmissionId: submission.id
	})
	await dependencies.appendEvent({
		caseId,
		eventType: "submission_received",
		metadata: {
			formSubmissionId: submission.id,
			clawhubUrls: parsed.value.clawhubUrls,
			attachmentCount: parsed.files.length
		}
	})
	for (const file of parsed.files) {
		const stored = await dependencies.storeFile(caseId, "intake", file)
		await dependencies.recordFile({ caseId, kind: "intake", ...stored })
		await dependencies.appendEvent({
			caseId,
			eventType: "evidence_stored",
			metadata: stored
		})
	}
	let receiptSent = false
	let receipt: Awaited<ReturnType<typeof dependencies.sendReceipt>> | null = null
	try {
		receipt = await dependencies.sendReceipt({ ...parsed.value, caseId })
		receiptSent = true
	} catch (error) {
		await dependencies.appendEvent({
			caseId,
			eventType: "receipt_failed",
			metadata: {
				error: error instanceof Error ? error.message : "Unknown receipt error"
			}
		})
	}
	if (receipt) {
		try {
			const receiptFile = new File(
				[receipt.text],
				`receipt-${caseId}.txt`,
				{ type: "text/plain; charset=utf-8" }
			)
			const storedReceipt = await dependencies.storeFile(caseId, "correspondence", receiptFile)
			await dependencies.recordFile({ caseId, kind: "correspondence", ...storedReceipt })
			await dependencies.appendEvent({
				caseId,
				eventType: "correspondence_stored",
				metadata: {
					direction: "outbound",
					purpose: "requester_receipt",
					to: receipt.to,
					subject: receipt.subject,
					...storedReceipt
				}
			})
		} catch (error) {
			await dependencies.appendEvent({
				caseId,
				eventType: "receipt_evidence_failed",
				metadata: {
					error: error instanceof Error ? error.message : "Unknown evidence storage error"
				}
			})
		}
		await dependencies.appendEvent({
			caseId,
			eventType: "receipt_sent",
			metadata: {
				providerMessageId: receipt.providerMessageId,
				to: receipt.to,
				subject: receipt.subject
			}
		})
	}
	return { caseId, submission, receiptSent }
}
