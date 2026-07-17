import { createHash } from "node:crypto"
import { access, readFile, readdir } from "node:fs/promises"
import { basename, relative, resolve, sep } from "node:path"
import type { ArtworkManifest, ArtworkManifestEntry } from "./lobster-artwork-plan.js"

export const REMEDIATION_PATH =
	"data/lobster/artwork/remediation.json" as const
export const GENERATION_RESULTS_PATH =
	"data/lobster/artwork/generation-results.json" as const
export const QA_REPORT_PATH =
	"data/lobster/artwork/qa-report.json" as const
export const DEFAULT_GENERATION_LOG_ROOT = "tmp/imagegen/lobster" as const
export const EXECUTION_DELIVERY_NOTE =
	"Execution-only delivery note: generate the source at 1536x1024; it will be downscaled to the requested exact 768x512 final WebP." as const

export type RemediationBinding = {
	id: string
	version: string
	sha256: string
}

export type RemediationEntry = RemediationBinding & {
	sceneId: string
	reason: string
	auditStatus: "pending-regeneration"
	promptSuffix: string
}

export type RemediationRegistry = {
	schemaVersion: 1
	groups: Array<{
		id: string
		version: string
		sha256: string
		entries: RemediationEntry[]
	}>
}

export type DurableGenerationRecord = {
	batchId: string
	sceneId: string
	AphiaID: number
	outputPath: string
	status: "generated"
	model: "gpt-image-2"
	generatorPath: string
	requestedSize: "1536x1024"
	quality: "low" | "medium"
	sourceOutput: {
		format: "webp"
		compression: 100
	}
	promptVersion: string
	promptSha256: string
	executionPromptSha256: string
	remediation: RemediationBinding | null
	generatedAt: string
	finalSha256: string
	finalBytes: number
	dimensions: {
		width: 768
		height: 512
		format: "webp"
	}
	compression: {
		codec: "cwebp"
		targetBytes: 75000
		maximumBytes: 122880
	}
	attempts: number
	source: {
		logPath: string
		line: number
	}
}

export type GenerationResultsLedger = {
	schemaVersion: 1
	planId: "LOB-ART-PLAN-v1"
	precedence: {
		success: "latest-generatedAt"
		tieBreak: "canonical-record-sha256"
		skipped:
			"accepted-only-when-backed-by-a-valid-generated-record-with-matching-final-sha256"
		failure: "superseded-only-when-a-valid-generated-record-exists"
		filesystemMtimeUsed: false
	}
	sourceImport: {
		logRoot: string
		filesRead: string[]
		malformedLines: string[]
	}
	records: DurableGenerationRecord[]
	skippedObservations: Array<{
		sceneId: string
		finalSha256: string
		source: { logPath: string; line: number }
		backedByGeneratedAt: string
	}>
	supersededFailures: Array<{
		sceneId: string
		error: string | null
		source: { logPath: string; line: number }
		supersededByGeneratedAt: string
	}>
	supersededGenerated: Array<{
		sceneId: string
		error: string | null
		source: { logPath: string; line: number }
		supersededByGeneratedAt: string
	}>
	unresolvedFailures: Array<{
		sceneId: string
		error: string | null
		source: { logPath: string; line: number }
	}>
}

type ImportedRecord = Record<string, unknown> & {
	sceneId: string
	status: "dry-run" | "generated" | "skipped" | "failed"
	source: { logPath: string; line: number }
}

const normalizePath = (path: string) => path.split(sep).join("/")

export const sha256 = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex")

export const serializeJson = (value: unknown) =>
	`${JSON.stringify(value, null, 2)}\n`

const canonicalRecordHash = (record: Record<string, unknown>) =>
	sha256(JSON.stringify(record, Object.keys(record).sort()))

const listJsonlFiles = async (root: string) => {
	try {
		await access(root)
	} catch {
		return []
	}
	const entries = await readdir(root, {
		recursive: true,
		withFileTypes: true
	})
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.map((entry) => resolve(entry.parentPath, entry.name))
		.sort((left, right) => left.localeCompare(right))
}

