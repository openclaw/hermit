import {
	Button,
	type ButtonInteraction,
	ButtonStyle,
	type Client,
	type ComponentData,
	ComponentType,
	Container,
	Label,
	MessageFlags,
	Modal,
	type ModalInteraction,
	Row,
	Routes,
	Separator,
	TextDisplay,
	TextInput,
	TextInputStyle
} from "@buape/carbon"
import {
	createClaimRequest,
	deleteClaimRequest,
	getClaimRequest,
	markClaimRequestSubmitted,
	recordClaimDecision
} from "../data/claimRequests.js"

const clawtributorsRoleId = "1458375944111915051"
const claimReviewRoleId = "1460436814627078433"
const claimReviewChannelId = "1503772785120383057"
const clawtributorsAnnouncementChannelId = "1458141495701012561"
const githubOwner = "openclaw"
const githubRepo = "openclaw"
const discordApiBase = "https://discord.com/api/v10"
const stateTtlMs = 10 * 60 * 1000
const reasonInputId = "claim-review-reason"

const existingClaimPageMessage = (status: string) => {
	if (status === "accepted") {
		return "Your clawtributor claim has already been accepted."
	}

	if (status === "rejected") {
		return "Your clawtributor claim has already been reviewed. Ask a moderator if you think this needs another look."
	}

	return "Your clawtributor claim has already been submitted for review. You will receive a DM after it is accepted or rejected."
}

export const createClaimUrl = async (userId: string, guildId: string) => {
	const baseUrl = process.env.BASE_URL?.replace(/\/$/, "")
	const secret = process.env.DEPLOY_SECRET
	if (!baseUrl) {
		throw new Error("BASE_URL is required")
	}
	if (!secret) {
		throw new Error("DEPLOY_SECRET is required")
	}

	const payloadBytes = new TextEncoder().encode(
		JSON.stringify({
			userId,
			guildId,
			expiresAt: Date.now() + stateTtlMs
		})
	)
	let payloadBinary = ""
	for (const byte of payloadBytes) {
		payloadBinary += String.fromCharCode(byte)
	}
	const encodedPayload = btoa(payloadBinary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "")
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	)
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(encodedPayload)
	)
	const signatureBytes = new Uint8Array(signature)
	let signatureBinary = ""
	for (const byte of signatureBytes) {
		signatureBinary += String.fromCharCode(byte)
	}

	const url = new URL("/claim", baseUrl)
	url.searchParams.set(
		"state",
		`${encodedPayload}.${btoa(signatureBinary)
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "")}`
	)

	return url.toString()
}

class ClaimReviewAcceptButton extends Button {
	customId = "claim-review-accept"
	label = "Accept"
	style = ButtonStyle.Success
	ephemeral = true

