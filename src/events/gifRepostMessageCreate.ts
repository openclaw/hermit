import {
	ChannelType,
	MessageCreateListener,
	OverwriteType,
	PermissionFlagsBits,
	type APIChannel,
	type APIRole,
	type Client,
	type ListenerEventData,
	Routes
} from "@buape/carbon"
import { getOrCreateChannelWebhook, sendWebhookMessage } from "../utils/channelWebhook.js"

const gifLinkDomains = new Set(["tenor.com", "klipy.com"])
const gifRepostLogChannelId = "1464886408090226902"
const urlRegex = /https?:\/\/[^\s<>()]+/gi

const logGifRepost = async (
	client: Client,
	message: string,
	data: ListenerEventData["MESSAGE_CREATE"]
) => {
	const content =
		`[gif-repost] ${message} message=${data.id} channel=${data.channel_id ?? "unknown"} guild=${data.guild_id ?? "dm"} author=${data.author.id}`
	await client.rest
		.post(Routes.channelMessages(gifRepostLogChannelId), {
			body: {
				content: content.slice(0, 2000),
				allowed_mentions: { parse: [] }
			}
		})
		.catch(() => {})
}

const trimUrl = (url: string) => url.replace(/[.,!?;:]+$/, "")
const hasPermission = (permissions: bigint, permission: bigint) =>
	(permissions & permission) === permission

const findGifLink = (content: string) => {
	for (const match of content.matchAll(urlRegex)) {
		const link = trimUrl(match[0])
		try {
			const hostname = new URL(link).hostname.toLowerCase()
			const rootDomain = hostname.split(".").slice(-2).join(".")
			if (gifLinkDomains.has(rootDomain)) {
				return link
			}
		} catch {
			continue
		}
	}
	return null
}

const fetchChannel = async (client: Client, channelId: string) =>
	(await client.rest.get(Routes.channel(channelId))) as APIChannel

const getPermissionChannel = async (client: Client, channel: APIChannel) => {
	if (
		(channel.type === ChannelType.AnnouncementThread ||
			channel.type === ChannelType.PublicThread ||
			channel.type === ChannelType.PrivateThread) &&
		"parent_id" in channel &&
		channel.parent_id
	) {
		return fetchChannel(client, channel.parent_id)
	}
	return channel
}

const applyOverwrite = (permissions: bigint, allow: string, deny: string) =>
	(permissions & ~BigInt(deny)) | BigInt(allow)

const canEmbedLinksInChannel = async (
	client: Client,
	data: ListenerEventData["MESSAGE_CREATE"]
) => {
	if (!data.guild_id || !data.rawMember) {
		return { canEmbed: true, reason: "missing-guild-or-member" }
	}

	const [roles, channel] = await Promise.all([
		client.rest.get(Routes.guildRoles(data.guild_id)) as Promise<APIRole[]>,
		fetchChannel(client, data.channel_id)
	])
	const roleMap = new Map(roles.map((role) => [role.id, BigInt(role.permissions)]))
	let permissions = roleMap.get(data.guild_id) ?? 0n
	for (const roleId of data.rawMember.roles) {
		permissions |= roleMap.get(roleId) ?? 0n
	}

	if (hasPermission(permissions, PermissionFlagsBits.Administrator)) {
		return { canEmbed: true, reason: "administrator" }
	}

	const permissionChannel = await getPermissionChannel(client, channel)
	const overwrites =
		"permission_overwrites" in permissionChannel
			? permissionChannel.permission_overwrites ?? []
			: []
	const everyoneOverwrite = overwrites.find(
		(overwrite) => overwrite.type === OverwriteType.Role && overwrite.id === data.guild_id
	)
	if (everyoneOverwrite) {
		permissions = applyOverwrite(
			permissions,
			everyoneOverwrite.allow,
			everyoneOverwrite.deny
		)
	}

	let roleAllow = 0n
	let roleDeny = 0n
	for (const overwrite of overwrites) {
		if (
			overwrite.type === OverwriteType.Role &&
			data.rawMember.roles.includes(overwrite.id)
		) {
			roleAllow |= BigInt(overwrite.allow)
			roleDeny |= BigInt(overwrite.deny)
		}
	}
	permissions = (permissions & ~roleDeny) | roleAllow

	const memberOverwrite = overwrites.find(
		(overwrite) => overwrite.type === OverwriteType.Member && overwrite.id === data.author.id
	)
	if (memberOverwrite) {
		permissions = applyOverwrite(permissions, memberOverwrite.allow, memberOverwrite.deny)
	}

	return {
		canEmbed: hasPermission(permissions, PermissionFlagsBits.EmbedLinks),
		reason: `effective-permissions channel=${permissionChannel.id}`
	}
}

export default class GifRepostMessageCreate extends MessageCreateListener {
	async handle(data: ListenerEventData[this["type"]], client: Client) {
		if (!data.channel_id) {
			return
		}
		if (data.webhook_id || data.author.bot) {
			return
		}

		await logGifRepost(
			client,
			`received contentLength=${data.content.length} attachments=${data.attachments?.length ?? 0} embeds=${data.embeds?.length ?? 0}`,
			data
		)

		const gifLink = findGifLink(data.content)
		if (!gifLink) {
			if ((data.attachments?.length ?? 0) > 0 || (data.embeds?.length ?? 0) > 0) {
				await logGifRepost(
					client,
					`skip no-supported-link contentLength=${data.content.length} attachments=${data.attachments?.length ?? 0} embeds=${data.embeds?.length ?? 0}`,
					data
				)
			}
			return
		}

		await logGifRepost(client, `matched link=${gifLink}`, data)

		try {
			const embedPermission = await canEmbedLinksInChannel(client, data)
			await logGifRepost(
				client,
				`permission canEmbed=${embedPermission.canEmbed} reason=${embedPermission.reason}`,
				data
			)
			if (embedPermission.canEmbed) {
				await logGifRepost(client, "skip user-can-embed", data)
				return
			}

			const webhook = await getOrCreateChannelWebhook(client, data.channel_id)
			await logGifRepost(client, "delete-original", data)
			await client.rest.delete(Routes.channelMessage(data.channel_id, data.id))
			await logGifRepost(client, "send-webhook", data)
			await sendWebhookMessage(webhook, {
				content: gifLink,
				username:
					data.member?.nickname ||
					data.author.globalName ||
					data.author.username ||
					data.author.id,
				avatar_url: data.member?.avatarUrl || data.author.avatarUrl || undefined
			})
			await logGifRepost(client, "reposted", data)
		} catch (error) {
			await logGifRepost(
				client,
				`failed error=${error instanceof Error ? error.message : String(error)}`,
				data
			)
		}
	}
}
