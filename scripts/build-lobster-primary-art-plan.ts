import { readFile, writeFile } from "node:fs/promises"
import type { LobsterMetadataDataset } from "./lib/lobster-metadata.js"
import {
	buildPrimaryArtworkBatches,
	buildPrimaryArtworkPlan,
	buildPrimaryArtworkRuntimeManifest,
	parsePrimaryArtworkPlan,
	parsePrimaryArtworkRuntimeManifest,
	serializePrimaryArtworkJson,
	sha256,
	validatePrimaryArtworkBatches,
	validatePrimaryArtworkRuntimeManifest
} from "./lib/lobster-primary-artwork.js"

const taxonomyPath = "data/lobster/taxonomy/lobster-species.json"
const metadataPath = "data/lobster/metadata/lobster-metadata.json"
const manifestPath = "data/lobster/artwork/primary-manifest.json"
const batchesPath = "data/lobster/artwork/primary-batches.json"
const runtimePath = "data/lobster/artwork/primary-runtime.json"

export const generateLobsterPrimaryArtworkArtifacts = async () => {
	const [taxonomyBytes, metadataBytes] = await Promise.all([
		readFile(taxonomyPath),
		readFile(metadataPath)
	])
	const metadata = JSON.parse(
		metadataBytes.toString("utf8")
	) as LobsterMetadataDataset
	const taxonomySha256 = sha256(taxonomyBytes)
	const metadataSha256 = sha256(metadataBytes)
	if (metadata.taxonomySha256 !== taxonomySha256) {
		throw new Error("primary artwork metadata does not bind to taxonomy")
	}
	const plan = buildPrimaryArtworkPlan(metadata, {
		metadataSha256,
		taxonomySha256
	})
	const batches = buildPrimaryArtworkBatches(plan)
	const runtime = buildPrimaryArtworkRuntimeManifest(plan)
	validatePrimaryArtworkBatches(batches, plan)
	validatePrimaryArtworkRuntimeManifest(runtime, plan)
	return {
		plan,
		batches,
		runtime,
		planContents: serializePrimaryArtworkJson(plan),
		batchesContents: serializePrimaryArtworkJson(batches),
		runtimeContents: serializePrimaryArtworkJson(runtime)
	}
}

const verify = async (
	artifacts: Awaited<ReturnType<typeof generateLobsterPrimaryArtworkArtifacts>>
) => {
	const [planText, batchesText, runtimeText, metadataText] = await Promise.all([
		readFile(manifestPath, "utf8"),
		readFile(batchesPath, "utf8"),
		readFile(runtimePath, "utf8"),
		readFile(metadataPath, "utf8")
	])
	const metadata = JSON.parse(metadataText) as LobsterMetadataDataset
	const plan = parsePrimaryArtworkPlan(JSON.parse(planText), metadata)
	const batches = JSON.parse(batchesText)
	const runtime = parsePrimaryArtworkRuntimeManifest(JSON.parse(runtimeText))
	validatePrimaryArtworkBatches(batches, plan)
	validatePrimaryArtworkRuntimeManifest(runtime, plan)
	if (
		planText !== artifacts.planContents ||
		batchesText !== artifacts.batchesContents ||
		runtimeText !== artifacts.runtimeContents
	) {
		throw new Error("primary artwork artifacts are not deterministically current")
	}
}

const main = async () => {
	const mode = Bun.argv[2] ?? "--verify"
	if (mode !== "--verify" && mode !== "--write") {
		throw new Error(
			"usage: bun scripts/build-lobster-primary-art-plan.ts [--verify|--write]"
		)
	}
	const artifacts = await generateLobsterPrimaryArtworkArtifacts()
	if (mode === "--write") {
		await Promise.all([
			writeFile(manifestPath, artifacts.planContents),
			writeFile(batchesPath, artifacts.batchesContents),
			writeFile(runtimePath, artifacts.runtimeContents)
		])
	} else {
		await verify(artifacts)
	}
	const reused = artifacts.plan.entries.filter(
		(entry) => entry.source.kind === "reused-supporting"
	).length
	console.log(
		`${mode === "--write" ? "wrote" : "verified"} 264 primary bindings: ` +
			`${264 - reused} generated, ${reused} reused`
	)
}

if (import.meta.main) await main()
