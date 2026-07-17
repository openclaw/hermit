import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import {
	existsSync,
	readFileSync,
	readdirSync,
	statSync
} from "node:fs"
import {
	ApplicationCommandType,
	ApplicationIntegrationType,
	type ButtonInteraction,
	type CommandInteraction,
	InteractionContextType,
	serializePayload
} from "@buape/carbon"
import AdminCommand from "../src/commands/admin.js"
import SlapCommand, {
	FishSlapContextCommand
} from "../src/commands/slap.js"
import RoleCommand from "../src/commands/role.js"
import {
	buildSlapIncidentContainer
} from "../src/components/slapButtons.js"
import {
	slapConfig,
	slapSceneUrl,
	slapSceneVariants,
	type SlapOutcome
} from "../src/config/slap.js"
import {
	bindSlapMessage,
	createSlapEvent,
	getSlapEvent,
	recordSlapAppeal,
	recordSlapCounter
} from "../src/data/slapEvents.js"
import { getPrimaryDb } from "../src/db.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import {
	formatSlapIncidentId,
	generateSlapResult,
	getAppealRuling
} from "../src/services/slapEngine.js"
import {
	handleSlapAppeal,
	handleSlapBack,
	hasSlapRole
} from "../src/services/slapInteractions.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const slapMigrationPath = readdirSync("drizzle")
	.find((file) => file.startsWith("0010_") && file.endsWith(".sql"))

if (!slapMigrationPath) {
	throw new Error("Could not find slap events migration")
}

const applySlapMigration = (database: Database) => {
	const migration = readFileSync(`drizzle/${slapMigrationPath}`, "utf8")
	for (const statement of migration.split("--> statement-breakpoint")) {
		const trimmed = statement.trim()
		if (trimmed.length > 0) {
			database.run(trimmed)
		}
	}
}