export const loadRemediationRegistry = async (
	path = REMEDIATION_PATH
): Promise<RemediationRegistry> => {
	const registry = JSON.parse(await readFile(path, "utf8")) as RemediationRegistry
	if (registry.schemaVersion !== 1 || registry.groups.length !== 2) {
		throw new Error("Unexpected lobster remediation registry")
	}
	const sceneIds = new Set<string>()
	for (const group of registry.groups) {
		if (group.sha256 !== sha256(group.entries.map((entry) => entry.sceneId).join("\n"))) {
			throw new Error(`${group.id} scene inventory hash is invalid`)
		}
		for (const entry of group.entries) {
			if (
				entry.id !== group.id ||
				!/^\d+\.\d+\.\d+$/.test(entry.version) ||
				entry.sha256 !== sha256(entry.promptSuffix) ||
				entry.auditStatus !== "pending-regeneration" ||
				sceneIds.has(entry.sceneId)
			) {
				throw new Error(`${entry.sceneId} has invalid remediation metadata`)
			}
			sceneIds.add(entry.sceneId)
		}
	}
	if (sceneIds.size !== 85) {
		throw new Error(`Expected 85 remediation scenes, found ${sceneIds.size}`)
	}
	return registry
}

export const remediationByScene = (registry: RemediationRegistry) =>
	new Map(
		registry.groups.flatMap((group) =>
			group.entries.map((entry) => [entry.sceneId, entry] as const)
		)
	)

export const buildExecutionPrompt = (
	entry: Pick<ArtworkManifestEntry, "sceneId" | "finalPrompt">,
	remediation: RemediationEntry | null
) =>
	[
		entry.finalPrompt,
		...(remediation ? [remediation.promptSuffix] : []),
		EXECUTION_DELIVERY_NOTE
	].join(" ")

const bindingFor = (entry: RemediationEntry | null): RemediationBinding | null =>
	entry
		? {
				id: entry.id,
				version: entry.version,
				sha256: entry.sha256
			}
		: null

const parseImportedLogs = async (root: string) => {
	const files = await listJsonlFiles(root)
	const records: ImportedRecord[] = []
	const malformedLines: string[] = []
	for (const path of files) {
		const logPath = normalizePath(relative(process.cwd(), path))
		const contents = await readFile(path, "utf8")
		for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
			const line = rawLine.trim()
			if (!line) continue
			try {
				const parsed = JSON.parse(line) as Record<string, unknown>
				if (
					typeof parsed.sceneId !== "string" ||
					typeof parsed.status !== "string" ||
					!["dry-run", "generated", "skipped", "failed"].includes(parsed.status)
				) {
					throw new Error("invalid generation result shape")
				}
				records.push({
					...parsed,
					sceneId: parsed.sceneId,
					status: parsed.status as ImportedRecord["status"],
					source: { logPath, line: index + 1 }
				})
			} catch (error) {
				malformedLines.push(
					`${logPath}:${index + 1}: ${
						error instanceof Error ? error.message : String(error)
					}`
				)
			}
		}
	}
	return {
		filesRead: files.map((path) =>
			normalizePath(relative(process.cwd(), path))
		),
		records,
		malformedLines
	}
}

