import { formConfigs } from "../../forms.config.js"

export const contentRightsFormId = "clawhub-content-rights"

/** Limits for the staff correspondence API. */
export const maxEvidenceFiles = 10
export const maxEvidenceFileBytes = 20 * 1024 * 1024

/** Limits for the public, unauthenticated intake form. */
export const contentRightsLimits = {
	requesterNameMaxLength: 120,
	organizationMaxLength: 120,
	emailMaxLength: 254,
	explanationMaxLength: 2000,
	maxClawhubUrls: 10,
	clawhubUrlMaxLength: 300,
	clawhubUrlsFieldMaxLength: 4000,
	maxEvidenceFiles: 5,
	maxEvidenceFileBytes: 20 * 1024 * 1024,
	maxEvidenceTotalBytes: 25 * 1024 * 1024,
	evidenceFileNameMaxLength: 200
} as const

const invalidSkillUrlMessage = "Every URL must identify a skill on clawhub.ai."

// C0/C1 controls, line/paragraph separators, and bidi overrides.
const singleLineUnsafeCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/
// Same as above, but tab, LF, and CR are allowed in multi-line fields.
const multiLineUnsafeCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

export const parseAcceptExtensions = (accept: string) => [
	...new Set(
		accept
			.split(",")
			.map((item) => item.trim().toLowerCase())
			.filter((item) => /^\.[a-z0-9]+$/.test(item))
	)
]

const contentRightsAttachmentAccept = () => {
	const form = formConfigs.find((item) => item.id === contentRightsFormId)
	const field = form?.fields.find((item) => item.id === "attachments")
	return field?.type === "file" ? field.accept ?? "" : ""
}

/** Derived from the form's `accept` list in forms.config.ts; empty means no uploads are accepted. */
export const allowedEvidenceExtensions = parseAcceptExtensions(contentRightsAttachmentAccept())

const fileExtension = (name: string) => {
	const index = name.lastIndexOf(".")
	return index > 0 ? name.slice(index).toLowerCase() : ""
}

const canonicalSkillUrl = (value: string) => {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error(invalidSkillUrlMessage)
	}
	const segments = url.pathname.split("/").filter(Boolean)
	const isLegacySkillRoute = segments.length === 2
	const isCurrentSkillRoute = segments.length === 3 && segments[1] === "skills"
	if (
		url.protocol !== "https:" ||
		url.hostname !== "clawhub.ai" ||
		(!isLegacySkillRoute && !isCurrentSkillRoute)
	) {
		throw new Error(invalidSkillUrlMessage)
	}
	return `https://clawhub.ai/${segments.map(encodeURIComponent).join("/")}`
}

export const normalizeClawhubUrls = (value: string) => {
	const lines = value
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter(Boolean)
	if (lines.length > contentRightsLimits.maxClawhubUrls) {
		throw new Error(`List no more than ${contentRightsLimits.maxClawhubUrls} ClawHub URLs.`)
	}
	if (lines.some((line) => line.length > contentRightsLimits.clawhubUrlMaxLength)) {
		throw new Error(`Each ClawHub URL must be ${contentRightsLimits.clawhubUrlMaxLength} characters or fewer.`)
	}
	return [...new Set(lines.map(canonicalSkillUrl))]
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

const megabytes = (bytes: number) => `${Math.floor(bytes / (1024 * 1024))} MB`

export const validateIntakeEvidenceFiles = (
	files: File[],
	allowedExtensions: readonly string[] = allowedEvidenceExtensions
) => {
	const limits = contentRightsLimits
	if (files.length > limits.maxEvidenceFiles) {
		return `Attach no more than ${limits.maxEvidenceFiles} files.`
	}
	let totalBytes = 0
	for (const file of files) {
		if (
			file.name.length > limits.evidenceFileNameMaxLength ||
			/[\\/]/.test(file.name) ||
			singleLineUnsafeCharacters.test(file.name)
		) {
			return "Attachment names must be plain file names."
		}
		if (!allowedExtensions.includes(fileExtension(file.name))) {
			return allowedExtensions.length
				? `Attachments must be one of these file types: ${allowedExtensions.join(", ")}.`
				: "Attachments are not accepted for this form."
		}
		if (file.size > limits.maxEvidenceFileBytes) {
			return `Each attachment must be ${megabytes(limits.maxEvidenceFileBytes)} or smaller.`
		}
		totalBytes += file.size
	}
	if (totalBytes > limits.maxEvidenceTotalBytes) {
		return `Attachments must total ${megabytes(limits.maxEvidenceTotalBytes)} or less.`
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
	for (const [label, value, maxLength] of [
		["Your name", requesterName, contentRightsLimits.requesterNameMaxLength],
		["Organization", organization, contentRightsLimits.organizationMaxLength],
		["Email address", email, contentRightsLimits.emailMaxLength],
		["ClawHub URLs", rawUrls, contentRightsLimits.clawhubUrlsFieldMaxLength],
		["Explanation", explanation, contentRightsLimits.explanationMaxLength]
	] as const) {
		if (value.length > maxLength) {
			return { value: null, files, error: `${label} must be ${maxLength} characters or fewer.` }
		}
	}
	for (const [label, value] of [
		["Your name", requesterName],
		["Organization", organization],
		["Email address", email]
	] as const) {
		if (singleLineUnsafeCharacters.test(value)) {
			return { value: null, files, error: `${label} contains unsupported characters.` }
		}
	}
	for (const [label, value] of [
		["ClawHub URLs", rawUrls],
		["Explanation", explanation]
	] as const) {
		if (multiLineUnsafeCharacters.test(value)) {
			return { value: null, files, error: `${label} contains unsupported characters.` }
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
	const fileError = validateIntakeEvidenceFiles(files)
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
