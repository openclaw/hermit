import { mkdir, rename, rm } from "node:fs/promises"
import { resolve } from "node:path"
import {
	loadPrimaryPlan,
	primaryActionId,
	type PrimaryManifestEntry
} from "./lobster-primary-art-contract.js"
import { inspectPrimaryWebp } from "./lobster-primary-art-generation.js"

type ContactSheetGroup = {
	family: string
	actionId: string
	entries: PrimaryManifestEntry[]
}

const slug = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")

const compare = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0

const run = async (command: string[], description: string) => {
	const child = Bun.spawn(command, {
		env: { ...Bun.env, MAGICK_THREAD_LIMIT: "1" },
		stdout: "pipe",
		stderr: "pipe"
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	])
	if (exitCode !== 0) {
		throw new Error(
			`${description} failed (${exitCode}): ${
				stderr.trim() || stdout.trim() || "no diagnostic output"
			}`
		)
	}
}

export const groupPrimaryContactSheets = (
	entries: PrimaryManifestEntry[]
): ContactSheetGroup[] => {
	const groups = new Map<string, ContactSheetGroup>()
	for (const entry of entries) {
		const actionId = primaryActionId(entry)
		const key = `${entry.family}\u0000${actionId}`
		const group = groups.get(key) ?? {
			family: entry.family,
			actionId,
			entries: []
		}
		group.entries.push(entry)
		groups.set(key, group)
	}
	return [...groups.values()]
		.map((group) => ({
			...group,
			entries: group.entries.sort((left, right) =>
				compare(left.sceneId, right.sceneId)
			)
		}))
		.sort(
			(left, right) =>
				compare(left.family, right.family) ||
				compare(left.actionId, right.actionId)
		)
}

export const buildPrimaryContactSheets = async (options: {
	outputDir?: string
	manifestPath?: string
	batchesPath?: string
}) => {
	const magick = Bun.which("magick")
	if (!magick) throw new Error("ImageMagick `magick` is required")
	const outputDir = resolve(
		options.outputDir ?? "tmp/imagegen/lobster-primary-contact-sheets"
	)
	const stagingDir = `${outputDir}.tmp-${process.pid}`
	const plan = await loadPrimaryPlan({
		manifestPath: options.manifestPath,
		batchesPath: options.batchesPath
	})
	const groups = groupPrimaryContactSheets(plan.manifest.entries)

	for (const entry of plan.manifest.entries) {
		await inspectPrimaryWebp(entry.outputPath)
	}

	await rm(stagingDir, { recursive: true, force: true })
	await mkdir(stagingDir, { recursive: true })
	try {
		for (const group of groups) {
			const outputPath = resolve(
				stagingDir,
				`${slug(group.family)}--${slug(group.actionId)}.webp`
			)
			await run(
				[
					magick,
					"montage",
					...group.entries.map(({ outputPath: path }) => path),
					"-thumbnail",
					"384x256",
					"-tile",
					"3x",
					"-geometry",
					"384x256+12+36",
					"-background",
					"#111111",
					"-fill",
					"#f5f5f5",
					"-stroke",
					"none",
					"-pointsize",
					"18",
					"-label",
					"%t",
					"-title",
					`${group.family} | ${group.actionId} | ${group.entries.length} primary scenes`,
					"-strip",
					"-colorspace",
					"sRGB",
					"-quality",
					"88",
					"-define",
					"webp:method=6",
					outputPath
				],
				`build contact sheet ${group.family}/${group.actionId}`
			)
		}
		await rm(outputDir, { recursive: true, force: true })
		await rename(stagingDir, outputDir)
	} catch (error) {
		await rm(stagingDir, { recursive: true, force: true })
		throw error
	}

	return {
		outputDir,
		sheetCount: groups.length,
		assetCount: plan.manifest.entries.length,
		groups: groups.map(({ family, actionId, entries }) => ({
			family,
			actionId,
			sceneCount: entries.length
		}))
	}
}
