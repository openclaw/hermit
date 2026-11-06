import { type Client, Routes } from "@buape/carbon"
import BetaCommand from "../commands/beta.js"
import { betaPingsConfig } from "../config/betaPings.js"

export class BetaRegistrationError extends Error {}

const expected = () => new BetaCommand().serialize()

function hasCorrectBeta(commands: unknown): boolean {
	if (!Array.isArray(commands) || commands.some((command) =>
		!command || typeof command.name !== "string" || typeof command.type !== "number")) {
		throw new BetaRegistrationError("Discord returned an invalid command list.")
	}
	const matches = commands.filter((command) => command?.name === "beta")
	if (!matches.length) return false
	const command = matches[0]
	const metadata = expected()
	// Discord may omit contexts/integration_types for guild-scoped commands.
	if (matches.length !== 1 || command.type !== metadata.type ||
		command.description !== new BetaCommand().description ||
		(command.default_member_permissions ?? null) !== metadata.default_member_permissions ||
		!Array.isArray(command.options ?? []) || (command.options ?? []).length !== 0 ||
		(command.nsfw ?? false) !== false ||
		Object.keys(command.name_localizations ?? {}).length !== 0 ||
		Object.keys(command.description_localizations ?? {}).length !== 0 ||
		(command.contexts !== undefined && JSON.stringify(command.contexts) !== JSON.stringify(metadata.contexts)) ||
		(command.integration_types !== undefined && JSON.stringify(command.integration_types) !== JSON.stringify(metadata.integration_types))) {
		throw new BetaRegistrationError("An existing /beta command conflicts with the expected configuration. Nothing was overwritten; ask an operator to review it.")
	}
	return true
}

// A factory gives separate Worker isolates independent flights. D1, not this map,
// is the cross-isolate authority. Settled flights are never cached.
export function createBetaCommandEnsurer() {
	const flights = new Map<string, Promise<void>>()
	return (client: Client, db: D1Database): Promise<void> => {
		const applicationId = client.options.clientId
		const guildId = betaPingsConfig.guildId
		const key = "beta-command-registration:v1:" + applicationId + ":" + guildId
		const existing = flights.get(key)
		if (existing) return existing
		const flight = (async () => {
			// Hermit's existing client disables Carbon's automatic 429 retries.
			// Refuse to register if that safety property changes.
			if (!applicationId || client.rest.options.queueRequests !== false) {
				throw new BetaRegistrationError("Safe command registration is unavailable. Ask an operator to check the bot configuration.")
			}
			const route = Routes.applicationGuildCommands(applicationId, guildId)
			if (hasCorrectBeta(await client.rest.get(route))) return
			const now = Date.now()
			// Non-expiring intent: a timeout must never allow a stale writer and a
			// new writer to POST concurrently. Future explicit invocations still
			// GET, but a missing command after an attempt requires operator review.
			const claimed = await db.prepare(
				'INSERT INTO keyValue (key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING RETURNING key'
			).bind(key, JSON.stringify({ status: "attempted", startedAt: now }), now, now).first<{ key: string }>()
			if (!claimed) {
				throw new BetaRegistrationError("A /beta registration is pending or was already attempted. Nothing was retried. Ask an operator to inspect the command and registration state.")
			}
			// Recheck under the cross-isolate guard, including external changes.
			if (hasCorrectBeta(await client.rest.get(route))) return
			await client.rest.post(route, { body: expected() })
			if (!hasCorrectBeta(await client.rest.get(route))) {
				throw new BetaRegistrationError("The /beta registration could not be confirmed. Nothing was retried; ask an operator to inspect it.")
			}
		})().finally(() => flights.delete(key))
		flights.set(key, flight)
		return flight
	}
}

export const ensureBetaCommand = createBetaCommandEnsurer()