	constructor(userId?: string, guildId?: string) {
		super()
		if (userId && guildId) {
			this.customId = `claim-review-accept:userId=s${userId};guildId=s${guildId}`
		}
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const userId =
			typeof data.userId === "string" && data.userId.startsWith("s")
				? data.userId.slice(1)
				: null
		const guildId =
			typeof data.guildId === "string" && data.guildId.startsWith("s")
				? data.guildId.slice(1)
				: null
		if (!userId || !guildId) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### Invalid claim request"),
							new TextDisplay("This review button is missing claim data.")
						],
						{ accentColor: "#f85149" }
					)
				]
			})
			return
		}

		const currentComponents = structuredClone(
			interaction.message?.rawData.components ?? []
		)
		const currentContainer = currentComponents.find(
			(component) => component.type === ComponentType.Container
		)
		const currentContainerComponents =
			currentContainer && "components" in currentContainer
				? currentContainer.components
				: []
		const currentButtonRow = currentContainerComponents.find(
			(component) => component.type === ComponentType.ActionRow
		)
		const alreadyLocked =
			currentButtonRow &&
			"components" in currentButtonRow &&
			currentButtonRow.components.every((component) => component.disabled)
		if (alreadyLocked) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### Claim already being handled"),
							new TextDisplay("This claim request has already been accepted, rejected, or locked for review.")
						],
						{ accentColor: "#f1c40f" }
					)
				]
			})
			return
		}

		const roleResponse = await fetch(
			`${discordApiBase}/guilds/${guildId}/members/${userId}/roles/${clawtributorsRoleId}`,
			{
				method: "PUT",
				headers: {
					Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
				}
			}
		)

		if (!roleResponse.ok && roleResponse.status !== 204) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### Could not add role"),
							new TextDisplay(
								"The bot could not add the clawtributors role. Check bot permissions and role order."
							)
						],
						{ accentColor: "#f85149" }
					)
				]
			})
			return
		}

		await recordClaimDecision({
			userId,
			guildId,
			status: "accepted",
			decidedById: interaction.user?.id
		}).catch((error) => {
			console.error("Failed to record accepted claim:", error)
		})

		const user = await interaction.client.fetchUser(userId).catch(() => null)
		await user?.send({
			components: [
				new Container(
					[
						new TextDisplay("### Clawtributor Claim Accepted"),
						new TextDisplay("You have been given the clawtributors role.")
					],
					{ accentColor: "#3fb950" }
				)
			]
		}).catch(() => null)

		const announcementChannel = await interaction.client
			.fetchChannel(clawtributorsAnnouncementChannelId)
			.catch(() => null)
		if (announcementChannel && "send" in announcementChannel) {
			await announcementChannel.send({
				components: [
					new Container([
						new TextDisplay(
							`<@${userId}> has been given the <@&${clawtributorsRoleId}> role`
						)
					])
				],
				allowedMentions: { parse: [] }
			})
		}

		if (interaction.message?.channelId && interaction.message.id) {
			await interaction.client.rest.patch(
				Routes.channelMessage(
					interaction.message.channelId,
					interaction.message.id
				),
				{
					body: {
						components: currentComponents.map((component) =>
							component.type === ComponentType.Container &&
								"components" in component
								? {
									...component,
									accent_color: 4176208,
									components: [
										...component.components.map((child) =>
											child.type === ComponentType.ActionRow &&
												"components" in child
												? {
													...child,
													components: child.components.map((button) => ({
														...button,
														disabled: true
													}))
												}
												: child
										),
										new Separator({
											divider: true,
											spacing: "small"
										}).serialize(),
										new TextDisplay(
											`Accepted by <@${interaction.user?.id ?? "unknown"}>. <@${userId}> has been given <@&${clawtributorsRoleId}>.`
										).serialize()
									]
								}
								: component
						),
						flags: MessageFlags.IsComponentsV2,
						allowed_mentions: { parse: [] }
					}
				}
			)
		}

		await interaction.reply({
			components: [
				new Container(
					[
						new TextDisplay("### Claim accepted"),
						new TextDisplay(`<@${userId}> has been given the role.`)
					],
					{ accentColor: "#3fb950" }
				)
			],
			allowedMentions: { parse: [] }
		})
	}
}

class ClaimReviewRejectButton extends Button {
	customId = "claim-review-reject"
	label = "Reject"
	style = ButtonStyle.Danger
	defer = false
	ephemeral = true

	constructor(userId?: string, guildId?: string) {
		super()
		if (userId && guildId) {
			this.customId = `claim-review-reject:userId=s${userId};guildId=s${guildId}`
		}
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const userId =
			typeof data.userId === "string" && data.userId.startsWith("s")
				? data.userId.slice(1)
				: null
		const guildId =
			typeof data.guildId === "string" && data.guildId.startsWith("s")
				? data.guildId.slice(1)
				: null
		if (!userId || !guildId) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### Invalid claim request"),
							new TextDisplay("This review button is missing claim data.")
						],
						{ accentColor: "#f85149" }
					)
				]
			})
			return
		}

		const currentComponents = structuredClone(
			interaction.message?.rawData.components ?? []
		)
		const currentContainer = currentComponents.find(
			(component) => component.type === ComponentType.Container
		)
		const currentContainerComponents =
			currentContainer && "components" in currentContainer
				? currentContainer.components
				: []
		const currentButtonRow = currentContainerComponents.find(
			(component) => component.type === ComponentType.ActionRow
		)
		const alreadyLocked =
			currentButtonRow &&
			"components" in currentButtonRow &&
			currentButtonRow.components.every((component) => component.disabled)
		if (alreadyLocked) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### Claim already being handled"),
							new TextDisplay("Someone is already handling this claim request.")
						],
						{ accentColor: "#f1c40f" }
					)
				]
			})
			return
		}

		if (interaction.message?.channelId && interaction.message.id) {
			await interaction.client.rest.patch(
				Routes.channelMessage(
					interaction.message.channelId,
					interaction.message.id
				),
				{
					body: {
						components: currentComponents.map((component) =>
							component.type === ComponentType.Container &&
								"components" in component
								? {
									...component,
									components: [
										...component.components.map((child) =>
											child.type === ComponentType.ActionRow &&
												"components" in child
												? {
													...child,
													components: child.components.map((button) => ({
														...button,
														disabled: true
													}))
												}
												: child
										),
										new Separator({
											divider: true,
											spacing: "small"
										}).serialize(),
										new TextDisplay(
											`Rejection in progress by <@${interaction.user?.id ?? "unknown"}>.`
										).serialize()
									]
								}
								: component
						),
						flags: MessageFlags.IsComponentsV2,
						allowed_mentions: { parse: [] }
					}
				}
			)
		}

		await interaction.showModal(new ClaimReviewRejectModal(userId, guildId))
	}
}

