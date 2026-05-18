import {
	ChannelType,
	MessageCreateListener,
	MessageFlags,
	PermissionFlagsBits,
	type APIChannel,
	type APIRole,
	type Client,
	type ListenerEventData,
	Routes
} from "@buape/carbon"
import { getOrCreateChannelWebhook, sendWebhookMessage } from "../utils/channelWebhook.js"

const gifLinkDomains = new Set(["tenor.com", "klipy.com", "giphy.com"])
const urlRegex = /https?:\/\/[^\s<>()]+/gi

const trimUrl = (url: string) => url.replace(/[.,!?;:]+$/, "")
const hasPermission = (permissions: bigint, permission: bigint) =>
	(permissions & permission) === permission
const isRoleOverwrite = (type: unknown) => type === 0 || type === "role"
const isMemberOverwrite = (type: unknown) => type === 1 || type === "member"

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

const isEmbedLinksDeniedForEveryone = (channel: APIChannel, guildId: string) => {
	const overwrites =
		"permission_overwrites" in channel ? channel.permission_overwrites ?? [] : []
	return overwrites.some(
		(overwrite) =>
			isRoleOverwrite(overwrite.type) &&
			overwrite.id === guildId &&
			hasPermission(BigInt(overwrite.deny), PermissionFlagsBits.EmbedLinks)
	)
}

const canEmbedLinksInChannel = async (
	client: Client,
	data: ListenerEventData["MESSAGE_CREATE"],
	permissionChannel: APIChannel
) => {
	if (!data.guild_id || !data.rawMember) {
		return true
	}

	const roles = (await client.rest.get(Routes.guildRoles(data.guild_id))) as APIRole[]
	const roleMap = new Map(roles.map((role) => [role.id, BigInt(role.permissions)]))
	let permissions = roleMap.get(data.guild_id) ?? 0n
	for (const roleId of data.rawMember.roles) {
		permissions |= roleMap.get(roleId) ?? 0n
	}

	if (hasPermission(permissions, PermissionFlagsBits.Administrator)) {
		return true
	}

	const overwrites =
		"permission_overwrites" in permissionChannel
			? permissionChannel.permission_overwrites ?? []
			: []
	const everyoneOverwrite = overwrites.find(
		(overwrite) => isRoleOverwrite(overwrite.type) && overwrite.id === data.guild_id
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
		if (isRoleOverwrite(overwrite.type) && data.rawMember.roles.includes(overwrite.id)) {
			roleAllow |= BigInt(overwrite.allow)
			roleDeny |= BigInt(overwrite.deny)
		}
	}
	permissions = (permissions & ~roleDeny) | roleAllow

	const memberOverwrite = overwrites.find(
		(overwrite) => isMemberOverwrite(overwrite.type) && overwrite.id === data.author.id
	)
	if (memberOverwrite) {
		permissions = applyOverwrite(permissions, memberOverwrite.allow, memberOverwrite.deny)
	}

	return hasPermission(permissions, PermissionFlagsBits.EmbedLinks)
}

export default class GifRepostMessageCreate extends MessageCreateListener {
	async handle(data: ListenerEventData[this["type"]], client: Client) {
		if (!data.channel_id || data.webhook_id || data.author.bot || !data.guild_id) {
			return
		}

		const channel = await fetchChannel(client, data.channel_id)
		const permissionChannel = await getPermissionChannel(client, channel)
		if (!isEmbedLinksDeniedForEveryone(permissionChannel, data.guild_id)) {
			return
		}

		const gifLink = findGifLink(data.content)
		if (!gifLink) {
			return
		}

		try {
			if (await canEmbedLinksInChannel(client, data, permissionChannel)) {
				return
			}

			const webhook = await getOrCreateChannelWebhook(client, data.channel_id)
			await sendWebhookMessage(webhook, {
				content: gifLink,
				username:
					data.member?.nickname ||
					data.author.globalName ||
					data.author.username ||
					data.author.id,
				avatar_url: data.member?.avatarUrl || data.author.avatarUrl || undefined
			})

			if (data.content.trim() === gifLink) {
				await client.rest.delete(Routes.channelMessage(data.channel_id, data.id))
			} else {
				await client.rest.patch(Routes.channelMessage(data.channel_id, data.id), {
					body: { flags: (data.flags ?? 0) | MessageFlags.SuppressEmbeds }
				})
			}
		} catch (error) {
			console.error("Failed to repost GIF link:", error)
		}
	}
}
