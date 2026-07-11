export const betaPingsConfig = {
	guildId: "1456350064065904867",
	channelId: "1471745479229309039",
	roleId: "1503801512294486217",
	copy: {
		title: "Beta Pings",
		description:
			"Want notifications about beta testing? Toggle the role below at any time.",
		buttonLabel: "Toggle beta pings",
		enabled: "Beta pings enabled.",
		disabled: "Beta pings disabled.",
		wrongLocation:
			"This control only works in the OpenClaw rules channel.",
		userNotFound: "Could not identify your server membership.",
		updateFailed:
			"Could not update Beta Pings. Please try again or ask the Community Team.",
		publishWrongLocation:
			"Run this command in the OpenClaw rules channel."
	}
} as const
