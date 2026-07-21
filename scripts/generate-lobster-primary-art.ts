#!/usr/bin/env bun

import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import {
	loadPrimaryPlan,
	selectPrimaryEntries
} from "./lib/lobster-primary-art-contract.js"
import {
	dryRunPrimaryEntry,
	failedPrimaryGenerationResult,
	generatePrimaryEntry,
	preflightPrimaryGeneration,
	type PrimaryGenerationQuality,
	type PrimaryGenerationResult
} from "./lib/lobster-primary-art-generation.js"

type Options = {
	batchId: string
	sceneIds: string[]
	all: boolean
	quality: PrimaryGenerationQuality
	dryRun: boolean
	force: boolean
	resultsPath: string | null
	maxAttempts: number
	manifestPath: string | undefined
	batchesPath: string | undefined
}

const usage = `Usage:
  bun scripts/generate-lobster-primary-art.ts --batch <id> (--all | --scene <id> [...]) [options]

Options:
  --quality <low|medium>  Generation quality (default: medium)
  --dry-run               Validate selection and image_gen.py requests only
  --force                 Replace an existing valid asset
  --results <path>        Append JSONL result records
  --max-attempts <1-5>    Provider attempts per scene (default: 3)
  --manifest <path>        Primary plan path
  --batches <path>         Primary batches path
`

const readValue = (args: string[], index: number, flag: string) => {
	const value = args[index + 1]
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
	return value
}

export const parsePrimaryGenerationArguments = (args: string[]): Options => {
	let batchId = ""
	const sceneIds: string[] = []
	let all = false
	let quality: PrimaryGenerationQuality = "medium"
	let dryRun = false
	let force = false
	let resultsPath: string | null = null
	let maxAttempts = 3
	let manifestPath: string | undefined
	let batchesPath: string | undefined

	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index]
		if (flag === "--batch") {
			batchId = readValue(args, index, flag)
			index += 1
		} else if (flag === "--scene") {
			sceneIds.push(readValue(args, index, flag))
			index += 1
		} else if (flag === "--all") {
			all = true
		} else if (flag === "--quality") {
			const value = readValue(args, index, flag)
			if (value !== "low" && value !== "medium") {
				throw new Error("--quality must be low or medium")
			}
			quality = value
			index += 1
		} else if (flag === "--dry-run") {
			dryRun = true
		} else if (flag === "--force") {
			force = true
		} else if (flag === "--results") {
			resultsPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--max-attempts") {
			maxAttempts = Number(readValue(args, index, flag))
			if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
				throw new Error("--max-attempts must be an integer from 1 to 5")
			}
			index += 1
		} else if (flag === "--manifest") {
			manifestPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--batches") {
			batchesPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--help" || flag === "-h") {
			console.log(usage)
			process.exit(0)
		} else {
			throw new Error(`unknown argument: ${flag}`)
		}
	}
	if (!batchId) throw new Error("--batch is required")
	if (all === (sceneIds.length > 0)) {
		throw new Error("choose exactly one of --all or one or more --scene values")
	}
	if (new Set(sceneIds).size !== sceneIds.length) {
		throw new Error("--scene values must be unique")
	}
	return {
		batchId,
		sceneIds,
		all,
		quality,
		dryRun,
		force,
		resultsPath,
		maxAttempts,
		manifestPath,
		batchesPath
	}
}

const writeResult = async (
	result: PrimaryGenerationResult,
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
	const options = parsePrimaryGenerationArguments(Bun.argv.slice(2))
	const plan = await loadPrimaryPlan({
		manifestPath: options.manifestPath,
		batchesPath: options.batchesPath
	})
	const entries = selectPrimaryEntries(
		plan,
		options.batchId,
		options.sceneIds,
		options.all
	)
	await preflightPrimaryGeneration(options.dryRun)

	let failures = 0
	for (const entry of entries) {
		try {
			const result = options.dryRun
				? await dryRunPrimaryEntry(options.batchId, entry, options.quality)
				: await generatePrimaryEntry(
						options.batchId,
						entry,
						options.quality,
						options.force,
						options.maxAttempts
					)
			await writeResult(result, options.resultsPath)
		} catch (error) {
			failures += 1
			await writeResult(
				failedPrimaryGenerationResult(
					options.batchId,
					entry,
					options.quality,
					error
				),
				options.resultsPath
			)
		}
	}
	if (failures > 0) {
		throw new Error(`${failures} primary generation job(s) failed`)
	}
}

if (import.meta.main) {
	try {
		await main()
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		console.error(usage)
		process.exitCode = 1
	}
}
