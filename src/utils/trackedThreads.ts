import {
	listTrackedThreads as listTrackedThreadsFromDb,
	type ThreadUpsertPayload,
	upsertTrackedThread as upsertTrackedThreadInDb
} from "../data/helperLogs.js"

type TrackedThreadRecord = Awaited<
	ReturnType<typeof listTrackedThreadsFromDb>
>[number]

type TrackedThreadUpsertPayload = {
	threadId: string
	createdAt?: string | null
	lastChecked?: string | null
	solved?: boolean
	warningLevel?: number
	closed?: boolean
	lastMessageCount?: number | null
}

export const listTrackedThreads = async (
	filters: {
		solved?: boolean
		closed?: boolean
		limit?: number
	} = {}
) => {
	return listTrackedThreadsFromDb(filters)
}

export const upsertTrackedThread = async (
	payload: TrackedThreadUpsertPayload
) => {
	const result = await upsertTrackedThreadInDb(payload as ThreadUpsertPayload)
	if ("error" in result) {
		throw new Error(result.error)
	}
}

export type { TrackedThreadRecord, TrackedThreadUpsertPayload }
