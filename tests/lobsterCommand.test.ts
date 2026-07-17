import { Database } from "bun:sqlite"
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	spyOn
} from "bun:test"
import {
	readFileSync,
	readdirSync
} from "node:fs"
import {
	ApplicationCommandType,
	ApplicationIntegrationType,
	type ButtonInteraction,
	type CommandInteraction,
	InteractionContextType,
	serializePayload
} from "@buape/carbon"
import LobsterCommand, {
	ReleaseLobsterContextCommand
} from "../src/commands/lobster.js"
import { buildLobsterEncounterContainer } from "../src/components/lobsterButtons.js"
import {
	lobsterArtworkRevision,
	lobsterConfig,
	lobsterScenePath,
	lobsterSceneUrl
} from "../src/config/lobster.js"
import { lobsterMetadataRecords } from "../src/config/lobsterMetadata.js"
import {
	bindLobsterMessage,
	createLobsterEncounter,
	getLobsterEncounter
} from "../src/data/lobsterEncounters.js"
import { getPrimaryDb } from "../src/db.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import {
	deterministicIndex,
	formatLobsterEncounterId,
	generateLobsterButterResult,
	generateLobsterEncounter,
	generateLobsterReturn
} from "../src/services/lobsterEngine.js"
import {
	handleLobsterButter,
	handleLobsterReturn,
	hasLobsterRole
} from "../src/services/lobsterInteractions.js"
import {
	buildLobsterEncounterPayload,
	setLobsterImageFetcherForTesting
} from "../src/services/lobsterMedia.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const validWebp = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, 0x1e, 0x00, 0x00, 0x00,
	0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
	0x11, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
	0x00, 0x07, 0xd0, 0xaa, 0x6a, 0xf5, 0xaa, 0xff,
	0x81, 0x88, 0xe8, 0x7f, 0x00, 0x00
])

const writeUint32LittleEndian = (
	bytes: Uint8Array,
	offset: number,
	value: number
) => {
	bytes[offset] = value & 0xff
	bytes[offset + 1] = (value >>> 8) & 0xff
	bytes[offset + 2] = (value >>> 16) & 0xff
	bytes[offset + 3] = (value >>> 24) & 0xff
}

const oversizedWebp = () => {
	const bytes = new Uint8Array(120 * 1024 + 2)
	bytes.set([
		0x52, 0x49, 0x46, 0x46,
		0x00, 0x00, 0x00, 0x00,
		0x57, 0x45, 0x42, 0x50,
		0x56, 0x50, 0x38, 0x4c
	])
	writeUint32LittleEndian(bytes, 4, bytes.length - 8)
	writeUint32LittleEndian(bytes, 16, bytes.length - 20)
	bytes[20] = 0x2f
	return bytes
}

const standaloneVp8xWebp = () => {
	const bytes = new Uint8Array([
		0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00,
		0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
		0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00
	])
	return bytes
}

const vp8xWithImageWebp = () => {
	const vp8x = standaloneVp8xWebp()
	const bytes = new Uint8Array(vp8x.length + validWebp.length - 12)
	bytes.set(vp8x)
	bytes.set(validWebp.subarray(12), vp8x.length)
	writeUint32LittleEndian(bytes, 4, bytes.length - 8)
	return bytes
}

beforeAll(() => {
	setLobsterImageFetcherForTesting(
		async () =>
			new Response(validWebp, {
				status: 200,
				headers: { "content-type": "image/webp" }
			})
	)
})

afterAll(() => {
	setLobsterImageFetcherForTesting(null)
})

const migrationPaths = readdirSync("drizzle")
	.filter(
		(file) =>
			(file.startsWith("0010_") || file.startsWith("0011_")) &&
			file.endsWith(".sql")
	)
	.sort()

if (migrationPaths.length !== 2) {
	throw new Error("Could not find slap and lobster persistence migrations")
}

