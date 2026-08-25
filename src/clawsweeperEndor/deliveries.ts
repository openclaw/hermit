import { and, eq, sql } from "drizzle-orm"
import { getPrimaryDb } from "../db.js"
import {
	endorNotificationDeliveries,
	type EndorNotificationDelivery
} from "../db/schema.js"

export type ClaimEndorDeliveryInput = {
	idempotencyKey: string
	payloadDigest: string
	nonce: string
	channelId: string
}

export type ClaimEndorDeliveryResult =
	| { state: "claimed"; delivery: EndorNotificationDelivery }
	| { state: "existing"; delivery: EndorNotificationDelivery }
	| { state: "conflict"; delivery: EndorNotificationDelivery }

const now = sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

export const claimEndorDelivery = async (
	input: ClaimEndorDeliveryInput
): Promise<ClaimEndorDeliveryResult> => {
	const [created] = await getPrimaryDb()
		.insert(endorNotificationDeliveries)
		.values(input)
		.onConflictDoNothing({ target: endorNotificationDeliveries.idempotencyKey })
		.returning()

	if (created) {
		return { state: "claimed", delivery: created }
	}

	const [existing] = await getPrimaryDb()
		.select()
		.from(endorNotificationDeliveries)
		.where(eq(endorNotificationDeliveries.idempotencyKey, input.idempotencyKey))
		.limit(1)

	if (!existing) {
		throw new Error("Endor delivery claim disappeared after an idempotency conflict")
	}

	if (
		existing.payloadDigest !== input.payloadDigest ||
		existing.nonce !== input.nonce ||
		existing.channelId !== input.channelId
	) {
		return { state: "conflict", delivery: existing }
	}

	return { state: "existing", delivery: existing }
}

export const markEndorDeliveryDelivered = async (
	idempotencyKey: string,
	payloadDigest: string,
	messageId: string
): Promise<void> => {
	const [updated] = await getPrimaryDb()
		.update(endorNotificationDeliveries)
		.set({
			status: "delivered",
			messageId,
			deliveredAt: now,
			updatedAt: now
		})
		.where(
			and(
				eq(endorNotificationDeliveries.idempotencyKey, idempotencyKey),
				eq(endorNotificationDeliveries.payloadDigest, payloadDigest)
			)
		)
		.returning({ idempotencyKey: endorNotificationDeliveries.idempotencyKey })

	if (!updated) {
		throw new Error("Endor delivery receipt could not be persisted")
	}
}
