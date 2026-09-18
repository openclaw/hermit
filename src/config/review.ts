export const reviewConfig = {
	guildId: "1456350064065904867",
	reviewChannelId: "1519064274561929328", // #ct-general
	staffRoleIds: [
		"1477360613125787678", // Community Team
		"1457214688806047756"  // Maintainers
	],
	autoEscalate: {
		minScore: 50,
		minFamilies: 2
	},
	krill: {
		model: "gpt-6-astra",
		fallbackModel: "gpt-4.1-mini",
		reasoningEffort: "low" as const,
		timeoutMs: 15000
	},
	windowDays: 7,
	maxObservationsPerSample: 100,
	get discrawlExportPath(): string | undefined {
		return process.env.DISCRAWL_EXPORT_PATH
	},
	get discrawlExportUrl(): string | undefined {
		return process.env.DISCRAWL_EXPORT_URL
	},
	get discrawlSecret(): string | undefined {
		return process.env.DISCRAWL_SECRET || process.env.DEPLOY_SECRET
	},
	get automaticScreeningEnabled(): boolean {
		return (
			process.env.ENABLE_AUTOMATIC_SCREENING === "1" ||
			process.env.ENABLE_AUTOMATIC_SCREENING === "true"
		)
	},
	get pilotChannelIds(): string[] | null {
		const raw = process.env.REVIEW_PILOT_CHANNEL_IDS
		if (!raw) return null
		return raw
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean)
	}
}