const applyMigrations = (database: Database) => {
	for (const migrationPath of migrationPaths) {
		const migration = readFileSync(`drizzle/${migrationPath}`, "utf8")
		for (const statement of migration.split("--> statement-breakpoint")) {
			const trimmed = statement.trim()
			if (trimmed.length > 0) {
				database.run(trimmed)
			}
		}
	}
}

const testDatabase = () => {
	const owner = new SqliteD1Database()
	applyMigrations(owner.database)
	setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
	return { owner, database: getPrimaryDb() }
}

const flattenComponents = (component: unknown): Record<string, unknown>[] => {
	if (!component || typeof component !== "object") {
		return []
	}
	const record = component as Record<string, unknown>
	const children = Array.isArray(record.components)
		? record.components.flatMap(flattenComponents)
		: []
	return [record, ...children]
}

const payloadText = (payload: unknown) =>
	flattenComponents(serializePayload(payload))
		.map((component) => component.content)
		.filter((content): content is string => typeof content === "string")
		.join("\n")

const generate = (
	seed = "initial:lobster-test",
	target = { id: "target-1", bot: false }
) =>
	generateLobsterEncounter({
		seed,
		actor: { id: "actor-1", bot: false },
		target,
		hermitUserId: lobsterConfig.hermitUserId,
		rockLobsterUserId: lobsterConfig.rockLobsterUserId
	})

const createEncounter = async (
	overrides: Partial<{
		interactionId: string
		guildId: string
		channelId: string
		actorId: string
		targetId: string
		targetIsBot: boolean
	}> = {},
	referenceDate = new Date("2026-07-17T18:00:00.000Z")
) => {
	const interactionId = overrides.interactionId ?? "lobster-interaction-1"
	const actorId = overrides.actorId ?? "actor-1"
	const targetId = overrides.targetId ?? "target-1"
	const targetIsBot = overrides.targetIsBot ?? false
	const result = generateLobsterEncounter({
		seed: `initial:${interactionId}`,
		actor: { id: actorId, bot: false },
		target: { id: targetId, bot: targetIsBot },
		hermitUserId: lobsterConfig.hermitUserId,
		rockLobsterUserId: lobsterConfig.rockLobsterUserId
	})
	return createLobsterEncounter(
		{
			interactionId,
			guildId: overrides.guildId ?? lobsterConfig.guildId,
			channelId: overrides.channelId ?? "channel-1",
			actorId,
			targetId,
			targetIsBot,
			taxonomySnapshotId: result.taxonomySnapshotId,
			speciesAphiaId: result.speciesAphiaId,
			speciesAcceptedName: result.speciesAcceptedName,
			speciesDisplayName: result.speciesDisplayName,
			speciesFamily: result.speciesFamily,
			sceneId: result.sceneId,
			assetUrl: result.assetUrl,
			assetChecksum: result.assetChecksum,
			headline: result.headline,
			narrative: result.narrative,
			metrics: result.metrics,
			accessibilityDescription: result.accessibilityDescription
		},
		referenceDate
	)
}

const bindEncounter = async () => {
	const creation = await createEncounter()
	if (creation.kind !== "created") {
		throw new Error("Expected lobster encounter creation")
	}
	const binding = await bindLobsterMessage(
		creation.encounter.id,
		creation.encounter.guildId,
		creation.encounter.channelId,
		"message-1"
	)
	if (!binding.encounter || binding.kind !== "bound") {
		throw new Error("Expected lobster encounter binding")
	}
	return binding.encounter
}

