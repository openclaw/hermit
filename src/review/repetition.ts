import type { ReviewMessage, Signal } from "./types.js"

export function repetitionSignal(rows: ReviewMessage[]): Signal | null {
	const eligible = rows.filter((r) => r.fingerprint && (r.contentLength ?? 0) >= 80)
	const groups: { representative: ReviewMessage; rows: ReviewMessage[] }[] = []
	const exact = new Map<string, number>()

	for (const row of eligible) {
		let index = exact.get(row.fingerprint)
		if (index === undefined) {
			index = groups.length
			groups.push({ representative: row, rows: [] })
		}
		exact.set(row.fingerprint, index)
		groups[index]!.rows.push(row)
	}

	const matches = groups.filter(
		(g) => g.rows.length >= 4 && new Set(g.rows.map((r) => r.channelId)).size >= 2
	)
	const repeated = matches.flatMap((g) => g.rows)

	if (eligible.length < 10 || repeated.length / eligible.length < 0.3) {
		return null
	}

	return {
		code: "repeated-content",
		family: "repetition",
		points: 30,
		description: `${repeated.length}/${eligible.length} substantive messages repeat identically across channels.`,
		messageIds: repeated.slice(0, 6).map((r) => r.messageId),
		metrics: {
			eligibleMessages: eligible.length,
			repeatedMessages: repeated.length,
			groups: matches.length
		},
		alternative:
			"Human support templates, copied answers, and announcements can repeat. Similar wording does not establish automated posting."
	}
}
