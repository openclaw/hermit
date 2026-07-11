import { Database } from "bun:sqlite"
import { describe, expect, it, spyOn } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { Routes } from "@buape/carbon"
import NominateCommand from "../src/commands/nominate.js"
import { nominationConfig } from "../src/config/nominations.js"
import { setRuntimeEnv } from "../src/runtime/env.js"
import { handleNominationVote } from "../src/services/nominationVoting.js"
import { SqliteD1Database } from "./helpers/sqliteD1.js"

const migrationPaths = readdirSync("drizzle")
	.filter((file) => /000[4-9]_.*\.sql/.test(file))
	.sort()

const applyMigrations = (database: Database) => {
	for (const path of migrationPaths) {
		const migration = readFileSync(`drizzle/${path}`, "utf8")
		for (const statement of migration.split("--> statement-breakpoint")) {
			const trimmed = statement.trim()
			if (trimmed) {
				database.run(trimmed)
			}
		}
	}
}

const createInteraction = (
	channelId: string,
	options: {
		reason?: string
		postError?: Error
		targetId?: string
		targetBot?: boolean
		targetMember?: { roles: Array<{ id: string }> } | null
	} = {}
) => {
	const posts: Array<{ route: string; payload: unknown }> = []
	const replies: unknown[] = []
	const deletes: string[] = []
	const interaction = {
		rawData: { channel_id: channelId },
		channel: { id: channelId },
		guild: {
			fetchMember: async () =>
				options.targetMember === undefined
					? { roles: [] }
					: options.targetMember
		},
		user: { id: "nominator-1" },
		options: {
			getUser: () => ({
				id: options.targetId ?? "nominee-1",
				bot: options.targetBot ?? false
			}),
			getString: () =>
				options.reason === undefined
					? "excellent shell judgment"
					: options.reason
		},
		defer: async () => {},
		reply: async (payload: unknown) => {
			replies.push(payload)
			return null
		},
		client: {
			rest: {
				post: async (route: string, payload: unknown) => {
					if (options.postError) {
						throw options.postError
					}
					posts.push({ route, payload })
					return { id: "review-message-1" }
				},
				delete: async (route: string) => {
					deletes.push(route)
				}
			}
		}
	}

	return { interaction, posts, replies, deletes }
}

