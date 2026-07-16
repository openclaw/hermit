import { nominationConfig } from "./nominations.js"

export type SlapRarity = "common" | "uncommon" | "rare" | "epic" | "legendary"

export type SlapOutcome =
	| "normal"
	| "critical"
	| "dodge"
	| "refusal"
	| "double"
	| "legendary"
	| "self"
	| "hermit"
	| "rock_lobster"
	| "bot"

export type SlapFish = {
	slug: string
	name: string
	rarity: SlapRarity
	weight: number
	imageUrl: string
}

const assetUrl = (fileName: string) =>
	`https://raw.githubusercontent.com/openclaw/hermit/main/assets/slap/${fileName}`

export const slapConfig = {
	guildId: nominationConfig.guildId,
	communityTeamRoleIds: nominationConfig.approverRoleIds,
	hermitUserId: "1457407575476801641",
	rockLobsterUserId: "1518358333101310183",
	cooldowns: {
		actorSeconds: 30,
		targetSeconds: 90,
		channelSeconds: 12
	},
	rarities: {
		common: { label: "Common", color: "#8b949e" },
		uncommon: { label: "Uncommon", color: "#3fb950" },
		rare: { label: "Rare", color: "#58a6ff" },
		epic: { label: "Epic", color: "#d2a8ff" },
		legendary: { label: "Legendary", color: "#f2cc60" }
	} satisfies Record<SlapRarity, { label: string; color: string }>,
	fish: [
		{
			slug: "procedural-herring",
			name: "Procedural Herring",
			rarity: "common",
			weight: 22,
			imageUrl: assetUrl("bureaucratic-herring.webp")
		},
		{
			slug: "compliance-sardine",
			name: "Compliance Sardine",
			rarity: "common",
			weight: 20,
			imageUrl: assetUrl("bureaucratic-herring.webp")
		},
		{
			slug: "moderate-concern-mackerel",
			name: "Mackerel of Moderate Concern",
			rarity: "common",
			weight: 18,
			imageUrl: assetUrl("bureaucratic-herring.webp")
		},
		{
			slug: "rubber-stamp-trout",
			name: "Rubber-Stamp Trout",
			rarity: "common",
			weight: 16,
			imageUrl: assetUrl("rubber-stamp-trout.webp")
		},
		{
			slug: "escalation-salmon",
			name: "Escalation Salmon",
			rarity: "uncommon",
			weight: 10,
			imageUrl: assetUrl("escalation-salmon.webp")
		},
		{
			slug: "inflatable-pufferfish",
			name: "Inflatable Pufferfish",
			rarity: "uncommon",
			weight: 9,
			imageUrl: assetUrl("pufferfish-compliance.webp")
		},
		{
			slug: "filing-cabinet-flounder",
			name: "Filing-Cabinet Flounder",
			rarity: "uncommon",
			weight: 8,
			imageUrl: assetUrl("rubber-stamp-trout.webp")
		},
		{
			slug: "due-process-swordfish",
			name: "Swordfish of Due Process",
			rarity: "rare",
			weight: 4,
			imageUrl: assetUrl("due-process-swordfish.webp")
		},
		{
			slug: "corrective-action-eel",
			name: "Corrective-Action Eel",
			rarity: "rare",
			weight: 4,
			imageUrl: assetUrl("corrective-eel.webp")
		},
		{
			slug: "sturgeon-general",
			name: "Sturgeon-General",
			rarity: "epic",
			weight: 1.5,
			imageUrl: assetUrl("due-process-swordfish.webp")
		},
		{
			slug: "final-notice-tuna",
			name: "Frozen Tuna of Final Notice",
			rarity: "epic",
			weight: 1,
			imageUrl: assetUrl("final-notice-tuna.webp")
		},
		{
			slug: "ancient-coelacanth",
			name: "Ancient Coelacanth",
			rarity: "legendary",
			weight: 0.3,
			imageUrl: assetUrl("ancient-coelacanth.webp")
		}
	] satisfies SlapFish[],
	outcomeWeights: [
		["normal", 52],
		["critical", 18],
		["dodge", 9],
		["refusal", 8],
		["double", 10],
		["legendary", 3]
	] satisfies Array<[Exclude<SlapOutcome, "self" | "hermit" | "rock_lobster" | "bot">, number]>,
	counterOutcomeWeights: [
		["normal", 45],
		["critical", 35],
		["double", 15],
		["legendary", 5]
	] satisfies Array<[Extract<SlapOutcome, "normal" | "critical" | "double" | "legendary">, number]>,
	headlines: {
		normal: "Corrective Fish Contact",
		critical: "Critical Fisheries Escalation",
		dodge: "Unplanned Projectile Reassignment",
		refusal: "Fish Labor Dispute",
		double: "Duplicate Service of Process",
		legendary: "Maritime Event of Record",
		self: "Self-Service Enforcement",
		hermit: "Request Denied by Hermit",
		rock_lobster: "Crustacean Jurisdiction Conflict",
		bot: "Automated Target Exception"
	} satisfies Record<SlapOutcome, string>,
	lines: {
		normal: [
			"{actor} completed a routine corrective fish contact against {target}. The paperwork describes the noise as legally sufficient.",
			"{target} received one measured application of {fish}. No escalation was requested, but several witnesses quietly approved.",
			"{actor} served {target} with a damp reminder via {fish}. Delivery was immediate and unnecessarily formal.",
			"The Department authorized one standard slap. {actor} selected {fish}; {target} supplied the face.",
			"{fish} made professional contact with {target}. {actor} has been asked not to call it a performance review.",
			"{actor} issued {target} a piscine notice of correction. The fish remained calm throughout the procedure.",
			"{target} was struck by {fish} at an administratively reasonable velocity. The matter is now considered wetter."
		],
		critical: [
			"{actor} escalated directly to {fish}. {target}'s dignity left the building before the sound finished echoing.",
			"{fish} connected with {target} at a force normally reserved for closing frozen office doors.",
			"{actor} delivered a critical slap to {target}. Three nearby forms stamped themselves.",
			"The impact on {target} was so decisive that {fish} has been promoted to Senior Enforcement Seafood.",
			"{target} received the full regulatory face of {fish}. The incident briefly appeared on maritime radar.",
			"{actor} achieved catastrophic fish-to-cheek alignment. {target} may appeal after locating the rest of the room."
		],
		dodge: [
			"{target} ducked. {fish} continued through the workflow and struck {actor} under the doctrine of projectile reassignment.",
			"{fish} missed {target}, reviewed the org chart, and selected {actor} as the accountable owner.",
			"{target} evaded service. The returning {fish} found {actor} available for immediate contact.",
			"{actor}'s throw was rejected for insufficient targeting. {fish} returned to sender with wet amendments.",
			"{target} stepped aside and {fish} completed a flawless boomerang audit of {actor}'s face."
		],
		refusal: [
			"{fish} declined to slap {target}, citing unsafe working conditions and a complete absence of snacks.",
			"{actor} raised {fish}; {fish} raised a grievance. {target} remains unslapped pending arbitration.",
			"{fish} reviewed the request and marked it OUT OF SCOPE. {target} has been spared by process.",
			"The slap was cancelled after {fish} requested legal counsel. {actor} must now attend a fisheries conduct seminar.",
			"{fish} refused contact with {target} and has entered a protected decompression bucket."
		],
		double: [
			"{actor} slapped {target} once for the incident and again because the duplicate form was already printed.",
			"{fish} bounced off {target}, noticed the first slap lacked a countersignature, and immediately supplied a second.",
			"{target} received two certified applications of {fish}. One was procedural; the other was apparently personal.",
			"{actor} invoked the rarely used fish-fish escalation. {target} was served in duplicate.",
			"A clerical error authorized two slaps. {actor} noticed the error only after both had landed on {target}."
		],
		legendary: [
			"The ancient fisheries seal broke. {actor} summoned {fish}, and {target} became a permanent footnote in maritime policy.",
			"{fish} crossed time, tide, and several compliance boundaries to reach {target}. The slap will be taught in orientation.",
			"{actor} delivered the legendary slap. {target}'s dignity was last seen entering international waters.",
			"Every nearby aquarium fell silent as {fish} rendered final judgment upon {target}."
		],
		self: [
			"{actor} filed against themselves, approved the request, and completed service with {fish}. Internal controls are satisfied.",
			"{actor} attempted to demonstrate proper technique and became both the training material and the incident report."
		],
		hermit: [
			"{actor} attempted to slap Hermit. Hermit stamped the request DENIED, confiscated {fish}, and opened a ticket about tone.",
			"Hermit caught {fish}, corrected its formatting, and returned it to storage. {actor} has been assigned remedial command syntax."
		],
		rock_lobster: [
			"{actor} introduced {fish} to Rock Lobster. Rock Lobster invoked senior crustacean jurisdiction and dismissed the fish without prejudice.",
			"Rock Lobster caught {fish} one-clawed, inspected the paperwork, and returned {actor}'s request marked ADORABLY INSUFFICIENT."
		],
		bot: [
			"{actor} slapped {target} with {fish}. The bot returned HTTP 409: cheek state conflict.",
			"{fish} contacted {target}, which logged the event, rotated its credentials, and continued pretending nothing happened."
		]
	} satisfies Record<SlapOutcome, string[]>,
	appealRulings: [
		"**Appeal denied.** The fish was found to have acted within policy.",
		"**Appeal granted in part.** Three dignity points have been restored. They are non-transferable.",
		"**Appeal dismissed.** The filing was wet and therefore technically illegible.",
		"**Ruling vacated.** The slap remains, but it must now be described as a maritime handshake.",
		"**Appeal denied with prejudice.** The fish remembered everything.",
		"**Remanded for retrial.** A smaller fish will review the larger fish's methodology.",
		"**No jurisdiction.** This matter belongs before the International Court of Haddock.",
		"**Appeal sustained.** The incident is reclassified as an unsolicited facial seafood delivery.",
		"**Administrative mercy granted.** One imaginary ice pack has been issued.",
		"**Decision affirmed.** The slap was loud, damp, and procedurally flawless.",
		"**Case sealed.** Nobody may discuss why the fish was wearing a lanyard.",
		"**Emergency stay denied.** The fish has already left the building."
	]
} as const
