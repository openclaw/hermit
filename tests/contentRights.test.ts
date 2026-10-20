import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { formConfigs } from "../forms.config.js"
import {
	allowedEvidenceExtensions,
	contentRightsCaseId,
	contentRightsLimits,
	normalizeClawhubUrls,
	parseContentRightsFormData,
	storeEvidenceFile,
	validateEvidenceFiles,
	validateIntakeEvidenceFiles
} from "../src/clawhubContentRights/intake.js"
import { contentRightsRateLimitKey } from "../src/clawhubContentRights/rateLimit.js"
import type { ContentRightsWorkflowDependencies } from "../src/clawhubContentRights/workflow.js"
import type { FormSubmission } from "../src/db/schema.js"
import { getFormAuthProviders } from "../src/forms/forms.js"
import { FormRoute } from "../src/forms/routes/form.js"
import {
	handleContentRightsSubmit,
	handleFormsRequest,
	type ContentRightsSubmitDependencies
} from "../src/forms/server.js"
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
		expect(receipt.text).toContain("CHR-000007")
		expect(receipt.text).not.toContain("Legal Team")
		expect(receipt.text).not.toContain("RedNote")
		expect(receipt.text).not.toContain("Concern")
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

const contentRightsForm = () => {
	const form = formConfigs.find((item) => item.id === "clawhub-content-rights")
	if (!form) throw new Error("missing clawhub-content-rights form")
	return form
}

const validBody = (overrides: Record<string, string> = {}) => {
	const body = new FormData()
	const values: Record<string, string> = {
		requesterName: "Legal Team",
		organization: "RedNote",
		email: "legal@example.com",
		clawhubUrls: "https://clawhub.ai/huangrh99/xhs-mac-mcp",
		explanation: "This package uses protected material.",
		...overrides
	}
	for (const [key, value] of Object.entries(values)) body.set(key, value)
	return body
}

const parseError = (body: FormData) => parseContentRightsFormData(body).error

const fileOfSize = (name: string, bytes: number) =>
	new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" })

const MB = 1024 * 1024