class ClaimReviewReasonInput extends TextInput {
	customId = reasonInputId
	style = TextInputStyle.Paragraph
	required = false
	maxLength = 1000
	placeholder = "Optional reason to include in the DM"
}

class ClaimReviewReasonLabel extends Label {
	label = "Reason"
	description = "Optional. This will be included in the rejection DM."

	constructor() {
		super(new ClaimReviewReasonInput())
	}
}

class ClaimReviewRejectModal extends Modal {
	title = "Reject Clawtributor Claim"
	customId = "claim-review-reject-modal"
	components = [new ClaimReviewReasonLabel()]

	constructor(userId?: string, guildId?: string) {
		super()
		if (userId && guildId) {
			this.customId = `claim-review-reject-modal:userId=s${userId};guildId=s${guildId}`
		}
	}

	async run(interaction: ModalInteraction, data: ComponentData) {
		const userId =
			typeof data.userId === "string" && data.userId.startsWith("s")
				? data.userId.slice(1)
				: null
		const guildId =
			typeof data.guildId === "string" && data.guildId.startsWith("s")
				? data.guildId.slice(1)
				: null
		const reason = interaction.fields.getText(reasonInputId)?.trim()
		if (!userId || !guildId) {
			await interaction.reply({
				components: [
					new Container(
						[
							new TextDisplay("### Invalid claim request"),
							new TextDisplay("This review modal is missing claim data.")
						],
						{ accentColor: "#f85149" }
					)
				],
				ephemeral: true
			})
			return
		}

		await recordClaimDecision({
			userId,
			guildId,
			status: "rejected",
			decidedById: interaction.user?.id,
			decisionReason: reason
		}).catch((error) => {
			console.error("Failed to record rejected claim:", error)
		})

		const user = await interaction.client.fetchUser(userId).catch(() => null)
		await user?.send({
			components: [
				new Container(
					[
						new TextDisplay("### Clawtributor Claim Rejected"),
						new TextDisplay(
							reason
								? `Your clawtributor claim was rejected.\n\nReason: ${reason}`
								: "Your clawtributor claim was rejected."
						)
					],
					{ accentColor: "#f85149" }
				)
			]
		}).catch(() => null)

		if (interaction.message?.channelId && interaction.message.id) {
			const currentComponents = structuredClone(
				interaction.message.rawData.components ?? []
			)
			await interaction.client.rest.patch(
				Routes.channelMessage(
					interaction.message.channelId,
					interaction.message.id
				),
				{
					body: {
						components: currentComponents.map((component) =>
							component.type === ComponentType.Container &&
								"components" in component
								? {
									...component,
									accent_color: 16273737,
									components: [
										...component.components,
										new Separator({
											divider: true,
											spacing: "small"
										}).serialize(),
										new TextDisplay(
											reason
												? `Rejected by <@${interaction.user?.id ?? "unknown"}>.\n\nReason: ${reason}`
												: `Rejected by <@${interaction.user?.id ?? "unknown"}>.`
										).serialize()
									]
								}
								: component
						),
						flags: MessageFlags.IsComponentsV2,
						allowed_mentions: { parse: [] }
					}
				}
			)
		}

		await interaction.reply({
			components: [
				new Container(
					[
						new TextDisplay("### Claim rejected"),
						new TextDisplay(`Rejection sent to <@${userId}>.`)
					],
					{ accentColor: "#f85149" }
				)
			],
			ephemeral: true,
			allowedMentions: { parse: [] }
		})
	}
}

