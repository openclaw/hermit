import { asc, eq } from "drizzle-orm"
import { getDb } from "../db.js"
import {
	clawhubContentRightsCases,
	clawhubContentRightsEvents,
	clawhubContentRightsFiles,
	type NewClawhubContentRightsCase,
	type NewClawhubContentRightsEvent,
	type NewClawhubContentRightsFile
} from "../db/schema.js"

export const createContentRightsCase = async (
	input: Omit<NewClawhubContentRightsCase, "clawhubUrls">
		& { clawhubUrls: string[] }
) => {
	await getDb().insert(clawhubContentRightsCases).values({
		...input,
		clawhubUrls: JSON.stringify(input.clawhubUrls)
	})
}

export const recordContentRightsFile = async (input: NewClawhubContentRightsFile) => {
	await getDb().insert(clawhubContentRightsFiles).values(input)
}

export const appendContentRightsEvent = async (
	input: Omit<NewClawhubContentRightsEvent, "metadata"> & { metadata: Record<string, unknown> }
) => {
	await getDb().insert(clawhubContentRightsEvents).values({
		...input,
		metadata: JSON.stringify(input.metadata)
	})
}

const parseJson = <T>(value: string, fallback: T): T => {
	try {
		return JSON.parse(value) as T
	} catch {
		return fallback
	}
}

export const getContentRightsCaseBundle = async (caseId: string) => {
	const database = getDb()
	const [contentRightsCase] = await database
		.select()
		.from(clawhubContentRightsCases)
		.where(eq(clawhubContentRightsCases.caseId, caseId))
		.limit(1)
	if (!contentRightsCase) {
		return null
	}
	const [files, events] = await Promise.all([
		database
			.select()
			.from(clawhubContentRightsFiles)
			.where(eq(clawhubContentRightsFiles.caseId, caseId))
			.orderBy(asc(clawhubContentRightsFiles.id)),
		database
			.select()
			.from(clawhubContentRightsEvents)
			.where(eq(clawhubContentRightsEvents.caseId, caseId))
			.orderBy(asc(clawhubContentRightsEvents.id))
	])
	return {
		case: {
			...contentRightsCase,
			clawhubUrls: parseJson<string[]>(contentRightsCase.clawhubUrls, [])
		},
		files,
		events: events.map((event) => ({
			...event,
			metadata: parseJson<Record<string, unknown>>(event.metadata, {})
		}))
	}
}