describe("ClawHub content rights intake hardening", () => {
	it("derives the attachment allowlist from the form accept list", () => {
		const field = contentRightsForm().fields.find((item) => item.id === "attachments")
		expect(field?.type).toBe("file")
		const accept = field?.type === "file" ? field.accept ?? "" : ""
		expect(allowedEvidenceExtensions).toEqual(accept.split(",").map((item) => item.trim()))
		expect(allowedEvidenceExtensions).toEqual([
			".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".md", ".doc", ".docx"
		])
	})

	it("rejects probe attachment names and types outside the allowlist", () => {
		const reject = (name: string) => {
			const body = validBody()
			body.append("attachments", new File(["x"], name, { type: "text/plain" }))
			return parseError(body)
		}
		expect(reject("../../evil.txt")).toBe("Attachment names must be plain file names.")
		expect(reject("..\\..\\evil.txt")).toBe("Attachment names must be plain file names.")
		expect(reject("evil\u0000.pdf")).toBe("Attachment names must be plain file names.")
		expect(reject("a.html")).toStartWith("Attachments must be one of these file types:")
		expect(reject("big.bin")).toStartWith("Attachments must be one of these file types:")
		expect(reject("no-extension")).toStartWith("Attachments must be one of these file types:")
		expect(reject(".pdf")).toStartWith("Attachments must be one of these file types:")
		expect(reject("notice.pdf.html")).toStartWith("Attachments must be one of these file types:")
		expect(reject(`${"a".repeat(contentRightsLimits.evidenceFileNameMaxLength)}.pdf`)).toBe(
			"Attachment names must be plain file names."
		)
		expect(reject("NOTICE.PDF")).toBeNull()
		expect(reject("evidence.docx")).toBeNull()
	})

	it("caps intake attachments by count, per-file size, and total size", () => {
		const pdf = (bytes = 3) => fileOfSize("notice.pdf", bytes)
		expect(validateIntakeEvidenceFiles(Array.from({ length: 5 }, () => pdf()))).toBeNull()
		expect(validateIntakeEvidenceFiles(Array.from({ length: 6 }, () => pdf()))).toBe(
			"Attach no more than 5 files."
		)
		expect(validateIntakeEvidenceFiles([pdf(20 * MB + 1)])).toBe(
			"Each attachment must be 20 MB or smaller."
		)
		expect(validateIntakeEvidenceFiles([pdf(13 * MB), pdf(13 * MB)])).toBe(
			"Attachments must total 25 MB or less."
		)
		expect(validateIntakeEvidenceFiles([pdf(12 * MB), pdf(13 * MB)])).toBeNull()
		expect(validateIntakeEvidenceFiles([pdf()], [])).toBe("Attachments are not accepted for this form.")
		// The staff correspondence API keeps its own, unchanged limits.
		expect(validateEvidenceFiles([fileOfSize("message.eml", 3)])).toBeNull()
	})

	it("caps the number and length of ClawHub URLs", () => {
		const url = (index: number) => `https://clawhub.ai/owner/skill-${index}`
		const eighty = Array.from({ length: 80 }, (_, index) => url(index)).join("\n")
		expect(parseError(validBody({ clawhubUrls: eighty }))).toBe("List no more than 10 ClawHub URLs.")
		const eleven = Array.from({ length: 11 }, (_, index) => url(index)).join("\n")
		expect(parseError(validBody({ clawhubUrls: eleven }))).toBe("List no more than 10 ClawHub URLs.")
		const ten = Array.from({ length: 10 }, (_, index) => url(index)).join("\n")
		expect(parseContentRightsFormData(validBody({ clawhubUrls: ten })).value?.clawhubUrls).toHaveLength(10)
		const longUrl = `https://clawhub.ai/owner/${"s".repeat(contentRightsLimits.clawhubUrlMaxLength)}`
		expect(parseError(validBody({ clawhubUrls: longUrl }))).toBe(
			"Each ClawHub URL must be 300 characters or fewer."
		)
		const padded = `${url(1)}${"\n".repeat(contentRightsLimits.clawhubUrlsFieldMaxLength)}${url(2)}`
		expect(parseError(validBody({ clawhubUrls: padded }))).toBe(
			"ClawHub URLs must be 4000 characters or fewer."
		)
		expect(parseError(validBody({ clawhubUrls: "not a url" }))).toBe(
			"Every URL must identify a skill on clawhub.ai."
		)
	})

	it("caps free-text field lengths", () => {
		expect(parseError(validBody({ requesterName: "a".repeat(121) }))).toBe(
			"Your name must be 120 characters or fewer."
		)
		expect(parseError(validBody({ organization: "a".repeat(121) }))).toBe(
			"Organization must be 120 characters or fewer."
		)
		expect(parseError(validBody({ email: `${"a".repeat(245)}@example.com` }))).toBe(
			"Email address must be 254 characters or fewer."
		)
		expect(parseError(validBody({ explanation: "a".repeat(2001) }))).toBe(
			"Explanation must be 2000 characters or fewer."
		)
		expect(parseError(validBody({
			requesterName: "a".repeat(120),
			organization: "b".repeat(120),
			explanation: "c".repeat(2000)
		}))).toBeNull()
	})

	it("rejects control characters in single-line fields", () => {
		expect(parseError(validBody({ requesterName: "Legal\u0000Team" }))).toBe(
			"Your name contains unsupported characters."
		)
		expect(parseError(validBody({ organization: "RedNote\r\nBcc: victim@example.com" }))).toBe(
			"Organization contains unsupported characters."
		)
		expect(parseError(validBody({ email: "legal@example.com\u0000" }))).toBe(
			"Email address contains unsupported characters."
		)
		expect(parseError(validBody({ requesterName: "Legal \u202eTeam" }))).toBe(
			"Your name contains unsupported characters."
		)
		expect(parseError(validBody({ explanation: "Line one\u0000" }))).toBe(
			"Explanation contains unsupported characters."
		)
		expect(parseError(validBody({ explanation: "Line one\r\n\tLine two" }))).toBeNull()
	})
})

