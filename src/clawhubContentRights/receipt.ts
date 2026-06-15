import type { ContentRightsIntake } from "./intake.js"

type ReceiptInput = ContentRightsIntake & { caseId: string }
const defaultFrom = "ClawHub <noreply@notifications.openclaw.ai>"

export const buildContentRightsReceipt = (input: ReceiptInput) => ({
	subject: `ClawHub content rights request receipt: ${input.caseId}`,
	text: [
		`Hello ${input.requesterName},`,
		"",
		"We received your ClawHub content rights request.",
		"",
		`Case ID: ${input.caseId}`,
		`Organization: ${input.organization}`,
		"Reported ClawHub URLs:",
		...input.clawhubUrls.map((url) => `- ${url}`),
		"",
		"This receipt confirms submission only. ClawHub staff will review the request and contact you if more information is needed.",
		"",
		"ClawHub"
	].join("\n")
})

export const sendContentRightsReceipt = async (input: ReceiptInput) => {
	const apiKey = process.env.RESEND_API_KEY
	const from = process.env.CLAWHUB_NOREPLY_FROM || defaultFrom
	if (!apiKey) {
		throw new Error("Receipt email is not configured.")
	}
	const receipt = buildContentRightsReceipt(input)
	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"content-type": "application/json"
		},
		body: JSON.stringify({
			from,
			to: [input.email],
			subject: receipt.subject,
			text: receipt.text
		})
	})
	const result = await response.json().catch(() => null) as { id?: string; message?: string } | null
	if (!response.ok || !result?.id) {
		throw new Error(result?.message || `Receipt email failed with ${response.status}.`)
	}
	return {
		providerMessageId: result.id,
		to: input.email,
		...receipt
	}
}