const asGeneratedRecord = (
	record: ImportedRecord,
	entry: ArtworkManifestEntry,
	remediation: RemediationEntry | null
): DurableGenerationRecord => {
	const generatedAt = record.generatedAt
	if (
		record.status !== "generated" ||
		typeof generatedAt !== "string" ||
		Number.isNaN(Date.parse(generatedAt)) ||
		typeof record.finalSha256 !== "string" ||
		typeof record.finalBytes !== "number"
	) {
		throw new Error(`${entry.sceneId} has an invalid generated result`)
	}
	const recordedRemediation =
		record.remediation === undefined
			? null
			: (record.remediation as RemediationBinding | null)
	const expectedRemediation = recordedRemediation ? remediation : null
	if (
		recordedRemediation &&
		(!expectedRemediation ||
			JSON.stringify(recordedRemediation) !==
				JSON.stringify(bindingFor(expectedRemediation)))
	) {
		throw new Error(`${entry.sceneId} remediation binding is invalid`)
	}
	const executionPromptSha256 =
		typeof record.executionPromptSha256 === "string"
			? record.executionPromptSha256
			: sha256(buildExecutionPrompt(entry, expectedRemediation))
	if (
		executionPromptSha256 !==
		sha256(buildExecutionPrompt(entry, expectedRemediation))
	) {
		throw new Error(`${entry.sceneId} execution prompt checksum is invalid`)
	}
	return {
		batchId: String(record.batchId),
		sceneId: entry.sceneId,
		AphiaID: Number(record.AphiaID),
		outputPath: String(record.outputPath),
		status: "generated",
		model: "gpt-image-2",
		generatorPath: String(record.generatorPath),
		requestedSize: "1536x1024",
		quality: record.quality === "low" ? "low" : "medium",
		sourceOutput: { format: "webp", compression: 100 },
		promptVersion: String(record.promptVersion),
		promptSha256: String(record.promptSha256),
		executionPromptSha256,
		remediation: bindingFor(expectedRemediation),
		generatedAt,
		finalSha256: record.finalSha256,
		finalBytes: record.finalBytes,
		dimensions: { width: 768, height: 512, format: "webp" },
		compression: {
			codec: "cwebp",
			targetBytes: 75000,
			maximumBytes: 122880
		},
		attempts: Number(record.attempts),
		source: record.source
	}
}

