import {
	AutoModerationActionExecutionListener,
	type Client,
	type ListenerEventData,
	ListenerEvent,
	Routes,
	serializePayload
} from "@buape/carbon"
import automodMessages from "../config/automod-messages.json" with { type: "json" }
import { getOrCreateChannelWebhook, sendWebhookMessage } from "../utils/channelWebhook.js"

type AutomodRuleConfig = {
	trigger: string
	message: string
	confirmRoleId?: string
	redact?: boolean
}

type AutomodMessageMap = Record<string, AutomodRuleConfig | AutomodRuleConfig[]>

type AutoModerationActionExecutionData =
	ListenerEventData[typeof ListenerEvent.AutoModerationActionExecution]

const normalizeKeyword = (keyword: string) => keyword.trim().toLowerCase()

const loadAutomodMessages = async (): Promise<AutomodMessageMap> => {
	return automodMessages as AutomodMessageMap
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const formatAutomodMessage = (template: string, data: AutoModerationActionExecutionData) =>
	template
		.replaceAll("{user}", `<@${data.user_id}>`)
		.replaceAll("{keyword}", data.matched_keyword ?? "")
		.replaceAll("{content}", data.matched_content ?? data.content ?? "")

const resolveRuleConfig = (
	rules: AutomodRuleConfig | AutomodRuleConfig[],
	matchedKeyword: string
) => {
	const ruleList = Array.isArray(rules) ? rules : [rules]
	return ruleList.find((rule) => normalizeKeyword(rule.trigger) === matchedKeyword)
}

const resolveMember = async (data: AutoModerationActionExecutionData) => {
	if (!data.guild) {
		return null
	}
	try {
		return await data.guild.fetchMember(data.user_id)
	} catch (error) {
		console.error("Failed to fetch guild member:", error)
		return null
	}
}

export default class AutoModerationActionExecution extends AutoModerationActionExecutionListener {
	async handle(data: ListenerEventData[this["type"]], client: Client) {
		if (!data.channel_id || !data.matched_keyword) {
			return
		}

		const messages = await loadAutomodMessages()
		const ruleConfig = messages[data.rule_id]

		if (!ruleConfig) {
			return
		}

		const matchedKeyword = normalizeKeyword(data.matched_keyword)
		const activeRule = resolveRuleConfig(ruleConfig, matchedKeyword)

		if (!activeRule) {
			return
		}

		const sourceContent = data.content || data.matched_content || ""
		const shouldRedact = activeRule.redact !== false
		const redactedContent = sourceContent
			? sourceContent.replace(
				new RegExp(escapeRegExp(activeRule.trigger), "gi"),
				"<redacted>"
			)
			: "<redacted>"
		const repostContent = shouldRedact ? redactedContent : sourceContent || "<redacted>"

		const warningMessage = formatAutomodMessage(activeRule.message, data)
		const warningLines = [warningMessage]
		if (activeRule.confirmRoleId) {
			warningLines.push(
				`Need the crustacean crew? Ping <@&${activeRule.confirmRoleId}> to request a mod splash.`
			)
		}

		const warningPayload = serializePayload({
			content: warningLines.join("\n\n"),
			allowedMentions: {
				users: [data.user_id]
			}
		})

		try {
			const webhook = await getOrCreateChannelWebhook(client, data.channel_id, "Hermit Automod")
			const member = await resolveMember(data)
			const displayName =
				member?.nickname ||
				member?.user?.globalName ||
				member?.user?.username ||
				data.user?.globalName ||
				data.user?.username ||
				data.user_id
			const avatarUrl =
				member?.avatarUrl ||
				member?.user?.avatarUrl ||
				data.user?.avatarUrl ||
				undefined

			await sendWebhookMessage(webhook, {
				content: repostContent,
				username: displayName,
				avatar_url: avatarUrl
			})

			await client.rest.post(Routes.channelMessages(data.channel_id), {
				body: warningPayload
			})
		} catch (error) {
			console.error("Failed to send automod response:", error)
		}
	}
}
