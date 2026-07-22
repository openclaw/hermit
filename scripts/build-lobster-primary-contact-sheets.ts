#!/usr/bin/env bun

import { buildPrimaryContactSheets } from "./lib/lobster-primary-art-contact-sheets.js"

const usage = `Usage:
  bun scripts/build-lobster-primary-contact-sheets.ts [options]

Options:
  --output <dir>      Contact sheet output directory
  --manifest <path>   Primary manifest path
  --batches <path>    Primary batches path
`

const readValue = (args: string[], index: number, flag: string) => {
	const value = args[index + 1]
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
	return value
}

const parseArguments = (args: string[]) => {
	let outputDir: string | undefined
	let manifestPath: string | undefined
	let batchesPath: string | undefined
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index]
		if (flag === "--output") {
			outputDir = readValue(args, index, flag)
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
	return { outputDir, manifestPath, batchesPath }
}

if (import.meta.main) {
	try {
		const result = await buildPrimaryContactSheets(
			parseArguments(Bun.argv.slice(2))
		)
		console.log(JSON.stringify(result))
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		console.error(usage)
		process.exitCode = 1
	}
}
