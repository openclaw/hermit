import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import {
	dryRunEntry,
	failedGenerationResult,
	generateEntry,
	loadGenerationPlan,
	preflightGenerationTools,
	type GenerationQuality,
	type GenerationResult
} from "./lib/lobster-art-generation.js"

type Options = {
	batchId: string
	sceneIds: string[]
	quality: GenerationQuality
	maxAttempts: number
	dryRun: boolean
	resultsPath: string | null
	force: boolean
	all: boolean
}

const usage = [
	"usage: bun scripts/generate-lobster-art.ts --batch <batch-id> [options]",
	"",
	"options:",
	"  --scene <scene-id>       restrict to one scene; repeat for a bounded subset",
	"  --all                    process every scene in the selected batch",
	"  --quality <low|medium>   generation quality (default: medium)",
	"  --max-attempts <count>   provider attempts per scene (default: 3)",
	"  --results <path>         append one JSON result record per scene",
	"  --force                  regenerate even when the current final validates",
	"  --dry-run                validate selection and CLI payload without API calls"
].join("\n")

const requiredValue = (args: string[], index: number, option: string) => {
	const value = args[index + 1]
	if (!value || value.startsWith("--")) {
		throw new Error(`${option} requires a value`)
	}
	return value
}

const parseOptions = (args: string[]): Options => {
	let batchId = ""
	const sceneIds: string[] = []
	let quality: GenerationQuality = "medium"
	let maxAttempts = 3
	let dryRun = false
	let resultsPath: string | null = null
	let force = false
	let all = false

	for (let index = 0; index < args.length; index++) {
		const option = args[index]
		if (option === "--batch") {
			batchId = requiredValue(args, index, option)
			index++
		} else if (option === "--scene") {
			sceneIds.push(requiredValue(args, index, option))
			index++
		} else if (option === "--quality") {
			const value = requiredValue(args, index, option)
			if (value !== "low" && value !== "medium") {
				throw new Error("--quality must be low or medium")
			}
			quality = value
			index++
		} else if (option === "--max-attempts") {
			const value = Number(requiredValue(args, index, option))
			if (!Number.isInteger(value) || value < 1 || value > 5) {
				throw new Error("--max-attempts must be an integer from 1 to 5")
			}
			maxAttempts = value
			index++
		} else if (option === "--results") {
			resultsPath = requiredValue(args, index, option)
			index++
		} else if (option === "--dry-run") {
			dryRun = true
		} else if (option === "--force") {
			force = true
		} else if (option === "--all") {
			all = true
		} else if (option === "--help" || option === "-h") {
			console.log(usage)
			process.exit(0)
		} else {
			throw new Error(`Unknown option: ${option}`)
		}
	}

	if (!batchId) {
		throw new Error("--batch is required")
	}
	if (new Set(sceneIds).size !== sceneIds.length) {
		throw new Error("--scene values must be unique")
	}
	if (all === (sceneIds.length > 0)) {
		throw new Error("choose exactly one of --all or one or more --scene values")
	}
	return {
		batchId,
		sceneIds,
		quality,
		maxAttempts,
		dryRun,
		resultsPath,
		force,
		all
	}
}

const writeResult = async (
	result: GenerationResult,
	resultsPath: string | null
) => {
	const line = `${JSON.stringify(result)}\n`
	process.stdout.write(line)
	if (resultsPath) {
		await mkdir(dirname(resultsPath), { recursive: true })
		await appendFile(resultsPath, line)
	}
}

const main = async () => {
	const options = parseOptions(Bun.argv.slice(2))
	await preflightGenerationTools()
	const plan = await loadGenerationPlan({
		batchId: options.batchId,
		sceneIds: options.sceneIds
	})

	let failed = 0
	for (const entry of plan.entries) {
		try {
			const result = options.dryRun
				? await dryRunEntry(
						plan.batchId,
						entry,
						plan.remediations.get(entry.sceneId) ?? null,
						options.quality
					)
				: await generateEntry(
						plan.batchId,
						entry,
						plan.remediations.get(entry.sceneId) ?? null,
						options.quality,
						options.maxAttempts,
						options.force
					)
			await writeResult(result, options.resultsPath)
		} catch (error) {
			failed++
			await writeResult(
				failedGenerationResult(
					plan.batchId,
					entry,
					plan.remediations.get(entry.sceneId) ?? null,
					options.quality,
					options.maxAttempts,
					error
				),
				options.resultsPath
			)
		}
	}

	if (failed > 0) {
		throw new Error(`${failed} scene generation job(s) failed`)
	}
}

if (import.meta.main) {
	await main()
}
