import { readFile, writeFile } from "node:fs/promises"
import { basename } from "node:path"
import type { LobsterMetadataDataset } from "./lib/lobster-metadata.js"
import {
	buildArtworkBatchGraph,
	buildArtworkManifest,
	computeArtworkQuotaReport,
	serializeJson,
	sha256,
	validateArtworkPlan,
	type ArtworkBatchGraph,
	type ArtworkManifest
} from "./lib/lobster-artwork-plan.js"

const root = "data/lobster/artwork"
const taxonomyPath = "data/lobster/taxonomy/lobster-species.json"
const metadataPath = "data/lobster/metadata/lobster-metadata.json"
const manifestPath = `${root}/manifest.json`
const batchesPath = `${root}/batches.json`
const provenancePath = `${root}/provenance.json`

export const generateLobsterArtworkPlanArtifacts = async () => {
	const [taxonomyBytes, metadataBytes] = await Promise.all([
		readFile(taxonomyPath),
		readFile(metadataPath)
	])
	const metadata = JSON.parse(
		metadataBytes.toString("utf8")
	) as LobsterMetadataDataset
	const taxonomy = JSON.parse(taxonomyBytes.toString("utf8")) as {
		snapshotId: string
	}
	const taxonomySha256 = sha256(taxonomyBytes)
	const metadataSha256 = sha256(metadataBytes)
	if (metadata.taxonomySha256 !== taxonomySha256) {
		throw new Error("metadata does not bind to the exact taxonomy input")
	}

	const manifest = buildArtworkManifest(metadata, metadataSha256)
	const manifestContents = serializeJson(manifest)
	const manifestSha256 = sha256(manifestContents)
	const batches = buildArtworkBatchGraph(manifest, manifestSha256)
	validateArtworkPlan(
		manifest,
		metadata,
		{
			metadataSha256,
			taxonomySha256,
			taxonomySnapshotId: taxonomy.snapshotId
		},
		batches
	)
	const batchesContents = serializeJson(batches)
	const batchesSha256 = sha256(batchesContents)
	const promptSha256 = sha256(
		manifest.entries
			.map((entry) => `${entry.sceneId}:${entry.promptSha256}`)
			.join("\n")
	)
	const inputSha256 = sha256(`${taxonomySha256}\n${metadataSha256}\n`)
	const quotaReport = computeArtworkQuotaReport(manifest)
	const provenance = {
		schemaVersion: 1,
		planId: manifest.planId,
		generator: {
			path: "scripts/build-lobster-art-plan.ts",
			mode: "deterministic-offline",
			networkRequired: false
		},
		inputs: {
			taxonomy: {
				path: taxonomyPath,
				sha256: taxonomySha256
			},
			metadata: {
				path: metadataPath,
				sha256: metadataSha256
			},
			combinedSha256: inputSha256
		},
		outputs: {
			manifest: {
				path: manifestPath,
				sha256: manifestSha256,
				speciesCount: 264,
				sceneCount: manifest.entries.length
			},
			batches: {
				path: batchesPath,
				sha256: batchesSha256,
				batchCount: batches.batches.length,
				maximumSpeciesPerBatch: batches.batchSizeLimit
			}
		},
		prompts: {
			version: manifest.promptVersion,
			count: manifest.entries.length,
			aggregateSha256: promptSha256
		},
		quotaReport,
		approvals: {
			scientificAnatomy: {
				approver: "Peter Steinberger",
				status: "designated-not-reviewed"
			},
			finalArt: {
				approver: "Hannes Rudolph",
				status: "designated-not-reviewed"
			}
		}
	}
	return {
		manifest,
		manifestContents,
		manifestSha256,
		batches,
		batchesContents,
		batchesSha256,
		provenance,
		provenanceContents: serializeJson(provenance),
		promptSha256,
		inputSha256
	}
}

const verifyCurrentArtifacts = async (
	artifacts: Awaited<ReturnType<typeof generateLobsterArtworkPlanArtifacts>>
) => {
	const [manifestText, batchesText, provenanceText] = await Promise.all([
		readFile(manifestPath, "utf8"),
		readFile(batchesPath, "utf8"),
		readFile(provenancePath, "utf8")
	])
	const manifest = JSON.parse(manifestText) as ArtworkManifest
	const batches = JSON.parse(batchesText) as ArtworkBatchGraph
	const provenance = JSON.parse(provenanceText) as {
		inputs?: { combinedSha256?: string }
		prompts?: { aggregateSha256?: string }
		outputs?: {
			manifest?: { sha256?: string }
			batches?: { sha256?: string }
		}
	}
	validateArtworkPlan(
		manifest,
		JSON.parse(
			await readFile(metadataPath, "utf8")
		) as LobsterMetadataDataset,
		{
			metadataSha256: artifacts.manifest.metadata.sha256,
			taxonomySha256: artifacts.manifest.taxonomy.sha256,
			taxonomySnapshotId: artifacts.manifest.taxonomy.snapshotId
		},
		batches
	)
	if (
		provenance.inputs?.combinedSha256 !== artifacts.inputSha256 ||
		provenance.prompts?.aggregateSha256 !== artifacts.promptSha256
	) {
		throw new Error("artwork provenance does not preserve planning checksums")
	}
	if (
		provenance.outputs?.manifest?.sha256 !== sha256(manifestText) ||
		provenance.outputs?.batches?.sha256 !== sha256(batchesText)
	) {
		throw new Error("artwork provenance output checksums are stale")
	}
}

const summary = (
	mode: "wrote" | "verified",
	artifacts: Awaited<ReturnType<typeof generateLobsterArtworkPlanArtifacts>>
) => {
	console.log(
		`${mode} ${basename(manifestPath)}, ${basename(batchesPath)}, and ${basename(provenancePath)}: ` +
			`${artifacts.manifest.entries.length} scenes in ${artifacts.batches.batches.length} batches`
	)
	console.log(
		`checksums: input ${artifacts.inputSha256}, prompts ${artifacts.promptSha256}, ` +
			`manifest ${artifacts.manifestSha256}, batches ${artifacts.batchesSha256}`
	)
}

const main = async () => {
	const mode = Bun.argv[2] ?? "--verify"
	if (mode !== "--verify" && mode !== "--write") {
		throw new Error(
			"usage: bun scripts/build-lobster-art-plan.ts [--verify|--write]"
		)
	}
	const artifacts = await generateLobsterArtworkPlanArtifacts()
	if (mode === "--write") {
		await Promise.all([
			writeFile(manifestPath, artifacts.manifestContents),
			writeFile(batchesPath, artifacts.batchesContents),
			writeFile(provenancePath, artifacts.provenanceContents)
		])
		summary("wrote", artifacts)
		return
	}
	await verifyCurrentArtifacts(artifacts)
	summary("verified", artifacts)
}

if (import.meta.main) {
	await main()
}
