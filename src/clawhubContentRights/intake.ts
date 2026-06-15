export const maxEvidenceFiles = 10
export const maxEvidenceFileBytes = 20 * 1024 * 1024

const canonicalSkillUrl = (value: string) => {
	const url = new URL(value)
	const segments = url.pathname.split("/").filter(Boolean)
	if (
		url.protocol !== "https:" ||
		url.hostname !== "clawhub.ai" ||
		segments.length !== 2
	) {
		throw new Error("Every URL must identify a skill on clawhub.ai.")
	}
	return `https://clawhub.ai/${segments.map(encodeURIComponent).join("/")}`
}

export const normalizeClawhubUrls = (value: string) => {
	const urls = value
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter(Boolean)
		.map(canonicalSkillUrl)
	return [...new Set(urls)]
}

export const validateEvidenceFiles = (files: File[]) => {
	if (files.length > maxEvidenceFiles) {
		return `Attach no more than ${maxEvidenceFiles} files.`
	}
	if (files.some((file) => file.size > maxEvidenceFileBytes)) {
		return "Each attachment must be 20 MB or smaller."
	}
	return null
}

export type ContentRightsIntake = {
	requesterName: string
	organization: string
	email: string
	clawhubUrls: string[]
	explanation: string
}

const formText = (body: FormData, key: string) => {
	const value = body.get(key)
	return typeof value === "string" ? value.trim() : ""
}

export const parseContentRightsFormData = (body: FormData): {
	value: ContentRightsIntake | null
	files: File[]
	error: string | null
} => {
	const requesterName = formText(body, "requesterName")
	const organization = formText(body, "organization")
	const email = formText(body, "email").toLowerCase()
	const rawUrls = formText(body, "clawhubUrls")
	const explanation = formText(body, "explanation")
	const files = body
		.getAll("attachments")
		.filter((value): value is File => value instanceof File && Boolean(value.name))

	for (const [label, value] of [
		["Your name", requesterName],
		["Organization", organization],
		["Email address", email],
		["ClawHub URLs", rawUrls],
		["Explanation", explanation]
	]) {
		if (!value) {
			return { value: null, files, error: `${label} is required.` }
		}
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return { value: null, files, error: "Enter a valid email address." }
	}
	let clawhubUrls: string[]
	try {
		clawhubUrls = normalizeClawhubUrls(rawUrls)
	} catch (error) {
		return {
			value: null,
			files,
			error: error instanceof Error ? error.message : "Enter valid ClawHub URLs."
		}
	}
	const fileError = validateEvidenceFiles(files)
	if (fileError) {
		return { value: null, files, error: fileError }
	}
	return {
		value: { requesterName, organization, email, clawhubUrls, explanation },
		files,
		error: null
	}
}

export const contentRightsCaseId = (submissionId: number) =>
	`CHR-${String(submissionId).padStart(6, "0")}`

const safeFileName = (name: string) => {
	const normalized = name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
	return normalized || "attachment"
}

const sha256 = async (bytes: ArrayBuffer) => {
	const digest = await crypto.subtle.digest("SHA-256", bytes)
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
}

export const storeEvidenceFile = async (
	bucket: R2Bucket,
	caseId: string,
	kind: "intake" | "correspondence",
	file: File,
	nonce = crypto.randomUUID()
) => {
	const bytes = await file.arrayBuffer()
	const contentType = file.type || "application/octet-stream"
	const objectKey = `cases/${caseId}/${kind}/${nonce}-${safeFileName(file.name)}`
	const hash = await sha256(bytes)
	await bucket.put(objectKey, bytes, {
		httpMetadata: { contentType },
		customMetadata: {
			caseId,
			kind,
			originalName: file.name,
			sha256: hash
		}
	})
	return {
		objectKey,
		originalName: file.name,
		contentType,
		sizeBytes: file.size,
		sha256: hash
	}
}
