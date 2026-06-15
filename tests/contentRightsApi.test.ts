import { describe, expect, it } from "bun:test"
import { handleContentRightsApi } from "../src/clawhubContentRights/api.js"

const existingCase = {
	case: {
		caseId: "CHR-000007",
		email: "legal@example.com",
		clawhubUrls: ["https://clawhub.ai/example/skill"]
	},
	files: [],
	events: []
}

const dependencies = (calls: string[] = []) => ({
	token: "secret",
	getCase: async (caseId: string) => caseId === "CHR-000007" ? existingCase : null,
	storeFile: async (_caseId: string, _kind: "correspondence", file: File) => {
		calls.push(`store:${file.name}`)
		return {
			objectKey: `cases/CHR-000007/correspondence/${file.name}`,
			originalName: file.name,
			contentType: file.type,
			sizeBytes: file.size,
			sha256: "hash"
		}
	},
	recordFile: async (input: { objectKey: string }) => {
		calls.push(`file:${input.objectKey}`)
	},
	appendEvent: async (input: { eventType: string }) => {
		calls.push(`event:${input.eventType}`)
	}
})

describe("ClawHub content rights staff API", () => {
	it("requires the shared ClawHub-Hermit bearer token", async () => {
		const response = await handleContentRightsApi(
			new Request("https://forms.openclaw.ai/api/clawhub-content-rights/cases/CHR-000007"),
			dependencies()
		)

		expect(response.status).toBe(401)
	})

	it("returns existing case context but cannot create a case", async () => {
		const response = await handleContentRightsApi(
			new Request("https://forms.openclaw.ai/api/clawhub-content-rights/cases/CHR-000007", {
				headers: { Authorization: "Bearer secret" }
			}),
			dependencies()
		)
		const missing = await handleContentRightsApi(
			new Request("https://forms.openclaw.ai/api/clawhub-content-rights/cases/CHR-999999", {
				method: "POST",
				headers: { Authorization: "Bearer secret" }
			}),
			dependencies()
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual(existingCase)
		expect(missing.status).toBe(404)
	})

	it("stores the exact correspondence record and attachments for an existing case", async () => {
		const calls: string[] = []
		const body = new FormData()
		body.set("direction", "outbound")
		body.set("to", "legal@example.com")
		body.set("from", "ClawHub <noreply@example.com>")
		body.set("subject", "Re: CHR-000007")
		body.set("text", "Exact email body")
		body.set("providerMessageId", "email-123")
		body.append("attachments", new File(["pdf"], "response.pdf", { type: "application/pdf" }))

		const response = await handleContentRightsApi(
			new Request("https://forms.openclaw.ai/api/clawhub-content-rights/cases/CHR-000007/correspondence", {
				method: "POST",
				headers: { Authorization: "Bearer secret" },
				body
			}),
			dependencies(calls)
		)

		expect(response.status).toBe(201)
		expect(await response.json()).toEqual({ ok: true, caseId: "CHR-000007", storedFiles: 2 })
		expect(calls).toEqual([
			"store:correspondence.json",
			"file:cases/CHR-000007/correspondence/correspondence.json",
			"store:response.pdf",
			"file:cases/CHR-000007/correspondence/response.pdf",
			"event:correspondence_stored"
		])
	})
})
