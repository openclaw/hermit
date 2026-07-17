import { Database } from "bun:sqlite"
import {
	describe,
	expect,
	it
} from "bun:test"
import {
	readFileSync,
	readdirSync
} from "node:fs"
import { createSlapEvent } from "../src/data/slapEvents.js"
import {
	bindLobsterMessage,
	createLobsterEncounter,
	getLobsterEncounter,
	markLobsterPublicationFailed,
	recordLobsterResponse,
	type CreateLobsterEncounterInput
} from "../src/data/lobsterEncounters.js"
import { getPrimaryDb } from "../src/db.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import type { SlapResult } from "../src/services/slapEngine.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

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
		applyMigration(database, migrationPath)
	}
}

const applyMigration = (database: Database, migrationPath: string) => {
	const migration = readFileSync(`drizzle/${migrationPath}`, "utf8")
	for (const statement of migration.split("--> statement-breakpoint")) {
		const trimmed = statement.trim()
		if (trimmed.length > 0) {
			database.run(trimmed)
		}
	}
}

const testDatabase = () => {
	const owner = new SqliteD1Database()
	applyMigrations(owner.database)
	setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
	return { owner, database: getPrimaryDb() }
}

const databaseWithFailingCooldownDelete = (owner: SqliteD1Database) => {
	const batch = owner.batch.bind(owner) as unknown as (
		statements: unknown[]
	) => Promise<unknown[]>
	const binding = {
		prepare(query: string) {
			const statement = owner.prepare(query)
			if (!query.includes("delete from action_cooldown_events")) {
				return statement
			}
			return {
				bind() {
					return {
						async all() {
							throw new Error("forced cooldown deletion failure")
						}
					}
				}
			}
		},
		batch,
		exec: owner.exec.bind(owner),
		withSession() {
			return binding
		}
	}
	setRuntimeEnv({ DB: binding as unknown as D1Database } as Env)
	return getPrimaryDb()
}

