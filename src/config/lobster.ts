import { nominationConfig } from "./nominations.js"

export const lobsterArtworkRevision =
	"b56c19d0dd8b3b73ed656f72210edbd23e400df9"

export const lobsterScenePath = (aphiaId: number, sceneId: string) =>
	`assets/lobster/scenes/${aphiaId}/${sceneId}.webp`

export const lobsterSceneUrl = (aphiaId: number, sceneId: string) =>
	`https://raw.githubusercontent.com/openclaw/hermit/${lobsterArtworkRevision}/${lobsterScenePath(
		aphiaId,
		sceneId
	)}`

export const lobsterSceneChecksum = (aphiaId: number, sceneId: string) =>
	`pending-artwork:${aphiaId}:${sceneId}`

export const lobsterConfig = {
	guildId: nominationConfig.guildId,
	authorizedRoleIds: [
		"1477360613125787678",
		"1457214688806047756",
		"1503268035908075590"
	],
	hermitUserId: "1457407575476801641",
	rockLobsterUserId: "1518358333101310183",
	accentColor: "#e05a47",
	noticeColor: "#f1c40f",
	errorColor: "#f85149"
} as const