describe("lobster catalog and deterministic engine", () => {
	it("uses deterministic immutable repository paths without claiming assets exist", () => {
		expect(lobsterArtworkRevision).toMatch(/^[a-f0-9]{40}$/)
		expect(lobsterMetadataRecords).toHaveLength(264)
		for (const species of lobsterMetadataRecords) {
			expect(species.scenePlans).toHaveLength(4)
			for (const scene of species.scenePlans) {
				expect(lobsterScenePath(species.AphiaID, scene.id)).toBe(
					`assets/lobster/scenes/${species.AphiaID}/${scene.id}.webp`
				)
				expect(lobsterSceneUrl(species.AphiaID, scene.id)).toBe(
					`https://raw.githubusercontent.com/openclaw/hermit/${lobsterArtworkRevision}/assets/lobster/scenes/${species.AphiaID}/${scene.id}.webp`
				)
			}
		}
	})

	it("reproduces species, scene, copy, metrics, and alt text for retries", () => {
		const first = generate("initial:retry-stable")
		const retry = generate("initial:retry-stable")

		expect(retry).toEqual(first)
		expect(first.assetChecksum).toBe(
			`pending-artwork:${first.speciesAphiaId}:${first.sceneId}`
		)
		expect(first.accessibilityDescription.length).toBeGreaterThan(20)
	})

	it("makes all 264 species reachable with an acceptably uniform deterministic selector", () => {
		const counts = Array.from({ length: 264 }, () => 0)
		for (let index = 0; index < 100_000; index += 1) {
			counts[deterministicIndex(`species:reach-${index}`, 264)]! += 1
		}

		expect(counts.every((count) => count > 0)).toBe(true)
		expect(Math.max(...counts) / Math.min(...counts)).toBeLessThan(1.4)
	})

	it("uses the standard species library with explicit generic target handling", () => {
		const seed = "initial:special-target"
		const self = generate(seed, { id: "actor-1", bot: false })
		const hermit = generate(seed, {
			id: lobsterConfig.hermitUserId,
			bot: true
		})
		const rock = generate(seed, {
			id: lobsterConfig.rockLobsterUserId,
			bot: true
		})
		const bot = generate(seed, { id: "generic-bot", bot: true })

		expect([self, hermit, rock, bot].map((item) => item.speciesAphiaId))
			.toEqual(Array(4).fill(self.speciesAphiaId))
		expect([self, hermit, rock, bot].map((item) => item.sceneId))
			.toEqual(Array(4).fill(self.sceneId))
		expect(self.targetKind).toBe("self")
		expect(hermit.targetKind).toBe("hermit")
		expect(rock.targetKind).toBe("rock_lobster")
		expect(bot.targetKind).toBe("bot")
	})
})