const reviewSubmission = (payload: Record<string, string>): FormSubmission => ({
	id: 7,
	formId: "clawhub-content-rights",
	status: "submitted",
	authProvider: null,
	applicantId: null,
	applicantUsername: null,
	payload: JSON.stringify(payload),
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

const collectText = (value: unknown, parts: string[] = []): string[] => {
	if (Array.isArray(value)) {
		for (const item of value) collectText(item, parts)
	} else if (value && typeof value === "object") {
		const record = value as Record<string, unknown>
		if (typeof record.content === "string") parts.push(record.content)
		if (typeof record.label === "string") parts.push(record.label)
		for (const child of Object.values(record)) {
			if (child && typeof child === "object") collectText(child, parts)
		}
	}
	return parts
}

describe("ClawHub content rights Discord review limits", () => {
	it("keeps a maximum-size submission under Discord's 4000-character text limit", () => {
		const urls = Array.from(
			{ length: contentRightsLimits.maxClawhubUrls },
			(_, index) => `https://clawhub.ai/${"o".repeat(140)}/skills/${"s".repeat(140)}${index}`
		)
		const submission = reviewSubmission({
			caseId: "CHR-000175",
			requesterName: "n".repeat(contentRightsLimits.requesterNameMaxLength),
			organization: "o".repeat(contentRightsLimits.organizationMaxLength),
			email: `${"e".repeat(contentRightsLimits.emailMaxLength - 12)}@example.com`,
			clawhubUrls: urls.join("\n"),
			explanation: "x".repeat(contentRightsLimits.explanationMaxLength),
			attachments: Array.from(
				{ length: contentRightsLimits.maxEvidenceFiles },
				() => `${"f".repeat(contentRightsLimits.evidenceFileNameMaxLength - 4)}.pdf`
			).join("\n")
		})
		const submitted = collectText(buildFormReviewContainer(contentRightsForm(), submission).serialize())
		const decided = collectText(buildFormReviewContainer(contentRightsForm(), submission, {
			status: "denied",
			decidedById: "123456789012345678",
			decisionReason: "r".repeat(1000),
			actionResult: "No external action required."
		}).serialize())
		const submittedLength = submitted.join("").length
		const decidedLength = decided.join("").length

		expect(submittedLength).toBeLessThanOrEqual(4000)
		expect(decidedLength).toBeLessThanOrEqual(4000)
		expect(submitted.join("\n")).toContain("CHR-000175")
		expect(submitted.join("\n")).toContain("Truncated; the full text is in the case record.")
		expect(submitted.join("\n")).toMatch(/…and \d+ more URLs in the case record/)
		expect(submitted.join("\n")).toMatch(/…and \d+ more attachments in the case record/)
	})

	it("leaves ordinary submissions untruncated", () => {
		const text = collectText(buildFormReviewContainer(contentRightsForm(), reviewSubmission({
			caseId: "CHR-000007",
			requesterName: "Legal Team",
			organization: "RedNote",
			email: "legal@example.com",
			clawhubUrls: "https://clawhub.ai/huangrh99/xhs-mac-mcp",
			explanation: "Concern",
			attachments: "notice.pdf"
		})).serialize()).join("\n")

		expect(text).toContain("https://clawhub.ai/huangrh99/xhs-mac-mcp")
		expect(text).toContain("Concern")
		expect(text).not.toContain("Truncated")
		expect(text).not.toContain("in the case record")
	})
})

const fakeSubmitDependencies = (overrides: Partial<ContentRightsSubmitDependencies> = {}) => {
	const calls: string[] = []
	const events: Array<{ eventType: string; metadata: Record<string, unknown> }> = []
	const intake: ContentRightsWorkflowDependencies<FormSubmission> = {
		createSubmission: async (payload) => {
			calls.push("createSubmission")
			return reviewSubmission(payload)
		},
		updateSubmissionPayload: async () => {},
		createCase: async () => {},
		storeFile: async (_caseId, kind, file) => ({
			objectKey: `cases/CHR-000007/${kind}/${file.name}`,
			originalName: file.name,
			contentType: file.type,
			sizeBytes: file.size,
			sha256: "hash"
		}),
		recordFile: async () => {},
		appendEvent: async (input) => {
			events.push(input)
		},
		sendReceipt: async (input) => {
			calls.push("sendReceipt")
			return { providerMessageId: "email-1", to: input.email, subject: "Receipt", text: "Receipt" }
		}
	}
	const dependencies: ContentRightsSubmitDependencies = {
		rateLimiter: null,
		intake,
		reloadSubmission: async (id) => ({ ...reviewSubmission({ caseId: "CHR-000007" }), id }),
		postReview: async () => {
			calls.push("postReview")
		},
		appendEvent: async (input) => {
			events.push(input)
		},
		...overrides
	}
	return { dependencies, calls, events }
}

const submitRequest = (body: FormData, ip = "203.0.113.7") =>
	new Request("https://forms.openclaw.ai/clawhub-content-rights/submit", {
		method: "POST",
		headers: { "cf-connecting-ip": ip },
		body
	})

describe("ClawHub content rights submission handling", () => {
	it("keys the rate limit on the connecting IP", () => {
		expect(contentRightsRateLimitKey(submitRequest(validBody(), "198.51.100.4"))).toBe(
			"clawhub-content-rights:198.51.100.4"
		)
		expect(contentRightsRateLimitKey(new Request("https://forms.openclaw.ai/"))).toBe(
			"clawhub-content-rights:unknown"
		)
	})

	it("returns 429 without creating a case when the per-IP limit is exceeded", async () => {
		const keys: string[] = []
		const { dependencies, calls } = fakeSubmitDependencies({
			rateLimiter: {
				limit: async ({ key }) => {
					keys.push(key)
					return { success: keys.length <= 3 }
				}
			}
		})
		const statuses: number[] = []
		for (let index = 0; index < 5; index += 1) {
			const response = await handleContentRightsSubmit(submitRequest(validBody()), contentRightsForm(), dependencies)
			statuses.push(response.status)
			if (response.status === 429) {
				expect(response.headers.get("retry-after")).toBe("60")
				expect(await response.text()).toContain("Please wait a minute and try again.")
			}
		}

		expect(statuses).toEqual([200, 200, 200, 429, 429])
		expect(keys.every((key) => key === "clawhub-content-rights:203.0.113.7")).toBe(true)
		expect(calls.filter((call) => call === "createSubmission")).toHaveLength(3)
		expect(calls.filter((call) => call === "postReview")).toHaveLength(3)
	})

	it("allows submissions when the rate limit binding is missing or errors", async () => {
		const missing = fakeSubmitDependencies({ rateLimiter: undefined })
		expect((await handleContentRightsSubmit(submitRequest(validBody()), contentRightsForm(), missing.dependencies)).status).toBe(200)

		const failing = fakeSubmitDependencies({
			rateLimiter: { limit: async () => { throw new Error("limiter unavailable") } }
		})
		expect((await handleContentRightsSubmit(submitRequest(validBody()), contentRightsForm(), failing.dependencies)).status).toBe(200)
	})

	it("rejects invalid probe payloads before creating a case or sending a receipt", async () => {
		const { dependencies, calls } = fakeSubmitDependencies()
		const body = validBody()
		body.append("attachments", new File(["<script>"], "a.html", { type: "text/html" }))

		const response = await handleContentRightsSubmit(submitRequest(body), contentRightsForm(), dependencies)

		expect(response.status).toBe(400)
		expect(await response.text()).toContain("Attachments must be one of these file types")
		expect(calls).toEqual([])
	})

	it("records discord_review_failed and still confirms submission when Discord rejects the review", async () => {
		const { dependencies, events } = fakeSubmitDependencies({
			postReview: async () => {
				throw new Error("Invalid Form Body: components exceed 4000 characters")
			}
		})

		const response = await handleContentRightsSubmit(submitRequest(validBody()), contentRightsForm(), dependencies)

		expect(response.status).toBe(200)
		expect(await response.text()).toContain("Submitted")
		const failed = events.find((event) => event.eventType === "discord_review_failed")
		expect(failed?.metadata).toEqual({
			reviewChannelId: contentRightsForm().reviewChannelId,
			error: "Invalid Form Body: components exceed 4000 characters"
		})
		expect(events.map((event) => event.eventType)).not.toContain("discord_review_posted")
	})

	it("still confirms submission when the review failure event cannot be recorded", async () => {
		const { dependencies } = fakeSubmitDependencies({
			reloadSubmission: async () => null,
			appendEvent: async () => {
				throw new Error("D1 unavailable")
			}
		})

		const response = await handleContentRightsSubmit(submitRequest(validBody()), contentRightsForm(), dependencies)

		expect(response.status).toBe(200)
	})

	it("records discord_review_posted after a successful review post", async () => {
		const { dependencies, events, calls } = fakeSubmitDependencies()

		const response = await handleContentRightsSubmit(submitRequest(validBody()), contentRightsForm(), dependencies)

		expect(response.status).toBe(200)
		expect(calls).toEqual(["createSubmission", "sendReceipt", "postReview"])
		expect(events.map((event) => event.eventType)).toContain("discord_review_posted")
		expect(events.map((event) => event.eventType)).not.toContain("discord_review_failed")
	})
})
