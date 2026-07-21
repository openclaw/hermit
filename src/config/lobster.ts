import { nominationConfig } from "./nominations.js"

export const lobsterArtworkRevision =
	"d1ffbe7080fca127286f19e494a22b4ac89cba43"

export const lobsterScenePath = (aphiaId: number, sceneId: string) =>
	`assets/lobster/scenes/${aphiaId}/${sceneId}.webp`

export const lobsterAssetUrl = (assetPath: string) =>
	`https://raw.githubusercontent.com/openclaw/hermit/${lobsterArtworkRevision}/assets/${assetPath}`

export const lobsterSceneUrl = (aphiaId: number, sceneId: string) =>
	lobsterAssetUrl(`lobster/scenes/${aphiaId}/${sceneId}.webp`)

export const lobsterSceneChecksum = (aphiaId: number, sceneId: string) =>
	`pending-artwork:${aphiaId}:${sceneId}`

export const lobsterPrimaryUrl = (relativeOutputPath: string) =>
	lobsterAssetUrl(relativeOutputPath)

export const lobsterPrimaryChecksum = (aphiaId: number, sceneId: string) =>
	`pending-primary-artwork:${aphiaId}:${sceneId}`

export const lobsterDossierUrl = (aphiaId: number) =>
	`https://hermit-discord.openclaw.ai/lobsters/${aphiaId}`

export const lobsterConfig = {
	guildId: nominationConfig.guildId,
	authorizedRoleIds: [
		"1477360613125787678",
		"1457214688806047756",
		"1503268035908075590",
		"1509063061598769333"
	],
	hermitUserId: "1457407575476801641",
	rockLobsterUserId: "1518358333101310183",
	accentColor: "#e05a47",
	noticeColor: "#f1c40f",
	errorColor: "#f85149"
} as const
