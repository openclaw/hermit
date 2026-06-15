import {
	appendContentRightsEvent,
	getContentRightsCaseBundle,
	recordContentRightsFile
} from "./cases.js"
import { storeEvidenceFile, validateEvidenceFiles } from "./intake.js"
import { getRuntimeEnv } from "../runtime/env.js"

type StoredEvidence = {
	objectKey: string
	originalName: string
	contentType: string
	sizeBytes: number
	sha256: string
}

type ContentRightsApiDependencies = {
	token: string
	getCase: (caseId: string) => Promise<unknown | null>
	storeFile: (caseId: string, kind: "correspondence", file: File) => Promise<StoredEvidence>
	recordFile: (input: StoredEvidence & { caseId: string; kind: "correspondence" }) => Promise<void>
	appendEvent: (input: {
		caseId: string
		eventType: string
		actor?: string | null
		metadata: Record<string, unknown>
	}) => Promise<void>
}

const apiPrefix = "/api/clawhub-content-rights/cases/"

const jsonResponse = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" }
	})

const bearerToken = (request: Request) =>
	request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""

const formText = (body: FormData, key: string) => {
	const value = body.get(key)
	return typeof value === "string" ? value.trim() : ""
}

export const handleContentRightsApi = async (
	request: Request,
	dependencies: ContentRightsApiDependencies
) => {
	const url = new URL(request.url)
	if (!url.pathname.startsWith(apiPrefix)) {
		return null
	}
	if (!dependencies.token || bearerToken(request) !== dependencies.token) {
		return jsonResponse({ error: "Unauthorized" }, 401)
	}
	const path = url.pathname.slice(apiPrefix.length).split("/").filter(Boolean)
	const caseId = path[0] ?? ""
	const contentRightsCase = caseId ? await dependencies.getCase(caseId) : null
	if (!contentRightsCase) {
		return jsonResponse({ error: "Case not found" }, 404)
	}
	if (request.method === "GET" && path.length === 1) {
		return jsonResponse(contentRightsCase)
	}
	if (request.method !== "POST" || path[1] !== "correspondence" || path.length !== 2) {
		return jsonResponse({ error: "Method not allowed" }, 405)
	}
	const body = await request.formData()
	const correspondence = {
		direction: formText(body, "direction"),
		to: formText(body, "to"),
		from: formText(body, "from"),
		subject: formText(body, "subject"),
		text: formText(body, "text"),
		providerMessageId: formText(body, "providerMessageId")
	}
	if (
		!["inbound", "outbound"].includes(correspondence.direction) ||
		!correspondence.to ||
		!correspondence.from ||
		!correspondence.subject ||
		!correspondence.text
	) {
		return jsonResponse({ error: "direction, to, from, subject, and text are required" }, 400)
	}
	const attachments = body
		.getAll("attachments")
		.filter((value): value is File => value instanceof File && Boolean(value.name))
	const fileError = validateEvidenceFiles(attachments)
	if (fileError) {
		return jsonResponse({ error: fileError }, 400)
	}
	const exactRecord = new File(
		[JSON.stringify(correspondence, null, 2)],
		"correspondence.json",
		{ type: "application/json" }
	)
	const files = [exactRecord, ...attachments]
	const storedFiles: StoredEvidence[] = []
	for (const file of files) {
		const stored = await dependencies.storeFile(caseId, "correspondence", file)
		await dependencies.recordFile({ caseId, kind: "correspondence", ...stored })
		storedFiles.push(stored)
	}
	await dependencies.appendEvent({
		caseId,
		eventType: "correspondence_stored",
		actor: formText(body, "actor") || null,
		metadata: {
			direction: correspondence.direction,
			to: correspondence.to,
			from: correspondence.from,
			subject: correspondence.subject,
			providerMessageId: correspondence.providerMessageId || null,
			files: storedFiles
		}
	})
	return jsonResponse({ ok: true, caseId, storedFiles: storedFiles.length }, 201)
}

export const handleContentRightsApiRequest = (request: Request) => {
	const env = getRuntimeEnv()
	return handleContentRightsApi(request, {
		token: env.CLAWHUB_BAN_APPEALS_TOKEN,
		getCase: getContentRightsCaseBundle,
		storeFile: (caseId, kind, file) =>
			storeEvidenceFile(env.CLAWHUB_CASE_FILES, caseId, kind, file),
		recordFile: recordContentRightsFile,
		appendEvent: appendContentRightsEvent
	})
}