const testDatabase = () => {
	const owner = new SqliteD1Database()
	applySlapMigration(owner.database)
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

const baseResult = (seed = "test-seed") =>
	generateSlapResult({
		seed,
		actor: { id: "actor-1", bot: false },
		target: { id: "target-1", bot: false }
	})

const createEvent = async (
	overrides: Partial<{
		interactionId: string
		guildId: string
		channelId: string
		actorId: string
		targetId: string
		targetIsBot: boolean
	}> = {},
	referenceDate = new Date("2026-07-16T18:00:00.000Z")
) =>
	createSlapEvent(
		{
			interactionId: "interaction-1",
			guildId: slapConfig.guildId,
			channelId: "channel-1",
			actorId: "actor-1",
			targetId: "target-1",
			targetIsBot: false,
			result: baseResult(overrides.interactionId),
			...overrides
		},
		referenceDate
	)

describe("command registration changes", () => {
	it("removes showcase-ban from /role", () => {
		expect(new RoleCommand().subcommands.map((command) => command.name)).toEqual([
			"clawtributor",
			"maintainer-guest"
		])
	})

	it("removes trial-mod from /admin", () => {
		expect(
			new AdminCommand().subcommandGroups.map((command) => command.name)
		).toEqual(["fsc"])
	})
})

describe("slap catalog and engine", () => {
	it("ships the complete fish catalog and copy set", () => {
		expect(slapConfig.fish).toHaveLength(12)
		expect(new Set(slapConfig.fish.map((fish) => fish.rarity))).toEqual(
			new Set(["common", "uncommon", "rare", "epic", "legendary"])
		)
		const standardOutcomes = [
			"normal",
			"critical",
			"dodge",
			"refusal",
			"double",
			"self",
			"hermit",
			"rock_lobster",
			"bot"
		] satisfies SlapOutcome[]
		const imageUrls = slapConfig.fish.flatMap((fish) => {
			const outcomes = fish.rarity === "legendary"
				? [...standardOutcomes, "legendary" as const]
				: standardOutcomes
			return outcomes.flatMap((outcome) =>
				slapSceneVariants.map((variant) =>
					slapSceneUrl(fish.slug, outcome, variant)
				)
			)
		})

		expect(imageUrls).toHaveLength(327)
		expect(new Set(imageUrls).size).toBe(327)
		for (const imageUrl of imageUrls) {
			const path = imageUrl.replace(
				"https://raw.githubusercontent.com/openclaw/hermit/main/",
				""
			)
			expect(existsSync(path)).toBe(true)
			expect(statSync(path).size).toBeGreaterThan(50_000)
		}
		expect(
			Object.values(slapConfig.lines).reduce(
				(total, lines) => total + lines.length,
				0
			)
		).toBe(40)
	})

	it("is deterministic for the same interaction seed", () => {
		const first = baseResult("stable-interaction")
		const second = baseResult("stable-interaction")

		expect(second).toEqual(first)
		expect(first.imageUrl).toContain(
			`/assets/slap/scenes/${first.fishSlug}/${first.outcome}-`
		)
	})

	it("handles self, Hermit, Rock Lobster, and generic bots explicitly", () => {
		const actor = { id: "actor-1", bot: false }
		const outcomeFor = (target: { id: string; bot: boolean }) =>
			generateSlapResult({
				seed: `special:${target.id}`,
				actor,
				target
			}).outcome

		expect(outcomeFor(actor)).toBe("self")
		expect(
			outcomeFor({ id: slapConfig.hermitUserId, bot: true })
		).toBe("hermit")
		expect(
			outcomeFor({ id: slapConfig.rockLobsterUserId, bot: true })
		).toBe("rock_lobster")
		expect(outcomeFor({ id: "another-bot", bot: true })).toBe("bot")
	})
})

describe("slap event ledger", () => {
	it("creates one durable event and reuses it for interaction retries", async () => {
		const { owner, database } = testDatabase()
		try {
			const first = await createEvent()
			const retry = await createEvent(
				{},
				new Date("2026-07-16T18:00:05.000Z")
			)

			expect(first.kind).toBe("created")
			expect(retry.kind).toBe("existing")
			if (first.kind !== "cooldown" && retry.kind !== "cooldown") {
				expect(retry.event.id).toBe(first.event.id)
				expect(formatSlapIncidentId(first.event.id)).toBe("FSH-0001")
			}
			expect(
				owner.database
					.query("select count(*) as count from slap_events")
					.get()
			).toEqual({ count: 1 })
		} finally {
			owner.close()
		}
	})

	it("enforces actor, target, and channel cooldowns independently", async () => {
		const { owner } = testDatabase()
		try {
			await createEvent()

			const actorCooldown = await createEvent(
				{
					interactionId: "interaction-actor",
					targetId: "target-2",
					channelId: "channel-2"
				},
				new Date("2026-07-16T18:00:05.000Z")
			)
			const targetCooldown = await createEvent(
				{
					interactionId: "interaction-target",
					actorId: "actor-2",
					channelId: "channel-3"
				},
				new Date("2026-07-16T18:00:35.000Z")
			)
			const channelCooldown = await createEvent(
				{
					interactionId: "interaction-channel",
					actorId: "actor-3",
					targetId: "target-3"
				},
				new Date("2026-07-16T18:00:05.000Z")
			)
			const afterCooldowns = await createEvent(
				{
					interactionId: "interaction-later",
					actorId: "actor-4",
					targetId: "target-4",
					channelId: "channel-4"
				},
				new Date("2026-07-16T18:01:31.000Z")
			)

			expect(actorCooldown).toEqual(
				expect.objectContaining({
					kind: "cooldown",
					cooldowns: [
						expect.objectContaining({ kind: "actor" })
					]
				})
			)
			expect(targetCooldown).toEqual(
				expect.objectContaining({
					kind: "cooldown",
					cooldowns: [
						expect.objectContaining({ kind: "target" })
					]
				})
			)
			expect(channelCooldown).toEqual(
				expect.objectContaining({
					kind: "cooldown",
					cooldowns: [
						expect.objectContaining({ kind: "channel" })
					]
				})
			)
			expect(afterCooldowns.kind).toBe("created")
		} finally {
			owner.close()
		}
	})

	it("records at most one counter and one stable appeal ruling", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createEvent()
			expect(creation.kind).toBe("created")
			if (creation.kind === "cooldown") {
				return
			}
			const event = creation.event
			const counter = generateSlapResult({
				seed: `counter:${event.interactionId}`,
				actor: { id: event.targetId, bot: false },
				target: { id: event.actorId, bot: false },
				mode: "counter"
			})

			const firstCounter = await recordSlapCounter(
				event.id,
				event.targetId,
				event.actorId,
				counter,
				new Date("2026-07-16T18:00:10.000Z"),
				database
			)
			const secondCounter = await recordSlapCounter(
				event.id,
				event.targetId,
				event.actorId,
				baseResult("different-counter"),
				new Date("2026-07-16T18:00:11.000Z"),
				database
			)
			const ruling = getAppealRuling(event.id)
			const firstAppeal = await recordSlapAppeal(
				event.id,
				event.targetId,
				ruling,
				new Date("2026-07-16T18:00:12.000Z"),
				database
			)
			const secondAppeal = await recordSlapAppeal(
				event.id,
				event.targetId,
				"Different ruling",
				new Date("2026-07-16T18:00:13.000Z"),
				database
			)

			expect(firstCounter?.kind).toBe("recorded")
			expect(secondCounter?.kind).toBe("already_recorded")
			expect(secondCounter?.event.counterNarrative).toBe(counter.narrative)
			expect(firstAppeal?.kind).toBe("recorded")
			expect(secondAppeal?.kind).toBe("already_recorded")
			expect(secondAppeal?.event.appealRuling).toBe(ruling)
		} finally {
			owner.close()
		}
	})
})

