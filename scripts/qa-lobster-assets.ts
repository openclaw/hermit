#!/usr/bin/env bun

import { runLobsterAssetQa } from "./lib/lobster-asset-qa.js"
import {
	GENERATION_RESULTS_PATH,
	QA_REPORT_PATH
} from "./lib/lobster-art-evidence.js"

const usage = `Usage:
  bun scripts/qa-lobster-assets.ts --mode partial|strict --report <path>

Options:
  --mode <mode>                 partial for active generation, strict for release
  --report <path>               machine-readable JSON report path (default: tracked qa-report.json)
  --generation-results <path>   tracked generation ledger (default: tracked generation-results.json)
  --near-duplicate-threshold N  dHash Hamming threshold (default: 5)
  --concurrency N               image inspection workers (default: 8)
`

const readValue = (args: string[], index: number, flag: string) => {
	const value = args[index + 1]
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`)
	}
	return value
}

export const parseQaArguments = (args: string[]) => {
	let mode: "partial" | "strict" | undefined
	let reportPath: string = QA_REPORT_PATH
	let generationResultsPath: string = GENERATION_RESULTS_PATH
	let nearDuplicateThreshold: number | undefined
	let concurrency: number | undefined
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index]
		if (flag === "--mode") {
			const value = readValue(args, index, flag)
			if (value !== "partial" && value !== "strict") {
				throw new Error("--mode must be partial or strict")
			}
			mode = value
			index += 1
		} else if (flag === "--report") {
			reportPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--generation-results") {
			generationResultsPath = readValue(args, index, flag)
			index += 1
		} else if (flag === "--near-duplicate-threshold") {
			nearDuplicateThreshold = Number(readValue(args, index, flag))
			index += 1
		} else if (flag === "--concurrency") {
			concurrency = Number(readValue(args, index, flag))
			index += 1
		} else if (flag === "--help" || flag === "-h") {
			console.log(usage)
			process.exit(0)
		} else {
			throw new Error(`unknown argument: ${flag}`)
		}
	}
	if (!mode) throw new Error("--mode is required")
	if (
		nearDuplicateThreshold !== undefined &&
		(!Number.isInteger(nearDuplicateThreshold) ||
			nearDuplicateThreshold < 0 ||
			nearDuplicateThreshold > 64)
	) {
		throw new Error("--near-duplicate-threshold must be an integer from 0 to 64")
	}
	if (
		concurrency !== undefined &&
		(!Number.isInteger(concurrency) || concurrency < 1)
	) {
		throw new Error("--concurrency must be a positive integer")
	}
	return {
		mode,
		reportPath,
		generationResultsPath,
		...(nearDuplicateThreshold === undefined
			? {}
			: { nearDuplicateThreshold }),
		...(concurrency === undefined ? {} : { concurrency })
	}
}

if (import.meta.main) {
	try {
		const options = parseQaArguments(process.argv.slice(2))
		const report = await runLobsterAssetQa(options)
		console.log(
			JSON.stringify({
				passed: report.passed,
				mode: report.mode,
				reportPath: options.reportPath,
				summary: report.summary,
				failedCriteria: report.criteria
					.filter((criterion) => criterion.status === "fail")
					.map((criterion) => criterion.id),
				pendingCriteria: report.criteria
					.filter((criterion) => criterion.status === "pending")
					.map((criterion) => criterion.id)
			})
		)
		if (!report.passed) process.exitCode = 1
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		console.error(usage)
		process.exitCode = 1
	}
}