const createReviewNomination = (
	database: Database,
	status = "submitted"
) => {
	database.run(
		`insert into nominations (
			guild_id,
			channel_id,
			nominee_id,
			nominator_id,
			reason,
			message_id,
			expires_at,
			target_role_id,
			required_approvals,
			status,
			desired_card_revision,
			synced_card_revision
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			nominationConfig.guildId,
			nominationConfig.reviewChannelId,
			"nominee-1",
			"nominator-1",
			"excellent shell judgment",
			"review-message-1",
			"2099-01-01T00:00:00.000Z",
			nominationConfig.targetRoleId,
			3,
			status,
			1,
			1
		]
	)

	return Number(database.query("select last_insert_rowid() as id").get()?.id)
}

describe("/nominate routing", () => {
	it("accepts only Shell Society and posts the review card privately to CT general", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		try {
			const { interaction, posts, replies } = createInteraction(
				nominationConfig.nominationChannelId
			)

			await new NominateCommand().run(interaction as never)

			expect(posts).toHaveLength(1)
			expect(posts[0]?.route).toBe(
				Routes.channelMessages(nominationConfig.reviewChannelId)
			)
			expect(posts[0]?.route).not.toBe(
				Routes.channelMessages(nominationConfig.nominationChannelId)
			)
			const nomination = owner.database
				.query(
					"select channel_id as channelId, message_id as messageId from nominations"
				)
				.get()
			expect(nomination).toEqual({
				channelId: nominationConfig.reviewChannelId,
				messageId: "review-message-1"
			})
			expect(replies).toHaveLength(1)
			expect(replies[0]).toMatchObject({ ephemeral: true })
		} finally {
			owner.close()
		}
	})

	for (const [label, channelId] of [
		["old nomination channel", "1471743636592001024"],
		["another channel", "1519064274561929000"]
	] as const) {
		it(`rejects the ${label} without posting a review card`, async () => {
			const owner = new SqliteD1Database()
			applyMigrations(owner.database)
			setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
			try {
				const { interaction, posts, replies } = createInteraction(channelId)

				await new NominateCommand().run(interaction as never)

				expect(posts).toHaveLength(0)
				expect(replies).toHaveLength(1)
				expect(replies[0]).toMatchObject({ ephemeral: true })
				const count = owner.database
					.query("select count(*) as count from nominations")
					.get() as { count: number }
				expect(count.count).toBe(0)
			} finally {
				owner.close()
			}
		})
	}

	for (const [label, options] of [
		["self nomination", { targetId: "nominator-1" }],
		["bot nomination", { targetBot: true }],
		["missing reason", { reason: "" }],
		[
			"overlong reason",
			{ reason: "x".repeat(nominationConfig.maxReasonLength + 1) }
		],
		["missing guild member", { targetMember: null }],
		[
			"existing Shell Society member",
			{
				targetMember: {
					roles: [{ id: nominationConfig.targetRoleId }]
				}
			}
		]
	] as const) {
		it(`rejects ${label} without creating a nomination`, async () => {
			const owner = new SqliteD1Database()
			applyMigrations(owner.database)
			setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
			try {
				const { interaction, posts, replies } = createInteraction(
					nominationConfig.nominationChannelId,
					options
				)

				await new NominateCommand().run(interaction as never)

				expect(posts).toHaveLength(0)
				expect(replies).toHaveLength(1)
				expect(replies[0]).toMatchObject({ ephemeral: true })
				const count = owner.database
					.query("select count(*) as count from nominations")
					.get() as { count: number }
				expect(count.count).toBe(0)
			} finally {
				owner.close()
			}
		})
	}

	it("rejects a duplicate active nomination without posting another card", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		try {
			const first = createInteraction(nominationConfig.nominationChannelId)
			const second = createInteraction(nominationConfig.nominationChannelId)

			await new NominateCommand().run(first.interaction as never)
			await new NominateCommand().run(second.interaction as never)

			expect(first.posts).toHaveLength(1)
			expect(second.posts).toHaveLength(0)
			expect(second.replies).toHaveLength(1)
			expect(second.replies[0]).toMatchObject({ ephemeral: true })
			const count = owner.database
				.query("select count(*) as count from nominations")
				.get() as { count: number }
			expect(count.count).toBe(1)
		} finally {
			owner.close()
		}
	})

	it("releases the nomination when the private review card cannot be posted", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		try {
			const { interaction, posts, replies } = createInteraction(
				nominationConfig.nominationChannelId,
				{ postError: new Error("Discord unavailable") }
			)

			await new NominateCommand().run(interaction as never)

			expect(posts).toHaveLength(0)
			expect(replies).toHaveLength(1)
			expect(replies[0]).toMatchObject({ ephemeral: true })
			const count = owner.database
				.query("select count(*) as count from nominations")
				.get() as { count: number }
			expect(count.count).toBe(0)
		} finally {
			owner.close()
		}
	})
})

describe("nomination component binding", () => {
	it("rejects forged guild, channel, and message bindings without storing a vote", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		owner.database.run(
			`insert into nominations (
				guild_id,
				channel_id,
				nominee_id,
				nominator_id,
				reason,
				message_id,
				expires_at,
				target_role_id,
				required_approvals,
				status
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				nominationConfig.guildId,
				nominationConfig.reviewChannelId,
				"nominee-1",
				"nominator-1",
				"excellent shell judgment",
				"review-message-1",
				"2099-01-01T00:00:00.000Z",
				nominationConfig.targetRoleId,
				3,
				"submitted"
			]
		)
		const nominationId = Number(
			owner.database.query("select last_insert_rowid() as id").get()?.id
		)
		const bindings = [
			{
				guild_id: "wrong-guild",
				channel_id: nominationConfig.reviewChannelId,
				message: { id: "review-message-1" }
			},
			{
				guild_id: nominationConfig.guildId,
				channel_id: "wrong-channel",
				message: { id: "review-message-1" }
			},
			{
				guild_id: nominationConfig.guildId,
				channel_id: nominationConfig.reviewChannelId,
				message: { id: "wrong-message" }
			}
		]

		try {
			for (const rawData of bindings) {
				const replies: unknown[] = []
				await handleNominationVote(
					{
						rawData,
						member: {
							roles: [{ id: nominationConfig.approverRoleIds[0] }]
						},
						user: { id: "reviewer-1" },
						userId: "reviewer-1",
						reply: async (payload: unknown) => {
							replies.push(payload)
						},
						client: { rest: {} }
					} as never,
					{ id: nominationId },
					"approve"
				)
				expect(replies).toHaveLength(1)
			}

			const count = owner.database
				.query("select count(*) as count from nomination_approvals")
				.get() as { count: number }
			expect(count.count).toBe(0)
		} finally {
			owner.close()
		}
	})

	it("requires the Community Team role for both vote controls", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({ DB: owner as unknown as D1Database } as Env)
		const nominationId = createReviewNomination(owner.database)
		try {
			for (const choice of ["approve", "decline"] as const) {
				const replies: unknown[] = []
				await handleNominationVote(
					{
						rawData: {
							guild_id: nominationConfig.guildId,
							channel_id: nominationConfig.reviewChannelId,
							message: { id: "review-message-1" }
						},
						member: { roles: [{ id: "unrelated-role" }] },
						user: { id: `reviewer-${choice}` },
						userId: `reviewer-${choice}`,
						reply: async (payload: unknown) => {
							replies.push(payload)
						},
						client: { rest: {} }
					} as never,
					{ id: nominationId },
					choice
				)
				expect(replies).toHaveLength(1)
				expect(replies[0]).toMatchObject({ ephemeral: true })
			}

			const count = owner.database
				.query("select count(*) as count from nomination_approvals")
				.get() as { count: number }
			expect(count.count).toBe(0)
		} finally {
			owner.close()
		}
	})

	it("approves privately after the third approval and grants the role", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({
			DB: owner as unknown as D1Database,
			DISCORD_BOT_TOKEN: "test-token"
		} as Env)
		const nominationId = createReviewNomination(owner.database)
		for (const reviewerId of ["reviewer-1", "reviewer-2"]) {
			owner.database.run(
				"insert into nomination_approvals (nomination_id, approver_id, vote_choice) values (?, ?, 'approve')",
				[nominationId, reviewerId]
			)
		}
		const patchRoutes: string[] = []
		const postRoutes: string[] = []
		const replies: unknown[] = []
		const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response(null, { status: 204 })
		)
		const consoleLog = spyOn(console, "log").mockImplementation(() => {})
		try {
			await handleNominationVote(
				{
					rawData: {
						guild_id: nominationConfig.guildId,
						channel_id: nominationConfig.reviewChannelId,
						message: { id: "review-message-1" }
					},
					member: {
						roles: [{ id: nominationConfig.approverRoleIds[0] }]
					},
					user: { id: "reviewer-3" },
					userId: "reviewer-3",
					reply: async (payload: unknown) => {
						replies.push(payload)
					},
					client: {
						rest: {
							patch: async (route: string) => {
								patchRoutes.push(route)
							},
							post: async (route: string) => {
								postRoutes.push(route)
							}
						}
					}
				} as never,
				{ id: nominationId },
				"approve"
			)

			const nomination = owner.database
				.query("select status from nominations where id = ?")
				.get(nominationId) as { status: string }
			expect(nomination.status).toBe("approved")
			expect(fetchSpy).toHaveBeenCalledTimes(1)
			expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
				`/guilds/${nominationConfig.guildId}/members/nominee-1/roles/${nominationConfig.targetRoleId}`
			)
			expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" })
			expect(patchRoutes).toHaveLength(2)
			expect(
				patchRoutes.every(
					(route) =>
						route ===
						Routes.channelMessage(
							nominationConfig.reviewChannelId,
							"review-message-1"
						)
				)
			).toBe(true)
			expect(postRoutes).toHaveLength(0)
			expect(replies).toHaveLength(1)
			expect(replies[0]).toMatchObject({ ephemeral: true })
		} finally {
			consoleLog.mockRestore()
			fetchSpy.mockRestore()
			owner.close()
		}
	})

	it("declines privately after the third decline without granting a role", async () => {
		const owner = new SqliteD1Database()
		applyMigrations(owner.database)
		setRuntimeEnv({
			DB: owner as unknown as D1Database,
			DISCORD_BOT_TOKEN: "test-token"
		} as Env)
		const nominationId = createReviewNomination(owner.database)
		for (const reviewerId of ["reviewer-1", "reviewer-2"]) {
			owner.database.run(
				"insert into nomination_approvals (nomination_id, approver_id, vote_choice) values (?, ?, 'decline')",
				[nominationId, reviewerId]
			)
		}
		const patchRoutes: string[] = []
		const postRoutes: string[] = []
		const replies: unknown[] = []
		const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response(null, { status: 204 })
		)
		const consoleLog = spyOn(console, "log").mockImplementation(() => {})
		try {
			await handleNominationVote(
				{
					rawData: {
						guild_id: nominationConfig.guildId,
						channel_id: nominationConfig.reviewChannelId,
						message: { id: "review-message-1" }
					},
					member: {
						roles: [{ id: nominationConfig.approverRoleIds[0] }]
					},
					user: { id: "reviewer-3" },
					userId: "reviewer-3",
					reply: async (payload: unknown) => {
						replies.push(payload)
					},
					client: {
						rest: {
							patch: async (route: string) => {
								patchRoutes.push(route)
							},
							post: async (route: string) => {
								postRoutes.push(route)
							}
						}
					}
				} as never,
				{ id: nominationId },
				"decline"
			)

			const nomination = owner.database
				.query("select status from nominations where id = ?")
				.get(nominationId) as { status: string }
			expect(nomination.status).toBe("declined")
			expect(fetchSpy).not.toHaveBeenCalled()
			expect(patchRoutes).toEqual([
				Routes.channelMessage(
					nominationConfig.reviewChannelId,
					"review-message-1"
				)
			])
			expect(postRoutes).toHaveLength(0)
			expect(replies).toHaveLength(1)
			expect(replies[0]).toMatchObject({ ephemeral: true })
		} finally {
			consoleLog.mockRestore()
			fetchSpy.mockRestore()
			owner.close()
		}
	})
})