export const importGenerationResults = async (
	manifest: ArtworkManifest,
	options: {
		logRoot?: string
		existing?: GenerationResultsLedger | null
		remediation: RemediationRegistry
	}
): Promise<GenerationResultsLedger> => {
	const logRoot = options.logRoot ?? DEFAULT_GENERATION_LOG_ROOT
	const imported = await parseImportedLogs(logRoot)
	if (imported.malformedLines.length > 0) {
		throw new Error(
			`Cannot import malformed generation logs: ${imported.malformedLines[0]}`
		)
	}
	const entries = new Map(
		manifest.entries.map((entry) => [entry.sceneId, entry])
	)
	const remediations = remediationByScene(options.remediation)
	const generatedByScene = new Map<string, DurableGenerationRecord[]>()
	const invalidGenerated: GenerationResultsLedger["unresolvedFailures"] = []
	const addGeneratedCandidate = (record: ImportedRecord) => {
		const entry = entries.get(record.sceneId)
		if (!entry) throw new Error(`Unknown generated scene ${record.sceneId}`)
		try {
			const generated = asGeneratedRecord(
				record,
				entry,
				remediations.get(record.sceneId) ?? null
			)
			const candidates = generatedByScene.get(record.sceneId) ?? []
			candidates.push(generated)
			generatedByScene.set(record.sceneId, candidates)
		} catch (error) {
			invalidGenerated.push({
				sceneId: record.sceneId,
				source: record.source,
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}
	for (const record of imported.records.filter(
		(candidate) => candidate.status === "generated"
	)) {
		addGeneratedCandidate(record)
	}
	for (const record of options.existing?.records ?? []) {
		addGeneratedCandidate(record as unknown as ImportedRecord)
	}
	const records = [...generatedByScene.values()]
		.map((candidates) =>
			candidates.toSorted(
				(left, right) =>
					Date.parse(right.generatedAt) - Date.parse(left.generatedAt) ||
					canonicalRecordHash(right).localeCompare(canonicalRecordHash(left))
			)[0]!
		)
		.sort((left, right) => left.sceneId.localeCompare(right.sceneId))
	const authoritative = new Map(
		records.map((record) => [record.sceneId, record])
	)
	const skippedObservations: GenerationResultsLedger["skippedObservations"] = []
	const unsupportedSkips: GenerationResultsLedger["unresolvedFailures"] = []
	for (const record of imported.records.filter(
		(candidate) => candidate.status === "skipped"
	)) {
		const generated = authoritative.get(record.sceneId)
		if (!generated) {
			unsupportedSkips.push({
				sceneId: record.sceneId,
				source: record.source,
				error: "skipped result lacks matching generated provenance"
			})
			continue
		}
		if (record.finalSha256 !== generated.finalSha256) continue
		skippedObservations.push({
			sceneId: record.sceneId,
			finalSha256: generated.finalSha256,
			source: record.source,
			backedByGeneratedAt: generated.generatedAt
		})
	}
	skippedObservations.sort(
			(left, right) =>
				left.sceneId.localeCompare(right.sceneId) ||
				left.source.logPath.localeCompare(right.source.logPath) ||
				left.source.line - right.source.line
		)
	const failures = imported.records.filter(
		(record) => record.status === "failed"
	)
	const supersededFailures: GenerationResultsLedger["supersededFailures"] = []
	const supersededGenerated: GenerationResultsLedger["supersededGenerated"] = []
	const unresolvedFailures: GenerationResultsLedger["unresolvedFailures"] = [
		...unsupportedSkips
	]
	for (const invalid of invalidGenerated) {
		const generated = authoritative.get(invalid.sceneId)
		if (generated) {
			supersededGenerated.push({
				...invalid,
				supersededByGeneratedAt: generated.generatedAt
			})
		} else {
			unresolvedFailures.push(invalid)
		}
	}
	for (const failure of failures) {
		const generated = authoritative.get(failure.sceneId)
		const base = {
			sceneId: failure.sceneId,
			error: typeof failure.error === "string" ? failure.error : null,
			source: failure.source
		}
		if (generated) {
			supersededFailures.push({
				...base,
				supersededByGeneratedAt: generated.generatedAt
			})
		} else {
			unresolvedFailures.push(base)
		}
	}
	return {
		schemaVersion: 1,
		planId: "LOB-ART-PLAN-v1",
		precedence: {
			success: "latest-generatedAt",
			tieBreak: "canonical-record-sha256",
			skipped:
				"accepted-only-when-backed-by-a-valid-generated-record-with-matching-final-sha256",
			failure: "superseded-only-when-a-valid-generated-record-exists",
			filesystemMtimeUsed: false
		},
		sourceImport: {
			logRoot,
			filesRead: imported.filesRead,
			malformedLines: imported.malformedLines
		},
		records,
		skippedObservations,
		supersededFailures: supersededFailures.sort((left, right) =>
			`${left.sceneId}:${left.source.logPath}:${left.source.line}`.localeCompare(
				`${right.sceneId}:${right.source.logPath}:${right.source.line}`
			)
		),
		supersededGenerated: supersededGenerated.sort((left, right) =>
			`${left.sceneId}:${left.source.logPath}:${left.source.line}`.localeCompare(
				`${right.sceneId}:${right.source.logPath}:${right.source.line}`
			)
		),
		unresolvedFailures: unresolvedFailures.sort((left, right) =>
			`${left.sceneId}:${left.source.logPath}:${left.source.line}`.localeCompare(
				`${right.sceneId}:${right.source.logPath}:${right.source.line}`
			)
		)
	}
}

export const validateTrackedLedger = (
	manifest: ArtworkManifest,
	ledger: GenerationResultsLedger,
	options: { requireComplete?: boolean } = {}
) => {
	if (
		ledger.schemaVersion !== 1 ||
		ledger.planId !== manifest.planId ||
		ledger.precedence.filesystemMtimeUsed !== false ||
		((options.requireComplete ?? true) &&
			ledger.records.length !== manifest.entries.length) ||
		ledger.unresolvedFailures.length !== 0
	) {
		throw new Error("Tracked generation-results ledger is incomplete")
	}
	const byScene = new Map(ledger.records.map((record) => [record.sceneId, record]))
	for (const entry of manifest.entries) {
		const record = byScene.get(entry.sceneId)
		if (!record && options.requireComplete === false) continue
		if (
			!record ||
			record.status !== "generated" ||
			record.promptVersion !== entry.promptVersion ||
			record.promptSha256 !== entry.promptSha256 ||
			record.outputPath !== entry.outputPath ||
			Number.isNaN(Date.parse(record.generatedAt))
		) {
			throw new Error(`${entry.sceneId} lacks valid tracked generated provenance`)
		}
	}
	return byScene
}