describe("slap Carbon incident card", () => {
	it("renders art, metrics, incident controls, and counter state", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createEvent()
			if (creation.kind === "cooldown") {
				throw new Error("Unexpected cooldown")
			}
			const event = creation.event
			const initialPayload = serializePayload({
				components: [buildSlapIncidentContainer(event)]
			}) as { components?: unknown[] }
			const initialComponents = flattenComponents(initialPayload)
			const initialText = payloadText({
				components: [buildSlapIncidentContainer(event)]
			})
			const buttons = initialComponents.filter(
				(component) => component.type === 2
			)
			const gallery = initialComponents.find(
				(component) => component.type === 12
			)

			expect(initialText).toContain("Fishery Incident FSH-0001")
			expect(initialText).toContain("Impact:")
			expect(gallery).toBeDefined()
			expect(buttons).toEqual([
				expect.objectContaining({
					custom_id: `slap-back:id=${event.id}`,
					disabled: false
				}),
				expect.objectContaining({
					custom_id: `slap-appeal:id=${event.id}`,
					disabled: false
				})
			])

			const counter = generateSlapResult({
				seed: "counter-card",
				actor: { id: event.targetId, bot: false },
				target: { id: event.actorId, bot: false },
				mode: "counter"
			})
			const recorded = await recordSlapCounter(
				event.id,
				event.targetId,
				event.actorId,
				counter,
				new Date(),
				database
			)
			expect(recorded).not.toBeNull()
			const counterText = payloadText({
				components: [buildSlapIncidentContainer(recorded!.event)]
			})
			expect(counterText).toContain("Counter-filing accepted")
		} finally {
			owner.close()
		}
	})
})

