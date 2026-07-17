#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises"
import type { ArtworkManifest } from "./lib/lobster-artwork-plan.js"
import {
	DEFAULT_GENERATION_LOG_ROOT,
	GENERATION_RESULTS_PATH,
	importGenerationResults,
	loadRemediationRegistry,
	serializeJson,
	type GenerationResultsLedger
} from "./lib/lobster-art-evidence.js"
import {
	BATCHES_PATH,
	finalizeLobsterArtwork,
	MANIFEST_PATH,
	PROVENANCE_PATH
} from "./lib/lobster-art-finalization.js"

const main = async () => {
	const mode = Bun.argv[2] ?? "--write"
	if (mode === "--import-results") {
		const logRoot = Bun.argv[3] ?? DEFAULT_GENERATION_LOG_ROOT
		const [manifest, remediation, existing] = await Promise.all([
			readFile(MANIFEST_PATH, "utf8").then(
				(value) => JSON.parse(value) as ArtworkManifest
			),
			loadRemediationRegistry(),
			readFile(GENERATION_RESULTS_PATH, "utf8")
				.then((value) => JSON.parse(value) as GenerationResultsLedger)
				.catch(() => null)
		])
		const ledger = await importGenerationResults(manifest, {
			logRoot,
			existing,
			remediation
		})
		await writeFile(GENERATION_RESULTS_PATH, serializeJson(ledger))
		console.log(
			`imported ${ledger.records.length} generated results from ${logRoot}`
		)
		return
	}
	if (mode !== "--write" && mode !== "--verify") {
		throw new Error(
			"usage: bun scripts/finalize-lobster-art.ts [--write|--verify|--import-results [log-root]]"
		)
	}
	const finalized = await finalizeLobsterArtwork()
	if (mode === "--write") {
		await Promise.all([
			writeFile(MANIFEST_PATH, finalized.manifestContents),
			writeFile(BATCHES_PATH, finalized.batchesContents),
			writeFile(PROVENANCE_PATH, finalized.provenanceContents)
		])
	}
	console.log(
		`${mode === "--write" ? "finalized" : "verified"} 1056 lobster assets`
	)
}

if (import.meta.main) {
	await main()
}