const insertCooldownOrphan = (
	owner: SqliteD1Database,
	input: {
		interactionId: string
		actionKind: "slap" | "lobster"
		guildId: string
		channelId: string
		actorId: string
		targetId: string
		actorExpiresAt: string
		targetExpiresAt: string
		channelExpiresAt: string
		createdAt: string
	}
) => {
	owner.database.run(
		`insert into action_cooldown_events (
			interaction_id, action_kind, guild_id, channel_id, actor_id, target_id,
			actor_expires_at, target_expires_at, channel_expires_at, created_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.interactionId,
			input.actionKind,
			input.guildId,
			input.channelId,
			input.actorId,
			input.targetId,
			input.actorExpiresAt,
			input.targetExpiresAt,
			input.channelExpiresAt,
			input.createdAt
		]
	)
}

const baseEncounter = (
	overrides: Partial<CreateLobsterEncounterInput> = {}
): CreateLobsterEncounterInput => ({
	interactionId: "lobster-interaction-1",
	guildId: "guild-1",
	channelId: "channel-1",
	actorId: "actor-1",
	targetId: "target-1",
	targetIsBot: false,
	taxonomySnapshotId: "worms-2026-07-17",
	speciesAphiaId: 107703,
	speciesAcceptedName: "Homarus americanus",
	speciesDisplayName: "American lobster",
	speciesFamily: "Nephropidae",
	sceneId: "dockside-verdict",
	assetUrl: "https://lobster-assets.openclaw.ai/107703/dockside-verdict.webp",
	assetChecksum: "sha256:abc123",
	headline: "The dock has issued a claw-shaped ruling.",
	narrative: "An American lobster advances with both claws accounted for.",
	metrics: { clawPressure: 87, composure: 14 },
	accessibilityDescription:
		"An American lobster confronting the named target on a working dock.",
	...overrides
})

const slapResult: SlapResult = {
	fishSlug: "atlantic-cod",
	fishName: "Atlantic cod",
	rarity: "common",
	outcome: "direct_hit",
	headline: "A cod has entered the record.",
	narrative: "The fishery ledger remains unimpressed.",
	impact: 42,
	dignityRemaining: 58,
	fishCondition: "administratively intact",
	imageUrl: "https://example.com/cod.webp"
}

describe("lobster persistence", () => {
	it("backfills existing slap cooldown history during the additive migration", () => {
		const owner = new SqliteD1Database()
		try {
			applyMigration(owner.database, migrationPaths[0]!)
			owner.database.run(
				`insert into slap_events (
					interaction_id, guild_id, channel_id, actor_id, target_id,
					target_is_bot, fish_slug, fish_name, rarity, outcome, headline,
					narrative, impact, dignity_remaining, fish_condition, image_url,
					created_at, updated_at
				) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					"legacy-slap",
					"guild-1",
					"channel-1",
					"actor-1",
					"target-1",
					0,
					"cod",
					"Cod",
					"common",
					"direct_hit",
					"Legacy headline",
					"Legacy narrative",
					10,
					90,
					"fine",
					"https://example.com/cod.webp",
					"2026-07-17T12:00:00.000Z",
					"2026-07-17T12:00:00.000Z"
				]
			)
			applyMigration(owner.database, migrationPaths[1]!)

			expect(
				owner.database.query(
					`select interaction_id, action_kind, actor_expires_at,
						target_expires_at, channel_expires_at
					from action_cooldown_events`
				).get()
			).toEqual({
				interaction_id: "legacy-slap",
				action_kind: "slap",
				actor_expires_at: "2026-07-17T12:00:30.000Z",
				target_expires_at: "2026-07-17T12:01:30.000Z",
				channel_expires_at: "2026-07-17T12:00:12.000Z"
			})
		} finally {
			owner.close()
		}
	})

	it("reuses deterministic encounter data for interaction retries", async () => {
		const { owner, database } = testDatabase()
		try {
			const original = baseEncounter()
			const first = await createLobsterEncounter(
				original,
				new Date("2026-07-17T12:00:00.000Z"),
				database
			)
			const retry = await createLobsterEncounter(
				baseEncounter({
					guildId: "changed-guild",
					channelId: "changed-channel",
					actorId: "changed-actor",
					targetId: "changed-target",
					targetIsBot: true,
					taxonomySnapshotId: "changed-snapshot",
					speciesAphiaId: 999999,
					speciesAcceptedName: "Changed species",
					speciesDisplayName: "Changed display",
					speciesFamily: "Changed family",
					sceneId: "changed-scene",
					assetUrl: "https://example.com/changed.webp",
					assetChecksum: "sha256:changed",
					headline: "Changed headline",
					narrative: "Changed narrative",
					metrics: { changed: true },
					accessibilityDescription: "Changed accessibility"
				}),
				new Date("2026-07-17T12:00:05.000Z"),
				database
			)

			expect(first.kind).toBe("created")
			expect(retry.kind).toBe("existing")
			if (
				first.kind === "created" &&
				retry.kind === "existing"
			) {
				expect(retry.encounter.id).toBe(first.encounter.id)
				expect(retry.encounter.cooldownEventId).toBe(
					first.encounter.cooldownEventId
				)
				expect(retry.encounter).toMatchObject({
					interactionId: original.interactionId,
					guildId: original.guildId,
					channelId: original.channelId,
					actorId: original.actorId,
					targetId: original.targetId,
					targetIsBot: original.targetIsBot,
					taxonomySnapshotId: original.taxonomySnapshotId,
					speciesAphiaId: original.speciesAphiaId,
					speciesAcceptedName: original.speciesAcceptedName,
					speciesDisplayName: original.speciesDisplayName,
					speciesFamily: original.speciesFamily,
					sceneId: original.sceneId,
					assetUrl: original.assetUrl,
					assetChecksum: original.assetChecksum,
					headline: original.headline,
					narrative: original.narrative,
					metricsJson: JSON.stringify(original.metrics),
					accessibilityDescription: original.accessibilityDescription,
					publicationStatus: "pending",
					responseStatus: "pending",
					createdAt: first.encounter.createdAt
				})
			}
			expect(
				owner.database.query(
					"select count(*) as count from lobster_encounters"
				).get()
			).toEqual({ count: 1 })
		} finally {
			owner.close()
		}
	})

	it("refreshes an expired slap orphan before creating and blocks lobster", async () => {
		const { owner, database } = testDatabase()
		try {
			insertCooldownOrphan(owner, {
				interactionId: "expired-slap-orphan",
				actionKind: "slap",
				guildId: "guild-1",
				channelId: "channel-1",
				actorId: "actor-1",
				targetId: "target-1",
				actorExpiresAt: "2026-07-17T11:59:30.000Z",
				targetExpiresAt: "2026-07-17T12:00:30.000Z",
				channelExpiresAt: "2026-07-17T11:59:12.000Z",
				createdAt: "2026-07-17T11:59:00.000Z"
			})

			const recovered = await createSlapEvent(
				{
					interactionId: "expired-slap-orphan",
					guildId: "guild-1",
					channelId: "channel-1",
					actorId: "actor-1",
					targetId: "target-1",
					targetIsBot: false,
					result: slapResult
				},
				new Date("2026-07-17T12:02:00.000Z"),
				database
			)
			const claim = owner.database.query(
				`select actor_expires_at, target_expires_at, channel_expires_at,
					created_at
				from action_cooldown_events
				where interaction_id = 'expired-slap-orphan'`
			).get()
			const blocked = await createLobsterEncounter(
				baseEncounter({
					interactionId: "lobster-after-slap-recovery",
					channelId: "channel-2",
					targetId: "target-2"
				}),
				new Date("2026-07-17T12:02:01.000Z"),
				database
			)

			expect(recovered.kind).toBe("created")
			expect(claim).toEqual({
				actor_expires_at: "2026-07-17T12:02:30.000Z",
				target_expires_at: "2026-07-17T12:03:30.000Z",
				channel_expires_at: "2026-07-17T12:02:12.000Z",
				created_at: "2026-07-17T12:02:00.000Z"
			})
			expect(blocked).toEqual(
				expect.objectContaining({
					kind: "cooldown",
					cooldowns: [expect.objectContaining({ kind: "actor" })]
				})
			)
		} finally {
			owner.close()
		}
	})

	it("refreshes an expired lobster orphan before creating and blocks slap", async () => {
		const { owner, database } = testDatabase()
		try {
			insertCooldownOrphan(owner, {
				interactionId: "expired-lobster-orphan",
				actionKind: "lobster",
				guildId: "guild-1",
				channelId: "channel-1",
				actorId: "actor-1",
				targetId: "target-1",
				actorExpiresAt: "2026-07-17T11:59:30.000Z",
				targetExpiresAt: "2026-07-17T12:00:30.000Z",
				channelExpiresAt: "2026-07-17T11:59:12.000Z",
				createdAt: "2026-07-17T11:59:00.000Z"
			})

			const recovered = await createLobsterEncounter(
				baseEncounter({ interactionId: "expired-lobster-orphan" }),
				new Date("2026-07-17T12:02:00.000Z"),
				database
			)
			const claim = owner.database.query(
				`select actor_expires_at, target_expires_at, channel_expires_at,
					created_at
				from action_cooldown_events
				where interaction_id = 'expired-lobster-orphan'`
			).get()
			const blocked = await createSlapEvent(
				{
					interactionId: "slap-after-lobster-recovery",
					guildId: "guild-1",
					channelId: "channel-2",
					actorId: "actor-1",
					targetId: "target-2",
					targetIsBot: false,
					result: slapResult
				},
				new Date("2026-07-17T12:02:01.000Z"),
				database
			)

			expect(recovered.kind).toBe("created")
			expect(claim).toEqual({
				actor_expires_at: "2026-07-17T12:02:30.000Z",
				target_expires_at: "2026-07-17T12:03:30.000Z",
				channel_expires_at: "2026-07-17T12:02:12.000Z",
				created_at: "2026-07-17T12:02:00.000Z"
			})
			expect(blocked).toEqual(
				expect.objectContaining({
					kind: "cooldown",
					cooldowns: [expect.objectContaining({ kind: "actor" })]
				})
			)
		} finally {
			owner.close()
		}
	})

	it("does not reuse or delete active orphan claims for either action", async () => {
		const slapDb = testDatabase()
		try {
			insertCooldownOrphan(slapDb.owner, {
				interactionId: "active-slap-orphan",
				actionKind: "slap",
				guildId: "guild-1",
				channelId: "channel-1",
				actorId: "actor-1",
				targetId: "target-1",
				actorExpiresAt: "2026-07-17T12:02:30.000Z",
				targetExpiresAt: "2026-07-17T12:03:30.000Z",
				channelExpiresAt: "2026-07-17T12:02:12.000Z",
				createdAt: "2026-07-17T12:02:00.000Z"
			})
			const blocked = await createSlapEvent(
				{
					interactionId: "active-slap-orphan",
					guildId: "guild-1",
					channelId: "channel-1",
					actorId: "actor-1",
					targetId: "target-1",
					targetIsBot: false,
					result: slapResult
				},
				new Date("2026-07-17T12:02:01.000Z"),
				slapDb.database
			)

			expect(blocked.kind).toBe("cooldown")
			expect(
				slapDb.owner.database.query(
					"select created_at from action_cooldown_events"
				).get()
			).toEqual({ created_at: "2026-07-17T12:02:00.000Z" })
			expect(
				slapDb.owner.database.query(
					"select count(*) as count from slap_events"
				).get()
			).toEqual({ count: 0 })
		} finally {
			slapDb.owner.close()
		}

		const lobsterDb = testDatabase()
		try {
			insertCooldownOrphan(lobsterDb.owner, {
				interactionId: "active-lobster-orphan",
				actionKind: "lobster",
				guildId: "guild-1",
				channelId: "channel-1",
				actorId: "actor-1",
				targetId: "target-1",
				actorExpiresAt: "2026-07-17T12:02:30.000Z",
				targetExpiresAt: "2026-07-17T12:03:30.000Z",
				channelExpiresAt: "2026-07-17T12:02:12.000Z",
				createdAt: "2026-07-17T12:02:00.000Z"
			})
			const blocked = await createLobsterEncounter(
				baseEncounter({ interactionId: "active-lobster-orphan" }),
				new Date("2026-07-17T12:02:01.000Z"),
				lobsterDb.database
			)

			expect(blocked.kind).toBe("cooldown")
			expect(
				lobsterDb.owner.database.query(
					"select created_at from action_cooldown_events"
				).get()
			).toEqual({ created_at: "2026-07-17T12:02:00.000Z" })
			expect(
				lobsterDb.owner.database.query(
					"select count(*) as count from lobster_encounters"
				).get()
			).toEqual({ count: 0 })
		} finally {
			lobsterDb.owner.close()
		}
	})

	it("marks failed publication terminal and atomically releases its cooldown", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createLobsterEncounter(
				baseEncounter(),
				new Date("2026-07-17T12:00:00.000Z"),
				database
			)
			if (creation.kind !== "created") {
				throw new Error("Expected encounter creation")
			}

			const failure = await markLobsterPublicationFailed(
				creation.encounter.id,
				"Discord rejected the message",
				new Date("2026-07-17T12:00:01.000Z"),
				database
			)
			const retry = await createLobsterEncounter(
				baseEncounter(),
				new Date("2026-07-17T12:00:02.000Z"),
				database
			)
			const next = await createLobsterEncounter(
				baseEncounter({
					interactionId: "lobster-interaction-2",
					targetId: "target-2",
					channelId: "channel-2"
				}),
				new Date("2026-07-17T12:00:02.000Z"),
				database
			)

			expect(failure.kind).toBe("marked_failed")
			expect(retry.kind).toBe("publication_failed")
			expect(next.kind).toBe("created")
			expect(
				owner.database.query(
					"select count(*) as count from action_cooldown_events"
				).get()
			).toEqual({ count: 1 })
		} finally {
			owner.close()
		}
	})

	it("rolls back publication failure when cooldown deletion fails", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createLobsterEncounter(
				baseEncounter(),
				new Date("2026-07-17T12:00:00.000Z"),
				database
			)
			if (creation.kind !== "created") {
				throw new Error("Expected encounter creation")
			}
			const failingDatabase = databaseWithFailingCooldownDelete(owner)

			await expect(
				markLobsterPublicationFailed(
					creation.encounter.id,
					"Discord rejected the message",
					new Date("2026-07-17T12:00:01.000Z"),
					failingDatabase
				)
			).rejects.toThrow("forced cooldown deletion failure")

			expect(
				owner.database.query(
					`select publication_status, publication_failure,
						publication_failed_at
					from lobster_encounters
					where id = ?`
				).get(creation.encounter.id)
			).toEqual({
				publication_status: "pending",
				publication_failure: null,
				publication_failed_at: null
			})
			expect(
				owner.database.query(
					"select count(*) as count from action_cooldown_events"
				).get()
			).toEqual({ count: 1 })
		} finally {
			owner.close()
		}
	})

	it("binds the first Discord message idempotently and rejects replacement", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createLobsterEncounter(
				baseEncounter(),
				new Date("2026-07-17T12:00:00.000Z"),
				database
			)
			if (creation.kind !== "created") {
				throw new Error("Expected encounter creation")
			}

			const first = await bindLobsterMessage(
				creation.encounter.id,
				"guild-1",
				"channel-1",
				"message-a",
				new Date("2026-07-17T12:00:01.000Z"),
				database
			)
			const repeated = await bindLobsterMessage(
				creation.encounter.id,
				"guild-1",
				"channel-1",
				"message-a",
				new Date("2026-07-17T12:00:02.000Z"),
				database
			)
			const replacement = await bindLobsterMessage(
				creation.encounter.id,
				"guild-1",
				"channel-1",
				"message-b",
				new Date("2026-07-17T12:00:03.000Z"),
				database
			)

			expect(first.kind).toBe("bound")
			expect(repeated.kind).toBe("already_bound")
			expect(replacement.kind).toBe("conflict")
			expect(replacement.encounter?.messageId).toBe("message-a")
			expect(replacement.encounter?.publicationStatus).toBe("published")
		} finally {
			owner.close()
		}
	})

	it("allows exactly one concurrent Discord message binding", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createLobsterEncounter(
				baseEncounter(),
				new Date("2026-07-17T12:00:00.000Z"),
				database
			)
			if (creation.kind !== "created") {
				throw new Error("Expected encounter creation")
			}

			const results = await Promise.all([
				bindLobsterMessage(
					creation.encounter.id,
					"guild-1",
					"channel-1",
					"message-a",
					new Date("2026-07-17T12:00:01.000Z"),
					database
				),
				bindLobsterMessage(
					creation.encounter.id,
					"guild-1",
					"channel-1",
					"message-b",
					new Date("2026-07-17T12:00:01.000Z"),
					database
				)
			])
			const persisted = await getLobsterEncounter(
				creation.encounter.id,
				database
			)

			expect(results.filter((result) => result.kind === "bound")).toHaveLength(1)
			expect(results.filter((result) => result.kind === "conflict")).toHaveLength(1)
			expect(["message-a", "message-b"]).toContain(persisted?.messageId)
			expect(
				results.find((result) => result.kind === "bound")?.encounter?.messageId
			).toBe(persisted?.messageId)
		} finally {
			owner.close()
		}
	})

	it("shares cooldowns in both directions and resolves concurrent claims once", async () => {
		const firstDb = testDatabase()
		try {
			await createSlapEvent(
				{
					interactionId: "slap-first",
					guildId: "guild-1",
					channelId: "channel-1",
					actorId: "actor-1",
					targetId: "target-1",
					targetIsBot: false,
					result: slapResult
				},
				new Date("2026-07-17T12:00:00.000Z"),
				firstDb.database
			)
			const blocked = await createLobsterEncounter(
				baseEncounter({
					interactionId: "lobster-blocked",
					channelId: "channel-2",
					targetId: "target-2"
				}),
				new Date("2026-07-17T12:00:01.000Z"),
				firstDb.database
			)
			expect(blocked).toEqual(
				expect.objectContaining({
					kind: "cooldown",
					cooldowns: [expect.objectContaining({ kind: "actor" })]
				})
			)
		} finally {
			firstDb.owner.close()
		}

		const secondDb = testDatabase()
		try {
			await createLobsterEncounter(
				baseEncounter(),
				new Date("2026-07-17T12:00:00.000Z"),
				secondDb.database
			)
			const blocked = await createSlapEvent(
				{
					interactionId: "slap-blocked",
					guildId: "guild-1",
					channelId: "channel-2",
					actorId: "actor-1",
					targetId: "target-2",
					targetIsBot: false,
					result: slapResult
				},
				new Date("2026-07-17T12:00:01.000Z"),
				secondDb.database
			)
			expect(blocked).toEqual(
				expect.objectContaining({
					kind: "cooldown",
					cooldowns: [expect.objectContaining({ kind: "actor" })]
				})
			)
		} finally {
			secondDb.owner.close()
		}

		const raceDb = testDatabase()
		try {
			const results = await Promise.all([
				createSlapEvent(
					{
						interactionId: "slap-race",
						guildId: "guild-1",
						channelId: "channel-a",
						actorId: "shared-actor",
						targetId: "target-a",
						targetIsBot: false,
						result: slapResult
					},
					new Date("2026-07-17T12:00:00.000Z"),
					raceDb.database
				),
				createLobsterEncounter(
					baseEncounter({
						interactionId: "lobster-race",
						channelId: "channel-b",
						actorId: "shared-actor",
						targetId: "target-b"
					}),
					new Date("2026-07-17T12:00:00.000Z"),
					raceDb.database
				)
			])

			expect(results.filter((result) => result.kind === "created")).toHaveLength(1)
			expect(results.filter((result) => result.kind === "cooldown")).toHaveLength(1)
			expect(
				raceDb.owner.database.query(
					"select count(*) as count from action_cooldown_events"
				).get()
			).toEqual({ count: 1 })
			expect(
				raceDb.owner.database.query(
					`select
						(select count(*) from slap_events) +
						(select count(*) from lobster_encounters) as count`
				).get()
			).toEqual({ count: 1 })
		} finally {
			raceDb.owner.close()
		}
	})

	it("records exactly one target-only response without mixed counter fields", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createLobsterEncounter(
				baseEncounter(),
				new Date("2026-07-17T12:00:00.000Z"),
				database
			)
			if (creation.kind !== "created") {
				throw new Error("Expected encounter creation")
			}
			await bindLobsterMessage(
				creation.encounter.id,
				"guild-1",
				"channel-1",
				"message-1",
				new Date("2026-07-17T12:00:01.000Z"),
				database
			)
			const beforeUnauthorized = await getLobsterEncounter(
				creation.encounter.id,
				database
			)
			const unauthorized = await recordLobsterResponse(
				{
					encounterId: creation.encounter.id,
					guildId: "guild-1",
					channelId: "channel-1",
					messageId: "message-1",
					responderId: "someone-else",
					responderIsBot: false,
					responseType: "offer_butter",
					responseResult: { accepted: false }
				},
				new Date("2026-07-17T12:00:02.000Z"),
				database
			)
			const afterUnauthorized = await getLobsterEncounter(
				creation.encounter.id,
				database
			)
			expect(unauthorized.kind).toBe("unauthorized")
			expect(afterUnauthorized?.updatedAt).toBe(beforeUnauthorized?.updatedAt)
			expect(afterUnauthorized?.responseType).toBeNull()

			const counterA = {
				actorId: "target-1",
				targetId: "actor-1",
				sceneId: "return-a",
				assetUrl: "https://lobster-assets.openclaw.ai/107703/return-a.webp",
				assetChecksum: "sha256:return-a",
				headline: "Return A",
				narrative: "The lobster redirects the filing.",
				metrics: { returnForce: 91 },
				accessibilityDescription: "The lobster redirects toward the actor."
			}
			const results = await Promise.all([
				recordLobsterResponse(
					{
						encounterId: creation.encounter.id,
						guildId: "guild-1",
						channelId: "channel-1",
						messageId: "message-1",
						responderId: "target-1",
						responderIsBot: false,
						responseType: "return_to_sender",
						responseResult: { outcome: "returned" },
						counterEvent: counterA
					},
					new Date("2026-07-17T12:00:03.000Z"),
					database
				),
				recordLobsterResponse(
					{
						encounterId: creation.encounter.id,
						guildId: "guild-1",
						channelId: "channel-1",
						messageId: "message-1",
						responderId: "target-1",
						responderIsBot: false,
						responseType: "offer_butter",
						responseResult: { outcome: "released" }
					},
					new Date("2026-07-17T12:00:04.000Z"),
					database
				)
			])
			const persisted = await getLobsterEncounter(
				creation.encounter.id,
				database
			)

			expect(results.filter((result) => result.kind === "recorded")).toHaveLength(1)
			expect(
				results.filter((result) => result.kind === "already_recorded")
			).toHaveLength(1)
			expect([
				{
					responseType: "return_to_sender",
					responseResultJson: JSON.stringify({ outcome: "returned" }),
					counterSceneId: "return-a",
					counterHeadline: "Return A"
				},
				{
					responseType: "offer_butter",
					responseResultJson: JSON.stringify({ outcome: "released" }),
					counterSceneId: null,
					counterHeadline: null
				}
			]).toContainEqual({
				responseType: persisted?.responseType,
				responseResultJson: persisted?.responseResultJson,
				counterSceneId: persisted?.counterSceneId,
				counterHeadline: persisted?.counterHeadline
			})
			expect(persisted?.responseActorId).toBe("target-1")
			expect(persisted?.responseStatus).toBe("responded")
			expect(persisted?.respondedAt).not.toBeNull()
			if (persisted?.responseType === "return_to_sender") {
				expect(persisted).toMatchObject({
					responseResultJson: JSON.stringify({ outcome: "returned" }),
					counterActorId: counterA.actorId,
					counterTargetId: counterA.targetId,
					counterSceneId: counterA.sceneId,
					counterAssetUrl: counterA.assetUrl,
					counterAssetChecksum: counterA.assetChecksum,
					counterHeadline: counterA.headline,
					counterNarrative: counterA.narrative,
					counterMetricsJson: JSON.stringify(counterA.metrics),
					counterAccessibilityDescription:
						counterA.accessibilityDescription
				})
			} else {
				expect(persisted).toMatchObject({
					responseType: "offer_butter",
					responseResultJson: JSON.stringify({ outcome: "released" }),
					counterActorId: null,
					counterTargetId: null,
					counterSceneId: null,
					counterAssetUrl: null,
					counterAssetChecksum: null,
					counterHeadline: null,
					counterNarrative: null,
					counterMetricsJson: null,
					counterAccessibilityDescription: null
				})
			}
		} finally {
			owner.close()
		}
	})

	it("does not permit bot targets to record a response", async () => {
		const { owner, database } = testDatabase()
		try {
			const creation = await createLobsterEncounter(
				baseEncounter({
					targetId: "bot-target",
					targetIsBot: true
				}),
				new Date("2026-07-17T12:00:00.000Z"),
				database
			)
			if (creation.kind !== "created") {
				throw new Error("Expected encounter creation")
			}
			await bindLobsterMessage(
				creation.encounter.id,
				"guild-1",
				"channel-1",
				"message-bot",
				new Date("2026-07-17T12:00:01.000Z"),
				database
			)

			const response = await recordLobsterResponse(
				{
					encounterId: creation.encounter.id,
					guildId: "guild-1",
					channelId: "channel-1",
					messageId: "message-bot",
					responderId: "bot-target",
					responderIsBot: true,
					responseType: "offer_butter",
					responseResult: { accepted: true }
				},
				new Date("2026-07-17T12:00:02.000Z"),
				database
			)
			const persisted = await getLobsterEncounter(
				creation.encounter.id,
				database
			)

			expect(response.kind).toBe("unauthorized")
			expect(persisted?.responseStatus).toBe("pending")
			expect(persisted?.responseType).toBeNull()
		} finally {
			owner.close()
		}
	})
})