describe("/slap and Fish Slap", () => {
	it("register both entry points as guild-only staff commands", () => {
		const slash = new SlapCommand()
		const context = new FishSlapContextCommand()

		for (const command of [slash, context]) {
			expect(command.contexts).toEqual([InteractionContextType.Guild])
			expect(command.integrationTypes).toEqual([
				ApplicationIntegrationType.GuildInstall
			])
			expect(command.guildIds).toEqual([slapConfig.guildId])
			expect(command.defer).toBe(false)
		}
		expect(context.name).toBe("Fish Slap")
		expect(context.type).toBe(ApplicationCommandType.User)
	})

	it("authorizes Community Team and both Maintainer roles", () => {
		expect(slapConfig.authorizedRoleIds).toEqual([
			"1477360613125787678",
			"1457214688806047756",
			"1503268035908075590"
		])
		for (const roleId of slapConfig.authorizedRoleIds) {
			expect(hasSlapRole([roleId])).toBe(true)
		}
		expect(hasSlapRole(["unrelated-role"])).toBe(false)
	})

	it("rejects users outside the authorized roles before touching D1", async () => {
		const replies: unknown[] = []
		const interaction = {
			rawData: {
				id: "unauthorized-interaction",
				guild_id: slapConfig.guildId,
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

		await new SlapCommand().run(interaction)

		expect(payloadText(replies[0])).toContain(
			"Community Team or Maintainer roles only"
		)
		expect(replies[0]).toEqual(expect.objectContaining({ ephemeral: true }))
	})

	it("allows Maintainers to publish the canonical incident card", async () => {
		const { owner } = testDatabase()
		try {
			const replies: unknown[] = []
			let deferred = false
			const interaction = {
				rawData: {
					id: "authorized-interaction",
					guild_id: slapConfig.guildId,
					channel_id: "channel-command"
				},
				member: {
					roles: [{ id: slapConfig.authorizedRoleIds[1] }]
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

			await new SlapCommand().run(interaction)

			const stored = owner.database
				.query(
					"select message_id as messageId, interaction_id as interactionId from slap_events"
				)
				.get() as { messageId: string; interactionId: string }
			expect(deferred).toBe(true)
			expect(stored).toEqual({
				messageId: "message-command",
				interactionId: "authorized-interaction"
			})
			expect(payloadText(replies[0])).toContain("Fishery Incident FSH-0001")
		} finally {
			owner.close()
		}
	})
})

describe("slap buttons", () => {
	it("restricts slap-back to an authorized target, then updates once", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createEvent()
			if (creation.kind === "cooldown") {
				throw new Error("Unexpected cooldown")
			}
			const event = await bindSlapMessage(
				creation.event.id,
				"message-1",
				new Date(),
				database
			)
			expect(event).not.toBeNull()

			const makeInteraction = (userId: string, roles: string[]) => {
				const replies: unknown[] = []
				const updates: unknown[] = []
				const interaction = {
					rawData: {
						guild_id: slapConfig.guildId,
						channel_id: "channel-1",
						message: { id: "message-1" }
					},
					user: { id: userId },
					userId,
					member: { roles: roles.map((id) => ({ id })) },
					reply: async (payload: unknown) => {
						replies.push(payload)
					},
					update: async (payload: unknown) => {
						updates.push(payload)
					}
				} as unknown as ButtonInteraction
				return { interaction, replies, updates }
			}

			const wrongUser = makeInteraction("someone-else", [])
			await handleSlapBack(wrongUser.interaction, { id: event!.id })
			expect(payloadText(wrongUser.replies[0])).toContain(
				"Only the named target"
			)

			const noRole = makeInteraction(event!.targetId, ["unrelated-role"])
			await handleSlapBack(noRole.interaction, { id: event!.id })
			expect(payloadText(noRole.replies[0])).toContain(
				"Community Team or Maintainer role"
			)

			const target = makeInteraction(
				event!.targetId,
				[slapConfig.authorizedRoleIds[2]]
			)
			await handleSlapBack(target.interaction, { id: event!.id })
			expect(target.updates).toHaveLength(1)
			expect(payloadText(target.updates[0])).toContain(
				"Counter-filing accepted"
			)

			const stored = await getSlapEvent(event!.id, database)
			expect(stored?.counteredAt).not.toBeNull()
		} finally {
			owner.close()
		}
	})

	it("returns a private, stable ruling only to the target", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createEvent()
			if (creation.kind === "cooldown") {
				throw new Error("Unexpected cooldown")
			}
			const event = await bindSlapMessage(
				creation.event.id,
				"message-appeal",
				new Date(),
				database
			)
			const replies: unknown[] = []
			const messageEdits: unknown[] = []
			const interaction = {
				rawData: {
					guild_id: slapConfig.guildId,
					channel_id: "channel-1",
					message: { id: "message-appeal" }
				},
				user: { id: event!.targetId },
				userId: event!.targetId,
				member: { roles: [] },
				message: {
					edit: async (payload: unknown) => {
						messageEdits.push(payload)
					}
				},
				reply: async (payload: unknown) => {
					replies.push(payload)
				},
				update: async () => {}
			} as unknown as ButtonInteraction

			await handleSlapAppeal(interaction, { id: event!.id })

			expect(messageEdits).toHaveLength(1)
			expect(replies).toHaveLength(1)
			expect(replies[0]).toEqual(
				expect.objectContaining({ ephemeral: true })
			)
			expect(payloadText(replies[0])).toContain(
				getAppealRuling(event!.id)
			)
			const stored = await getSlapEvent(event!.id, database)
			expect(stored?.appealRuling).toBe(getAppealRuling(event!.id))
		} finally {
			owner.close()
		}
	})
})
