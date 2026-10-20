import {
	ApplicationCommandType,
	type APIApplicationCommand,
	type Client,
	Routes
} from "@buape/carbon"
import { nominationConfig } from "../config/nominations.js"
import type { HermitEnv } from "../runtime/env.js"

// Shared D1 state, not isolate memory: concurrent/cold Workers must not repeat
// registrations. Claim the entire cooldown before any Discord request, so an
// ambiguous failure or a terminated Worker cannot cause an immediate retry.
export const nominationCommandCheckIntervalMs = 60 * 60 * 1000

type RecoveryResult = "skipped" | "present" | "created" | "failed"

type RecoveryOptions = {
	now?: () => number
}

const hasNominate = (commands: unknown) => {
	if (!Array.isArray(commands) || commands.some((command) =>
		!command || typeof command.name !== "string" ||
		typeof command.type !== "number"
	)) {
		throw new Error("Invalid Discord application-command inventory")
	}
	return (commands as APIApplicationCommand[]).some((command) =>
		command.name === nominationConfig.commandName &&
		command.type === ApplicationCommandType.ChatInput
	)
}

export const runNominationCommandRecovery = async (
	client: Client,
	env: Pick<HermitEnv, "DB" | "DISCORD_CLIENT_ID">,
	options: RecoveryOptions = {}
): Promise<RecoveryResult> => {
	const applicationId = env.DISCORD_CLIENT_ID
	if (!applicationId || applicationId !== client.options.clientId ||
		client.options.devGuilds?.length) {
		return "skipped"
	}
	const command = client.commands.find((candidate) =>
		candidate.name === nominationConfig.commandName &&
		candidate.type === ApplicationCommandType.ChatInput
	)
	if (!command || command.guildIds?.length) return "skipped"

	const now = options.now ?? Date.now
	const key = `command-recovery:nominate:${applicationId}`
	const checkedAt = now()
	const nextCheckAt = String(checkedAt + nominationCommandCheckIntervalMs)
	let database: D1DatabaseSession | undefined
	try {
		database = env.DB.withSession("first-primary")
		const claimed = await database.prepare(`
			INSERT INTO keyValue (key, value, createdAt, updatedAt)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value,
				updatedAt = excluded.updatedAt
			WHERE keyValue.value = CAST(CAST(keyValue.value AS INTEGER) AS TEXT)
				AND CAST(keyValue.value AS INTEGER) BETWEEN 0 AND ?
			RETURNING key
		`).bind(key, nextCheckAt, checkedAt, checkedAt, checkedAt)
			.first<{ key: string }>()
		if (!claimed) {
			const existing = await database.prepare(
				"SELECT value FROM keyValue WHERE key = ?"
			).bind(key).first<{ value: string }>()
			if (!existing || !/^(0|[1-9][0-9]*)$/.test(existing.value) ||
				!Number.isSafeInteger(Number(existing.value))) {
				throw new Error("Invalid nomination command recovery cooldown")
			}
			return "skipped"
		}

		const globalCommands = await client.rest.get(
			Routes.applicationCommands(applicationId)
		)
		if (hasNominate(globalCommands)) return "present"
		const guildCommands = await client.rest.get(
			Routes.applicationGuildCommands(applicationId, nominationConfig.guildId)
		)
		if (hasNominate(guildCommands)) return "present"

		// Create just the absent command. Never invoke deployCommands here:
		// Carbon bulk-overwrites guild commands even in reconcile mode.
		const created = await client.rest.post(
			Routes.applicationCommands(applicationId),
			{ body: command.serialize() }
		) as APIApplicationCommand
		if (!created?.id || created.name !== command.name ||
			created.type !== ApplicationCommandType.ChatInput) {
			throw new Error("Discord did not confirm nomination registration")
		}
		console.info(JSON.stringify({
			operation: "nomination_command_recovery",
			status: "created",
			applicationId,
			commandId: created.id
		}))
		return "created"
	} catch (error) {
		const details = error as { status?: number; retryAfter?: number }
		// Honor Discord backoff even when it exceeds our normal check interval.
		if (database && typeof details?.retryAfter === "number" &&
			Number.isFinite(details.retryAfter) && details.retryAfter > 0) {
			const retryAt = now() + Math.ceil(details.retryAfter * 1000)
			if (retryAt > Number(nextCheckAt)) {
				try {
					await database.prepare(`
						UPDATE keyValue SET value = ? WHERE key = ? AND value = ?
					`).bind(String(retryAt), key, nextCheckAt).run()
				} catch {
					console.error(JSON.stringify({
						operation: "nomination_command_recovery",
						status: "backoff_persistence_failed",
						applicationId
					}))
				}
			}
		}
		console.error(JSON.stringify({
			operation: "nomination_command_recovery",
			status: "failed",
			applicationId,
			httpStatus: details?.status ?? null
		}))
		return "failed"
	}
}
