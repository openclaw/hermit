#!/usr/bin/env bun

import { importPrimaryArtResults } from "./lib/lobster-primary-art-results.js"

const usage = `Usage:
  bun scripts/finalize-lobster-primary-art.ts --results <jsonl> [options]

Options:
  --manifest <path>  Primary manifest path
  --batches <path>   Primary batches path
  --output <path>    Finalized checksum/byte ledger path
  --verify           Validate without writing the finalized ledger
`

const readValue = (args: string[], index: number, flag: string) => {
	const value = args[index + 1]
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
	return value
}

const parseArguments = (args: string[]) => {
	let resultsPath = ""
	let manifestPath: string | undefined
	let batchesPath: string | undefined
	let outputPath: string | undefined
	let write = true
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index]
		if (flag === "--results") {
			resultsPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--manifest") {
			manifestPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--batches") {
			batchesPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--output") {
			outputPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--verify") {
			write = false
		} else if (flag === "--help" || flag === "-h") {
			console.log(usage)
			process.exit(0)
		} else {
			throw new Error(`unknown argument: ${flag}`)
		}
	}
	if (!resultsPath) throw new Error("--results is required")
	return { resultsPath, manifestPath, batchesPath, outputPath, write }
}

if (import.meta.main) {
	try {
		const result = await importPrimaryArtResults(
			parseArguments(Bun.argv.slice(2))
		)
		console.log(
			`${result.ledger.records.length} primary asset result(s) ${
				Bun.argv.includes("--verify") ? "verified" : "imported"
			} at ${result.outputPath}`
		)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		console.error(usage)
		process.exitCode = 1
	}
}