const handleClaimCallback = async (request: Request, client: Client) => {
	const url = new URL(request.url)
	const state = url.searchParams.get("state")
	const code = url.searchParams.get("code")
	const baseUrl = process.env.BASE_URL?.replace(/\/$/, "")
	const secret = process.env.DEPLOY_SECRET
	const render = (title: string, message: string, status = 200) =>
		new Response(
			`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 42rem; line-height: 1.5; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${message}</p>
  </body>
</html>`,
			{
				status,
				headers: { "content-type": "text/html; charset=utf-8" }
			}
		)

	if (!state || !code) {
		return new Response("Missing OAuth code or state.", {
			status: 400,
			headers: { "content-type": "text/plain; charset=utf-8" }
		})
	}
	if (!baseUrl) {
		throw new Error("BASE_URL is required")
	}
	if (!secret) {
		throw new Error("DEPLOY_SECRET is required")
	}

	const [encodedPayload, stateSignature] = state.split(".")
	let payload: { userId: string; guildId: string; expiresAt: number } | null = null
	if (encodedPayload && stateSignature) {
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"]
		)
		const signature = await crypto.subtle.sign(
			"HMAC",
			key,
			new TextEncoder().encode(encodedPayload)
		)
		let signatureBinary = ""
		for (const byte of new Uint8Array(signature)) {
			signatureBinary += String.fromCharCode(byte)
		}
		const expectedSignature = btoa(signatureBinary)
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "")

		if (stateSignature === expectedSignature) {
			try {
				const paddedPayload = encodedPayload
					.replaceAll("-", "+")
					.replaceAll("_", "/")
					.padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=")
				const payloadBinary = atob(paddedPayload)
				const payloadBytes = new Uint8Array(payloadBinary.length)
				for (let index = 0; index < payloadBinary.length; index += 1) {
					payloadBytes[index] = payloadBinary.charCodeAt(index)
				}
				const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
					userId?: unknown
					guildId?: unknown
					expiresAt?: unknown
				}
				if (
					typeof parsed.userId === "string" &&
					typeof parsed.guildId === "string" &&
					typeof parsed.expiresAt === "number" &&
					parsed.expiresAt >= Date.now()
				) {
					payload = {
						userId: parsed.userId,
						guildId: parsed.guildId,
						expiresAt: parsed.expiresAt
					}
				}
			} catch {
				payload = null
			}
		}
	}
	if (!payload) {
		return render("Claim link expired", "Run /claim in Discord again to get a fresh link.", 400)
	}

	const existingClaim = await getClaimRequest(payload.userId, payload.guildId)
	if (existingClaim) {
		return render(
			"Claim already exists",
			existingClaimPageMessage(existingClaim.status),
			409
		)
	}

	const tokenResponse = await fetch(`${discordApiBase}/oauth2/token`, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded"
		},
		body: new URLSearchParams({
			client_id: process.env.DISCORD_CLIENT_ID,
			client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
			grant_type: "authorization_code",
			code,
			redirect_uri: new URL("/claim/callback", baseUrl).toString()
		})
	})
	const accessToken = tokenResponse.ok
		? ((await tokenResponse.json()) as { access_token?: string }).access_token
		: null
	if (!accessToken) {
		return render("Discord authorization failed", "Please run /claim and try again.", 400)
	}

	const discordUserResponse = await fetch(`${discordApiBase}/users/@me`, {
		headers: { authorization: `Bearer ${accessToken}` }
	})
	const discordUser = discordUserResponse.ok
		? ((await discordUserResponse.json()) as { id?: string })
		: null
	if (discordUser?.id !== payload.userId) {
		return render("Wrong Discord account", "Use the same Discord account that ran /claim.", 403)
	}

	const connectionsResponse = await fetch(`${discordApiBase}/users/@me/connections`, {
		headers: { authorization: `Bearer ${accessToken}` }
	})
	if (!connectionsResponse.ok) {
		return render("Could not read connections", "Please run /claim and authorize connections access again.", 400)
	}
	const githubUsernames = ((await connectionsResponse.json()) as Array<{
		type?: string
		name?: string
		verified?: boolean
	}>)
		.filter(
			(connection) =>
				connection.type === "github" &&
				connection.verified !== false &&
				typeof connection.name === "string" &&
				connection.name.length > 0
		)
		.map((connection) => connection.name as string)

	if (githubUsernames.length === 0) {
		return render("No GitHub connection found", "Connect GitHub to Discord, then run /claim again.", 403)
	}

	const githubHeaders: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"User-Agent": "hermit"
	}
	const githubSummaries = (
		await Promise.all(
			githubUsernames.map(async (username) => {
				const query = new URLSearchParams({
					q: `repo:${githubOwner}/${githubRepo} is:pr is:merged author:${username}`,
					sort: "updated",
					order: "desc",
					per_page: "30"
				})
				const response = await fetch(
					`https://api.github.com/search/issues?${query.toString()}`,
					{ headers: githubHeaders }
				)
				if (!response.ok) {
					return null
				}
				const data = (await response.json()) as {
					total_count?: number
					items?: Array<{
						html_url?: string
						number?: number
						title?: string
						closed_at?: string | null
					}>
				}
				return {
					username,
					totalCount: data.total_count ?? 0,
					recentPullRequests: (data.items ?? [])
						.filter(
							(item) =>
								typeof item.number === "number" &&
								typeof item.title === "string" &&
								typeof item.html_url === "string"
						)
						.map((item) => ({
							number: item.number as number,
							title: item.title as string,
							url: item.html_url as string,
							closedAt: item.closed_at ?? null
						}))
						.sort((left, right) => {
							const leftTime = left.closedAt ? Date.parse(left.closedAt) : 0
							const rightTime = right.closedAt ? Date.parse(right.closedAt) : 0
							return rightTime - leftTime
						})
						.slice(0, 3)
				}
			})
		)
	)
		.filter((summary) => summary !== null)
		.sort((left, right) => right.totalCount - left.totalCount)

	const qualifyingSummary = githubSummaries.find((summary) => summary.totalCount > 0)
	if (!qualifyingSummary) {
		return render(
			"Not eligible yet",
			`No merged pull request was found in ${githubOwner}/${githubRepo} for your linked GitHub account.`,
			403
		)
	}

	const channel = await client
		.fetchChannel(claimReviewChannelId)
		.catch(() => null)
	if (!channel || !("send" in channel)) {
		return render(
			"Could not submit request",
			"The bot could not send the claim review request. Ask a moderator to check the notification channel configuration.",
			500
		)
	}

	const claimRequestResult = await createClaimRequest({
		userId: payload.userId,
		guildId: payload.guildId,
		githubUsername: qualifyingSummary.username,
		mergedPrCount: qualifyingSummary.totalCount
	})
	if (!claimRequestResult.created) {
		return render(
			"Claim already exists",
			existingClaimPageMessage(claimRequestResult.claimRequest?.status ?? "submitted"),
			409
		)
	}

	const recentPullRequests =
		qualifyingSummary.recentPullRequests.length > 0
			? qualifyingSummary.recentPullRequests
				.map((pullRequest) => {
					const title = pullRequest.title.replace(/\s+/g, " ")
					const trimmedTitle =
						title.length > 90 ? `${title.slice(0, 87)}...` : title
					const closedAt = pullRequest.closedAt
						? ` - merged ${new Date(pullRequest.closedAt).toLocaleDateString(
							"en-US",
							{
								month: "short",
								day: "numeric",
								year: "numeric"
							}
						)}`
						: ""
					return `- [#${pullRequest.number} ${trimmedTitle}](<${pullRequest.url}>)${closedAt}`
				})
				.join("\n")
			: "No recent merged pull requests found."
	const message = await channel
		.send({
			components: [
				new Container(
					[
						new TextDisplay(`<@&${claimReviewRoleId}>`),
						new TextDisplay("### Clawtributor Claim Request"),
						new TextDisplay(
							`- User: <@${payload.userId}>\n- ID: ${payload.userId}\n- GitHub: [@${qualifyingSummary.username}](<https://github.com/${qualifyingSummary.username}>)\n- Merged PRs: **${qualifyingSummary.totalCount}**`
						),
						new Separator({ divider: true, spacing: "small" }),
						new TextDisplay("### 3 Most Recent Merged PRs"),
						new TextDisplay(recentPullRequests),
						new Separator({ divider: true, spacing: "small" }),
						new Row([
							new ClaimReviewAcceptButton(payload.userId, payload.guildId),
							new ClaimReviewRejectButton(payload.userId, payload.guildId)
						])
					],
					{ accentColor: "#f1c40f" }
				)
			],
			allowedMentions: {
				roles: [claimReviewRoleId],
				users: []
			}
		})
		.catch(async (error) => {
			console.error("Failed to send claim review request:", error)
			await deleteClaimRequest(claimRequestResult.claimRequest.id).catch((error) => {
				console.error("Failed to clean up unsent claim request:", error)
			})
			return null
		})
	if (!message) {
		return render(
			"Could not submit request",
			"The bot could not send the claim review request. Ask a moderator to check the notification channel configuration.",
			500
		)
	}

	await markClaimRequestSubmitted(claimRequestResult.claimRequest.id, {
		reviewMessageId: message.id
	}).catch((error) => {
		console.error("Failed to mark claim submitted:", error)
	})

	const thread = await message
		.startThread({
			name: `Clawtributor claim by ${qualifyingSummary.username}`.slice(0, 100),
			auto_archive_duration: 1440
		})
		.catch(() => null)
	if (thread && typeof thread === "object" && "id" in thread) {
		await markClaimRequestSubmitted(claimRequestResult.claimRequest.id, {
			reviewMessageId: message.id,
			reviewThreadId:
				typeof thread.id === "string" ? thread.id : String(thread.id)
		}).catch((error) => {
			console.error("Failed to record claim review thread:", error)
		})
	}

	return render(
		"Claim submitted",
		"Your claim was sent for review. You will receive a DM after it is accepted or rejected."
	)
}

