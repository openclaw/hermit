import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { formConfigs } from "../forms.config.js"
import {
	contentRightsCaseId,
	normalizeClawhubUrls,
	parseContentRightsFormData,
	storeEvidenceFile,
	validateEvidenceFiles
} from "../src/clawhubContentRights/intake.js"
import { getFormAuthProviders } from "../src/forms/forms.js"
import { FormRoute } from "../src/forms/routes/form.js"
import { handleFormsRequest } from "../src/forms/server.js"
import { intakeContentRightsCase } from "../src/clawhubContentRights/workflow.js"
import { buildContentRightsReceipt } from "../src/clawhubContentRights/receipt.js"
import { buildFormReviewContainer } from "../src/forms/reviewButtons.js"

const applyMigration = (database: Database, path: string) => {
	const migration = readFileSync(path, "utf8")
	for (const statement of migration.split("--> statement-breakpoint")) {
		const trimmed = statement.trim()
		if (trimmed.length > 0) {
			database.run(trimmed)
		}
	}
}

describe("ClawHub content rights intake", () => {
	it("publishes a public form that does not require an auth provider", () => {
		const form = formConfigs.find((item) => item.id === "clawhub-content-rights")

		expect(form?.title).toBe("ClawHub Content Rights Request")
		expect(form?.auth).toBeNull()
		expect(form ? getFormAuthProviders(form) : null).toEqual([])
	})

	it("creates ClawHub-specific case, file, and append-only event tables", () => {
		const migrationPath = readdirSync("drizzle")
			.find((file) => file.startsWith("0003_") && file.endsWith(".sql"))

		expect(migrationPath).toBeDefined()

		const database = new Database(":memory:")
		applyMigration(database, `drizzle/${migrationPath}`)

		const tableNames = database
			.query("select name from sqlite_master where type = 'table'")
			.all()
			.map((row) => (row as { name: string }).name)

		expect(tableNames).toContain("clawhub_content_rights_cases")
		expect(tableNames).toContain("clawhub_content_rights_files")
		expect(tableNames).toContain("clawhub_content_rights_events")
	})

	it("renders the public form as multipart with a multiple attachment input", () => {
		const form = formConfigs.find((item) => item.id === "clawhub-content-rights")
		expect(form).toBeDefined()

		const html = renderToStaticMarkup(createElement(FormRoute, {
			form: form!,
			session: null,
			user: null
		}))

		expect(html).toContain('encType="multipart/form-data"')
		expect(html).toContain('type="file"')
		expect(html).toContain('name="attachments"')
		expect(html).toContain("multiple")
		expect(html).not.toContain("Signed in as")
	})

	it("serves the public form without redirecting to OAuth", async () => {
		const response = await handleFormsRequest(
			new Request("https://forms.openclaw.ai/clawhub-content-rights"),
			{} as never
		)

		expect(response?.status).toBe(200)
		const html = await response?.text()
		expect(html).toContain('type="file"')
		expect(html).not.toContain("Sign in to continue")
		expect(response?.headers.get("location")).toBeNull()
	})

	it("normalizes one or more canonical ClawHub skill URLs", () => {
		expect(normalizeClawhubUrls(`
			https://clawhub.ai/anysearch-ai/skills/anysearch?ref=notice
			https://clawhub.ai/anysearch-ai/skills/anysearch-mcp/
			https://clawhub.ai/huangrh99/xhs-mac-mcp?ref=notice
			https://clawhub.ai/borye/xiaohongshu-mcp/
		`)).toEqual([
			"https://clawhub.ai/anysearch-ai/skills/anysearch",
			"https://clawhub.ai/anysearch-ai/skills/anysearch-mcp",
			"https://clawhub.ai/huangrh99/xhs-mac-mcp",
			"https://clawhub.ai/borye/xiaohongshu-mcp"
		])
		expect(() => normalizeClawhubUrls("https://example.com/not-clawhub")).toThrow(
			"Every URL must identify a skill on clawhub.ai."
		)
		expect(() => normalizeClawhubUrls("https://clawhub.ai/anysearch-ai")).toThrow(
			"Every URL must identify a skill on clawhub.ai."
		)
		expect(() =>
			normalizeClawhubUrls("https://clawhub.ai/anysearch-ai/plugins/anysearch")
		).toThrow("Every URL must identify a skill on clawhub.ai.")
	})

	it("bounds evidence uploads and assigns a stable case id", () => {
		expect(contentRightsCaseId(42)).toBe("CHR-000042")
		expect(validateEvidenceFiles([
			new File(["pdf"], "notice.pdf", { type: "application/pdf" })
		])).toBeNull()
		expect(validateEvidenceFiles([
			new File([new Uint8Array(20 * 1024 * 1024 + 1)], "too-large.pdf", { type: "application/pdf" })
		])).toBe("Each attachment must be 20 MB or smaller.")
	})

	it("stores exact evidence bytes in R2 with their SHA-256 metadata", async () => {
		const writes: Array<{ key: string; bytes: Uint8Array; options: R2PutOptions }> = []
		const bucket = {
			put: async (key: string, value: ArrayBuffer, options: R2PutOptions) => {
				writes.push({ key, bytes: new Uint8Array(value), options })
				return {} as R2Object
			}
		} as R2Bucket
		const file = new File(["legal evidence"], "RedNote notice.pdf", { type: "application/pdf" })

		const metadata = await storeEvidenceFile(bucket, "CHR-000042", "intake", file, "fixed")

		expect(writes).toHaveLength(1)
		expect(writes[0]?.key).toBe("cases/CHR-000042/intake/fixed-rednote-notice.pdf")
		expect(new TextDecoder().decode(writes[0]?.bytes)).toBe("legal evidence")
		expect(writes[0]?.options.httpMetadata).toEqual({ contentType: "application/pdf" })
		expect(metadata).toEqual({
			objectKey: "cases/CHR-000042/intake/fixed-rednote-notice.pdf",
			originalName: "RedNote notice.pdf",
			contentType: "application/pdf",
			sizeBytes: 14,
			sha256: "4e71c1e474571389e924b7994bc0c576fd34e31eaa0eaff68a250cf724486152"
		})
	})

	it("parses public intake text and keeps uploaded evidence files separate", () => {
		const body = new FormData()
		body.set("requesterName", "Legal Team")
		body.set("organization", "RedNote")
		body.set("email", "legal@example.com")
		body.set("clawhubUrls", "https://clawhub.ai/huangrh99/xhs-mac-mcp")
		body.set("explanation", "This package uses protected material.")
		body.append("attachments", new File(["pdf"], "notice.pdf", { type: "application/pdf" }))

		const parsed = parseContentRightsFormData(body)

		expect(parsed.error).toBeNull()
		expect(parsed.files.map((file) => file.name)).toEqual(["notice.pdf"])
		expect(parsed.value).toEqual({
			requesterName: "Legal Team",
			organization: "RedNote",
			email: "legal@example.com",
			clawhubUrls: ["https://clawhub.ai/huangrh99/xhs-mac-mcp"],
			explanation: "This package uses protected material."
		})
	})

	it("rejects invalid requester emails and non-ClawHub URLs", () => {
		const body = new FormData()
		body.set("requesterName", "Legal Team")
		body.set("organization", "RedNote")
		body.set("email", "not-an-email")
		body.set("clawhubUrls", "https://example.com/not-clawhub")
		body.set("explanation", "Concern")

		expect(parseContentRightsFormData(body).error).toBe("Enter a valid email address.")

		body.set("email", "legal@example.com")
		expect(parseContentRightsFormData(body).error).toBe(
			"Every URL must identify a skill on clawhub.ai."
		)
	})

	it("creates a case ledger, stores every attachment, and records the receipt", async () => {
		const body = new FormData()
		body.set("requesterName", "Legal Team")
		body.set("organization", "RedNote")
		body.set("email", "legal@example.com")
		body.set("clawhubUrls", "https://clawhub.ai/huangrh99/xhs-mac-mcp")
		body.set("explanation", "Concern")
		body.append("attachments", new File(["pdf"], "notice.pdf", { type: "application/pdf" }))
		const calls: string[] = []

		const result = await intakeContentRightsCase(body, {
			createSubmission: async () => {
				calls.push("submission")
				return { id: 7 }
			},
			updateSubmissionPayload: async (_id, payload) => {
				calls.push(`payload:${payload.caseId}`)
			},
			createCase: async (input) => {
				calls.push(`case:${input.caseId}`)
			},
			storeFile: async (_caseId, kind, file) => {
				calls.push(`store:${file.name}`)
				return {
					objectKey: `cases/CHR-000007/${kind}/${file.name}`,
					originalName: file.name,
					contentType: file.type,
					sizeBytes: file.size,
					sha256: "hash"
				}
			},
			recordFile: async (input) => {
				calls.push(`file:${input.objectKey}`)
			},
			appendEvent: async (input) => {
				calls.push(`event:${input.eventType}`)
			},
			sendReceipt: async (input) => {
				calls.push(`receipt:${input.caseId}`)
				return {
					providerMessageId: "email-1",
					to: input.email,
					subject: "Receipt",
					text: "Exact receipt body"
				}
			}
		})

		expect(result.caseId).toBe("CHR-000007")
		expect(result.receiptSent).toBe(true)
		expect(calls).toEqual([
			"submission",
			"payload:CHR-000007",
			"case:CHR-000007",
			"event:submission_received",
			"store:notice.pdf",
			"file:cases/CHR-000007/intake/notice.pdf",
			"event:evidence_stored",
			"receipt:CHR-000007",
			"store:receipt-CHR-000007.txt",
			"file:cases/CHR-000007/correspondence/receipt-CHR-000007.txt",
			"event:correspondence_stored",
			"event:receipt_sent"
		])
	})

	it("builds a factual requester receipt with the case id and reported URLs", () => {
		const receipt = buildContentRightsReceipt({
			caseId: "CHR-000007",
			requesterName: "Legal Team",
			organization: "RedNote",
			email: "legal@example.com",
			clawhubUrls: ["https://clawhub.ai/huangrh99/xhs-mac-mcp"],
			explanation: "Concern"
		})

		expect(receipt.subject).toBe("ClawHub content rights request receipt: CHR-000007")
		expect(receipt.text).toContain("We received your ClawHub content rights request.")
		expect(receipt.text).toContain("https://clawhub.ai/huangrh99/xhs-mac-mcp")
		expect(receipt.text).not.toContain("accepted")
	})

	it("does not report a sent receipt as failed when only evidence storage fails", async () => {
		const body = new FormData()
		body.set("requesterName", "Legal Team")
		body.set("organization", "RedNote")
		body.set("email", "legal@example.com")
		body.set("clawhubUrls", "https://clawhub.ai/huangrh99/xhs-mac-mcp")
		body.set("explanation", "Concern")
		const events: string[] = []

		const result = await intakeContentRightsCase(body, {
			createSubmission: async () => ({ id: 7 }),
			updateSubmissionPayload: async () => {},
			createCase: async () => {},
			storeFile: async (_caseId, kind, file) => {
				if (kind === "correspondence") throw new Error("R2 unavailable")
				return {
					objectKey: `cases/CHR-000007/${kind}/${file.name}`,
					originalName: file.name,
					contentType: file.type,
					sizeBytes: file.size,
					sha256: "hash"
				}
			},
			recordFile: async () => {},
			appendEvent: async (input) => {
				events.push(input.eventType)
			},
			sendReceipt: async () => ({
				providerMessageId: "email-1",
				to: "legal@example.com",
				subject: "Receipt",
				text: "Exact receipt body"
			})
		})

		expect(result.receiptSent).toBe(true)
		expect(events).toContain("receipt_sent")
		expect(events).toContain("receipt_evidence_failed")
		expect(events).not.toContain("receipt_failed")
	})

	it("shows the stable case id and requester email in the Discord review", () => {
		const form = formConfigs.find((item) => item.id === "clawhub-content-rights")
		expect(form).toBeDefined()
		const review = buildFormReviewContainer(form!, {
			id: 7,
			formId: "clawhub-content-rights",
			status: "submitted",
			authProvider: null,
			applicantId: null,
			applicantUsername: null,
			payload: JSON.stringify({
				caseId: "CHR-000007",
				requesterName: "Legal Team",
				organization: "RedNote",
				email: "legal@example.com",
				clawhubUrls: "https://clawhub.ai/huangrh99/xhs-mac-mcp",
				explanation: "Concern",
				attachments: "notice.pdf"
			}),
			reviewChannelId: "channel",
			reviewMessageId: null,
			reviewThreadId: null,
			decidedAt: null,
			decidedById: null,
			decisionReason: null,
			actionResult: null,
			createdAt: "2026-06-15T00:00:00.000Z",
			updatedAt: "2026-06-15T00:00:00.000Z"
		})

		expect(JSON.stringify(review)).toContain("CHR-000007")
		expect(JSON.stringify(review)).toContain("legal@example.com")
	})
})
