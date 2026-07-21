#!/usr/bin/env bun

import { runPrimaryArtQa } from "./lib/lobster-primary-art-qa.js"

const usage = `Usage:
  bun scripts/qa-lobster-primary-art.ts [options]

Options:
  --manifest <path>  Primary manifest path
  --batches <path>   Primary batches path
  --results <path>   Finalized checksum/byte ledger (required for a pass)
  --report <path>    Write a machine-readable QA report
`

const readValue = (args: string[], index: number, flag: string) => {
	const value = args[index + 1]
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
	return value
}

export const parsePrimaryQaArguments = (args: string[]) => {
	let manifestPath: string | undefined
	let batchesPath: string | undefined
	let resultsPath: string | undefined
	let reportPath: string | undefined
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index]
		if (flag === "--manifest") {
			manifestPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--batches") {
			batchesPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--results") {
			resultsPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--report") {
			reportPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--help" || flag === "-h") {
			console.log(usage)
			process.exit(0)
		} else {
			throw new Error(`unknown argument: ${flag}`)
		}
	}
	return { manifestPath, batchesPath, resultsPath, reportPath }
}

if (import.meta.main) {
	try {
		const report = await runPrimaryArtQa(
			parsePrimaryQaArguments(Bun.argv.slice(2))
		)
		console.log(
			JSON.stringify({
				passed: report.passed,
				summary: report.summary,
				failedCriteria: report.criteria
					.filter(({ status }) => status === "fail")
					.map(({ id }) => id)
			})
		)
		if (!report.passed) process.exitCode = 1
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		console.error(usage)
		process.exitCode = 1
	}
}