export const claimReviewComponents = [
	new ClaimReviewAcceptButton(),
	new ClaimReviewRejectButton()
]

export const claimReviewModals = [new ClaimReviewRejectModal()]

export const registerClaimRoutes = (client: Client) => {
	client.routes.push(
		{
			method: "GET",
			path: "/claim",
			handler: async (request) => {
				const state = new URL(request.url).searchParams.get("state")
				const baseUrl = process.env.BASE_URL?.replace(/\/$/, "")
				const secret = process.env.DEPLOY_SECRET
				let validState = false
				if (state && secret) {
					const [encodedPayload, stateSignature] = state.split(".")
					if (encodedPayload && stateSignature) {
						const key = await crypto.subtle.importKey(
							"raw",
							new TextEncoder().encode(secret),
							{ name: "HMAC", hash: "SHA-256" },
							false,
							["sign"]
						)
						const signature = await crypto.subtle.sign(
							"HMAC",
							key,
							new TextEncoder().encode(encodedPayload)
						)
						let signatureBinary = ""
						for (const byte of new Uint8Array(signature)) {
							signatureBinary += String.fromCharCode(byte)
						}
						const expectedSignature = btoa(signatureBinary)
							.replaceAll("+", "-")
							.replaceAll("/", "_")
							.replaceAll("=", "")
						if (stateSignature === expectedSignature) {
							try {
								const paddedPayload = encodedPayload
									.replaceAll("-", "+")
									.replaceAll("_", "/")
									.padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=")
								const payloadBinary = atob(paddedPayload)
								const payloadBytes = new Uint8Array(payloadBinary.length)
								for (let index = 0; index < payloadBinary.length; index += 1) {
									payloadBytes[index] = payloadBinary.charCodeAt(index)
								}
								const payload = JSON.parse(
									new TextDecoder().decode(payloadBytes)
								) as {
									userId?: unknown
									guildId?: unknown
									expiresAt?: unknown
								}
								validState =
									typeof payload.userId === "string" &&
									typeof payload.guildId === "string" &&
									typeof payload.expiresAt === "number" &&
									payload.expiresAt >= Date.now()
							} catch {
								validState = false
							}
						}
					}
				}
				if (!validState || !state || !baseUrl) {
					return new Response(
						`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claim link expired</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 42rem; line-height: 1.5; }
    </style>
  </head>
  <body>
    <h1>Claim link expired</h1>
    <p>Run /claim in Discord again to get a fresh link.</p>
  </body>
</html>`,
						{
							status: 400,
							headers: { "content-type": "text/html; charset=utf-8" }
						}
					)
				}

				const oauthUrl = new URL(`${discordApiBase}/oauth2/authorize`)
				oauthUrl.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID)
				oauthUrl.searchParams.set(
					"redirect_uri",
					new URL("/claim/callback", baseUrl).toString()
				)
				oauthUrl.searchParams.set("response_type", "code")
				oauthUrl.searchParams.set("scope", "identify connections")
				oauthUrl.searchParams.set("state", state)

				return Response.redirect(oauthUrl.toString(), 302)
			}
		},
		{
			method: "GET",
			path: "/claim/callback",
			handler: (request) => handleClaimCallback(request, client)
		}
	)
}