describe("lobster persistence and Carbon card", () => {
	it("persists generated fields and reuses the original encounter on retry", async () => {
		const { owner, database } = testDatabase()
		try {
			const first = await createEncounter()
			const retry = await createEncounter(
				{},
				new Date("2026-07-17T18:00:05.000Z")
			)
			expect(first.kind).toBe("created")
			expect(retry.kind).toBe("existing")
			if (first.kind === "created" && retry.kind === "existing") {
				expect(retry.encounter).toEqual(first.encounter)
				expect(formatLobsterEncounterId(first.encounter.id)).toBe("LOB-0001")
				expect(first.encounter.assetChecksum).toStartWith("pending-artwork:")
				expect(JSON.parse(first.encounter.metricsJson)).toEqual(
					expect.objectContaining({ action: expect.any(String) })
				)
			}
			expect(await getLobsterEncounter(1, database)).not.toBeNull()
		} finally {
			owner.close()
		}
	})

	it("renders IDs, taxonomy, species data, metrics, status, and controls with Carbon only", async () => {
		const { owner } = testDatabase()
		try {
			const creation = await createEncounter()
			if (creation.kind !== "created") {
				throw new Error("Expected encounter")
			}
			const payload = {
				components: [buildLobsterEncounterContainer(creation.encounter)]
			}
			const serialized = serializePayload(payload) as Record<string, unknown>
			const components = flattenComponents(serialized)
			const text = payloadText(payload)
			const buttons = components.filter((component) => component.type === 2)

			expect(text).toContain("Lobster Encounter LOB-0001")
			expect(text).toContain(creation.encounter.speciesDisplayName)
			expect(text).toContain(creation.encounter.speciesAcceptedName)
			expect(text).toContain(creation.encounter.speciesFamily)
			expect(text).toContain(`AphiaID ${creation.encounter.speciesAphiaId}`)
			expect(text).toContain("Resolve:")
			expect(text).toContain(creation.encounter.taxonomySnapshotId)
			expect(text).toContain("awaiting target response")
			expect(buttons).toEqual([
				expect.objectContaining({
					custom_id: `lobster-return:id=${creation.encounter.id}`,
					disabled: false
				}),
				expect.objectContaining({
					custom_id: `lobster-butter:id=${creation.encounter.id}`,
					disabled: false
				})
			])
			expect(serialized.embeds).toBeUndefined()
			expect(serialized.content).toBeUndefined()
			expect(
				components
					.filter((component) => component.type !== undefined)
					.every((component) =>
						[1, 2, 10, 12, 14, 17].includes(Number(component.type))
					)
			).toBe(true)
		} finally {
			owner.close()
		}
	})

	it("uploads valid trusted WebP media and uses attachment galleries", async () => {
		const { owner } = testDatabase()
		try {
			const creation = await createEncounter()
			if (creation.kind !== "created") {
				throw new Error("Expected encounter")
			}
			const requested: string[] = []
			const payload = await buildLobsterEncounterPayload(
				creation.encounter,
				async (input) => {
					requested.push(input.toString())
					return new Response(validWebp, { status: 200 })
				}
			)
			const gallery = flattenComponents(serializePayload(payload)).find(
				(component) => component.type === 12
			) as { items?: Array<{ media?: { url?: string } }> } | undefined

			expect(requested).toEqual([creation.encounter.assetUrl])
			expect(payload.files?.[0]?.name).toBe("lobster-1-initial.webp")
			expect(gallery?.items?.[0]?.media?.url).toBe(
				"attachment://lobster-1-initial.webp"
			)
		} finally {
			owner.close()
		}
	})

	it("accepts historical immutable revisions and VP8X followed by an image bitstream", async () => {
		const { owner } = testDatabase()
		try {
			const creation = await createEncounter()
			if (creation.kind !== "created") {
				throw new Error("Expected encounter")
			}
			const historicalUrl = creation.encounter.assetUrl.replace(
				lobsterArtworkRevision,
				"da5edf3065a5440241f80fa4d07be4cb72384151"
			)
			const requested: string[] = []
			const payload = await buildLobsterEncounterPayload(
				{ ...creation.encounter, assetUrl: historicalUrl },
				async (input) => {
					requested.push(input.toString())
					return new Response(vp8xWithImageWebp(), { status: 200 })
				}
			)

			expect(requested).toEqual([historicalUrl])
			expect(payload.files).toHaveLength(1)
			expect(payloadText(payload)).not.toContain(
				"Encounter artwork is temporarily unavailable."
			)
		} finally {
			owner.close()
		}
	})

	it("rejects unavailable, malformed, oversized, mutable, and unrelated media with a compact fallback", async () => {
		const { owner } = testDatabase()
		const consoleError = spyOn(console, "error").mockImplementation(() => {})
		try {
			const creation = await createEncounter()
			if (creation.kind !== "created") {
				throw new Error("Expected encounter")
			}
			const cases = [
				{
					encounter: creation.encounter,
					fetcher: async () => new Response("missing", { status: 404 })
				},
				{
					encounter: creation.encounter,
					fetcher: async () => new Response("not-webp", { status: 200 })
				},
				{
					encounter: creation.encounter,
					fetcher: async () =>
						new Response(
							new Uint8Array([
								0x52, 0x49, 0x46, 0x46,
								0x04, 0x00, 0x00, 0x00,
								0x57, 0x45, 0x42, 0x50
							]),
							{ status: 200 }
						)
				},
				{
					encounter: creation.encounter,
					fetcher: async () =>
						new Response(standaloneVp8xWebp(), { status: 200 })
				},
				{
					encounter: creation.encounter,
					fetcher: async () =>
						new Response(
							new Uint8Array([
								...validWebp.slice(0, 12),
								0x4a, 0x55, 0x4e, 0x4b,
								...validWebp.slice(16)
							]),
							{ status: 200 }
						)
				},
				{
					encounter: creation.encounter,
					fetcher: async () => {
						const inconsistent = validWebp.slice()
						inconsistent[4] = 0x15
						return new Response(inconsistent, { status: 200 })
					}
				},
				{
					encounter: creation.encounter,
					fetcher: async () =>
						new Response(oversizedWebp(), { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: "https://example.com/lobster.webp"
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: creation.encounter.assetUrl.replace(
							lobsterArtworkRevision,
							"v1.0.0"
						)
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: creation.encounter.assetUrl.replace(
							lobsterArtworkRevision,
							"main"
						)
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: creation.encounter.assetUrl.replace(
							"/assets/lobster/scenes/",
							"/assets/slap/scenes/"
						)
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: creation.encounter.assetUrl.replace(
							"/openclaw/hermit/",
							"/openclaw/other-repo/"
						)
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: creation.encounter.assetUrl.replace(
							`/${creation.encounter.speciesAphiaId}/`,
							"/not-numeric/"
						)
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: `${creation.encounter.assetUrl}?ref=mutable`
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: `${creation.encounter.assetUrl}#fragment`
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: creation.encounter.assetUrl.replace(
							"https://",
							"https://user:password@"
						)
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				},
				{
					encounter: {
						...creation.encounter,
						assetUrl: creation.encounter.assetUrl.replace(
							"raw.githubusercontent.com",
							"raw.githubusercontent.com:443"
						)
					},
					fetcher: async () => new Response(validWebp, { status: 200 })
				}
			]

			for (const item of cases) {
				const payload = await buildLobsterEncounterPayload(
					item.encounter,
					item.fetcher
				)
				expect(payload.files).toBeUndefined()
				expect(payloadText(payload)).toContain(
					"Encounter artwork is temporarily unavailable."
				)
				expect(
					flattenComponents(serializePayload(payload)).some(
						(component) => component.type === 12
					)
				).toBe(false)
			}
		} finally {
			consoleError.mockRestore()
			owner.close()
		}
	})
})

describe("/lobster and Release Lobster", () => {
	it("registers both guild-only entry points and both component listeners", async () => {
		const slash = new LobsterCommand()
		const context = new ReleaseLobsterContextCommand()
		for (const command of [slash, context]) {
			expect(command.contexts).toEqual([InteractionContextType.Guild])
			expect(command.integrationTypes).toEqual([
				ApplicationIntegrationType.GuildInstall
			])
			expect(command.guildIds).toEqual([lobsterConfig.guildId])
			expect(command.defer).toBe(false)
		}
		expect(context.name).toBe("Release Lobster")
		expect(context.type).toBe(ApplicationCommandType.User)

		const previousFetch = globalThis.fetch
		const previousEnv = {
			BASE_URL: process.env.BASE_URL,
			DEPLOY_SECRET: process.env.DEPLOY_SECRET,
			DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
			DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY,
			DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN
		}
		process.env.BASE_URL = "https://example.test"
		process.env.DEPLOY_SECRET = "test-secret"
		process.env.DISCORD_CLIENT_ID = "1"
		process.env.DISCORD_PUBLIC_KEY = "00"
		process.env.DISCORD_BOT_TOKEN = "test-token"
		globalThis.fetch = async () => Response.json([])
		try {
			const { client } = await import("../src/index.js")
			expect(
				client.commands.filter((command) =>
					["lobster", "Release Lobster"].includes(command.name)
				)
			).toEqual([
				expect.any(LobsterCommand),
				expect.any(ReleaseLobsterContextCommand)
			])
			expect(
				client.componentHandler.hasComponentWithKey("lobster-return")
			).toBe(true)
			expect(
				client.componentHandler.hasComponentWithKey("lobster-butter")
			).toBe(true)
			await new Promise((resolve) => setTimeout(resolve, 20))
		} finally {
			globalThis.fetch = previousFetch
			for (const [key, value] of Object.entries(previousEnv)) {
				if (value === undefined) {
					delete process.env[key]
				} else {
					process.env[key] = value
				}
			}
		}
	})

	it("authorizes exactly Community Team, Maintainer, and Maintainer Guest", () => {
		expect(lobsterConfig.authorizedRoleIds).toEqual([
			"1477360613125787678",
			"1457214688806047756",
			"1503268035908075590"
		])
		for (const roleId of lobsterConfig.authorizedRoleIds) {
			expect(hasLobsterRole([roleId])).toBe(true)
		}
		expect(hasLobsterRole(["unrelated-role"])).toBe(false)
	})

	it("rejects unauthorized invocation privately before persistence", async () => {
		const replies: unknown[] = []
		const interaction = {
			rawData: {
				id: "unauthorized-lobster",
				guild_id: lobsterConfig.guildId,
				channel_id: "channel-1"
			},
			member: { roles: [{ id: "unrelated-role" }] },
			user: { id: "actor-1" },
			userId: "actor-1",
			options: {
				getUser: () => ({ id: "target-1", bot: false })
			},
			reply: async (payload: unknown) => {
				replies.push(payload)
			}
		} as unknown as CommandInteraction

		await new LobsterCommand().run(interaction)

		expect(payloadText(replies[0])).toContain(
			"Community Team, Maintainer, or Maintainer Guest roles only"
		)
		expect(replies[0]).toEqual(expect.objectContaining({ ephemeral: true }))
	})

	it("persists before publishing and binds the canonical Discord message", async () => {
		const { owner } = testDatabase()
		try {
			const replies: unknown[] = []
			let deferred = false
			const interaction = {
				rawData: {
					id: "authorized-lobster",
					guild_id: lobsterConfig.guildId,
					channel_id: "channel-command"
				},
				member: {
					roles: [{ id: lobsterConfig.authorizedRoleIds[1] }]
				},
				user: { id: "actor-command" },
				userId: "actor-command",
				options: {
					getUser: () => ({ id: "target-command", bot: false })
				},
				defer: async () => {
					deferred = true
				},
				reply: async (payload: unknown) => {
					replies.push(payload)
					return { id: "message-command" }
				}
			} as unknown as CommandInteraction

			await new LobsterCommand().run(interaction)

			const stored = owner.database.query(
				`select interaction_id as interactionId, message_id as messageId,
					publication_status as publicationStatus
				from lobster_encounters`
			).get()
			expect(deferred).toBe(true)
			expect(stored).toEqual({
				interactionId: "authorized-lobster",
				messageId: "message-command",
				publicationStatus: "published"
			})
			expect(payloadText(replies[0])).toContain("Lobster Encounter LOB-0001")
		} finally {
			owner.close()
		}
	})

	it("marks defer failures terminal and releases cooldowns for a new request", async () => {
		const { owner } = testDatabase()
		const consoleError = spyOn(console, "error").mockImplementation(() => {})
		try {
			const notices: unknown[] = []
			const failedInteraction = {
				rawData: {
					id: "defer-failure",
					guild_id: lobsterConfig.guildId,
					channel_id: "channel-defer-failure"
				},
				member: {
					roles: [{ id: lobsterConfig.authorizedRoleIds[0] }]
				},
				user: { id: "actor-defer-failure" },
				userId: "actor-defer-failure",
				options: {
					getUser: () => ({ id: "target-defer-failure", bot: false })
				},
				defer: async () => {
					throw new Error("forced defer failure")
				},
				reply: async (payload: unknown) => {
					notices.push(payload)
					return { id: "notice-only" }
				}
			} as unknown as CommandInteraction

			await new LobsterCommand().run(failedInteraction)

			expect(
				owner.database.query(
					`select publication_status as publicationStatus,
						publication_failure as publicationFailure, message_id as messageId
					from lobster_encounters
					where interaction_id = 'defer-failure'`
				).get()
			).toEqual({
				publicationStatus: "publication_failed",
				publicationFailure: "forced defer failure",
				messageId: null
			})
			expect(
				owner.database.query(
					"select count(*) as count from action_cooldown_events"
				).get()
			).toEqual({ count: 0 })
			expect(payloadText(notices[0])).toContain(
				"could not be published"
			)

			const sameInteractionNotices: unknown[] = []
			await new LobsterCommand().run({
				...failedInteraction,
				defer: async () => {},
				reply: async (payload: unknown) => {
					sameInteractionNotices.push(payload)
					return { id: "same-interaction-message" }
				}
			} as unknown as CommandInteraction)
			expect(payloadText(sameInteractionNotices[0])).toContain(
				"previously failed to publish"
			)

			const retryReplies: unknown[] = []
			await new LobsterCommand().run({
				...failedInteraction,
				rawData: {
					...failedInteraction.rawData,
					id: "after-defer-failure",
					channel_id: "channel-after-defer-failure"
				},
				defer: async () => {},
				reply: async (payload: unknown) => {
					retryReplies.push(payload)
					return { id: "message-after-defer-failure" }
				}
			} as unknown as CommandInteraction)

			expect(
				owner.database.query(
					`select publication_status as publicationStatus,
						message_id as messageId
					from lobster_encounters
					where interaction_id = 'after-defer-failure'`
				).get()
			).toEqual({
				publicationStatus: "published",
				messageId: "message-after-defer-failure"
			})
			expect(payloadText(retryReplies[0])).toContain(
				"Lobster Encounter LOB-0002"
			)
		} finally {
			consoleError.mockRestore()
			owner.close()
		}
	})
})

describe("lobster target responses", () => {
	const makeInteraction = (
		encounter: Awaited<ReturnType<typeof bindEncounter>>,
		options: {
			userId?: string
			userIsBot?: boolean
			guildId?: string
			channelId?: string
			messageId?: string
		} = {}
	) => {
		const replies: unknown[] = []
		const updates: unknown[] = []
		const interaction = {
			rawData: {
				guild_id: options.guildId ?? encounter.guildId,
				channel_id: options.channelId ?? encounter.channelId,
				message: { id: options.messageId ?? encounter.messageId }
			},
			user: {
				id: options.userId ?? encounter.targetId,
				bot: options.userIsBot ?? false
			},
			userId: options.userId ?? encounter.targetId,
			member: { roles: [] },
			reply: async (payload: unknown) => {
				replies.push(payload)
			},
			update: async (payload: unknown) => {
				updates.push(payload)
			}
		} as unknown as ButtonInteraction
		return { interaction, replies, updates }
	}

	it("returns the same species with a distinct approved scene and deterministic copy", async () => {
		const { owner } = testDatabase()
		try {
			const encounter = await bindEncounter()
			const first = generateLobsterReturn(encounter)
			const retry = generateLobsterReturn(encounter)
			const approvedSceneIds = lobsterMetadataRecords
				.find((species) => species.AphiaID === encounter.speciesAphiaId)
				?.scenePlans.map((scene) => scene.id)

			expect(retry).toEqual(first)
			expect(first.sceneId).not.toBe(encounter.sceneId)
			expect(approvedSceneIds).toContain(first.sceneId)
			expect(first.assetUrl).toContain(
				`/assets/lobster/scenes/${encounter.speciesAphiaId}/`
			)

			const target = makeInteraction(encounter)
			await handleLobsterReturn(target.interaction, { id: encounter.id })
			expect(target.replies).toHaveLength(0)
			expect(target.updates).toHaveLength(1)
			expect(payloadText(target.updates[0])).toContain(
				"returns the encounter"
			)
			expect(payloadText(target.updates[0])).toContain(
				"response recorded; encounter closed"
			)
			const stored = await getLobsterEncounter(encounter.id)
			expect(stored?.responseType).toBe("return_to_sender")
			expect(stored?.counterSceneId).toBe(first.sceneId)
		} finally {
			owner.close()
		}
	})

	it("deterministically accepts or rejects butter and closes without a counter", async () => {
		const { owner } = testDatabase()
		try {
			const encounter = await bindEncounter()
			const expected = generateLobsterButterResult(encounter)
			expect(generateLobsterButterResult(encounter)).toEqual(expected)

			const target = makeInteraction(encounter)
			await handleLobsterButter(target.interaction, { id: encounter.id })
			expect(payloadText(target.updates[0])).toContain(expected.headline)
			const stored = await getLobsterEncounter(encounter.id)
			expect(stored?.responseType).toBe("offer_butter")
			expect(stored?.responseResultJson).toBe(JSON.stringify(expected))
			expect(stored?.counterSceneId).toBeNull()
		} finally {
			owner.close()
		}
	})

	it("rejects wrong users, bots, and forged message bindings privately", async () => {
		const { owner } = testDatabase()
		try {
			const encounter = await bindEncounter()
			const wrongUser = makeInteraction(encounter, {
				userId: "someone-else"
			})
			await handleLobsterReturn(wrongUser.interaction, { id: encounter.id })
			expect(wrongUser.replies[0]).toEqual(
				expect.objectContaining({ ephemeral: true })
			)
			expect(payloadText(wrongUser.replies[0])).toContain(
				"Only the named non-bot target"
			)

			const bot = makeInteraction(encounter, { userIsBot: true })
			await handleLobsterButter(bot.interaction, { id: encounter.id })
			expect(payloadText(bot.replies[0])).toContain(
				"Only the named non-bot target"
			)

			const forged = makeInteraction(encounter, {
				messageId: "forged-message"
			})
			await handleLobsterButter(forged.interaction, { id: encounter.id })
			expect(forged.replies[0]).toEqual(
				expect.objectContaining({ ephemeral: true })
			)
			expect(payloadText(forged.replies[0])).toContain(
				"could not be verified"
			)
			expect((await getLobsterEncounter(encounter.id))?.responseStatus).toBe(
				"pending"
			)
		} finally {
			owner.close()
		}
	})

	it("allows only one concurrent response and makes retries idempotent", async () => {
		const { owner } = testDatabase()
		try {
			const encounter = await bindEncounter()
			const returning = makeInteraction(encounter)
			const butter = makeInteraction(encounter)

			await Promise.all([
				handleLobsterReturn(returning.interaction, { id: encounter.id }),
				handleLobsterButter(butter.interaction, { id: encounter.id })
			])
			const stored = await getLobsterEncounter(encounter.id)
			expect(stored?.responseStatus).toBe("responded")
			expect(["return_to_sender", "offer_butter"]).toContain(
				stored?.responseType
			)
			expect(
				owner.database.query(
					"select count(*) as count from lobster_encounters where response_status = 'responded'"
				).get()
			).toEqual({ count: 1 })

			const retry = makeInteraction(stored!)
			await (
				stored?.responseType === "return_to_sender"
					? handleLobsterReturn(retry.interaction, { id: encounter.id })
					: handleLobsterButter(retry.interaction, { id: encounter.id })
			)
			expect(retry.updates).toHaveLength(1)
			expect((await getLobsterEncounter(encounter.id))?.respondedAt).toBe(
				stored?.respondedAt
			)
		} finally {
			owner.close()
		}
	})

	it("disables both controls for bot targets", async () => {
		const { owner } = testDatabase()
		try {
			const creation = await createEncounter({ targetIsBot: true })
			if (creation.kind !== "created") {
				throw new Error("Expected encounter")
			}
			const buttons = flattenComponents(
				serializePayload({
					components: [
						buildLobsterEncounterContainer(creation.encounter)
					]
				})
			).filter((component) => component.type === 2)

			expect(buttons).toEqual([
				expect.objectContaining({ disabled: true }),
				expect.objectContaining({ disabled: true })
			])
		} finally {
			owner.close()
		}
	})
})
