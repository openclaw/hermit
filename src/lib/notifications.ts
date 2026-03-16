import type { Client } from "@buape/carbon"
import type { TeamSlug } from "../types/onboarding.js"
import { getGlobalConfig, getTeamConfig } from "./configStore.js"

export type MessagePayload = {
  content?: string
  components?: unknown[]
  flags?: number
  allowed_mentions?: {
    parse?: string[]
    users?: string[]
    roles?: string[]
    replied_user?: boolean
  }
}

async function openDmChannel(
  client: Client,
  userId: string,
): Promise<string | null> {
  try {
    const channel = (await client.rest.post("/users/@me/channels", {
      body: { recipient_id: userId },
    })) as { id: string }
    return channel.id
  } catch (err) {
    console.error(`[notifications] Failed to open DM channel for ${userId}:`, err)
    return null
  }
}

export async function dmUser(
  client: Client,
  userId: string,
  content: string,
): Promise<void> {
  const channelId = await openDmChannel(client, userId)
  if (!channelId) return
  try {
    await client.rest.post(`/channels/${channelId}/messages`, {
      body: { content },
    })
  } catch (err) {
    console.error(`[notifications] Failed to DM user ${userId}:`, err)
  }
}

export async function dmUserPayload(
  client: Client,
  userId: string,
  payload: MessagePayload,
): Promise<void> {
  const channelId = await openDmChannel(client, userId)
  if (!channelId) return
  try {
    await client.rest.post(`/channels/${channelId}/messages`, { body: payload })
  } catch (err) {
    console.error(`[notifications] Failed to DM user ${userId} with payload:`, err)
  }
}

export async function postToChannel(
  client: Client,
  channelId: string,
  payload: MessagePayload,
): Promise<string | null> {
  try {
    const msg = (await client.rest.post(`/channels/${channelId}/messages`, {
      body: payload,
    })) as { id: string }
    return msg.id
  } catch (err) {
    console.error(`[notifications] Failed to post to channel ${channelId}:`, err)
    return null
  }
}

export async function postToTeamChannel(
  client: Client,
  team: TeamSlug,
  payload: MessagePayload,
): Promise<string | null> {
  const config = await getTeamConfig(team)
  if (!config.channelId) {
    console.error(`[notifications] No channelId configured for team ${team}`)
    return null
  }
  return postToChannel(client, config.channelId, payload)
}

export async function postToModLog(
  client: Client,
  payload: MessagePayload,
): Promise<void> {
  const config = await getGlobalConfig()
  if (!config.modLogChannelId) return
  await postToChannel(client, config.modLogChannelId, payload)
}

export async function postPublicAnnouncement(
  client: Client,
  payload: MessagePayload,
): Promise<void> {
  const config = await getGlobalConfig()
  if (!config.publicAnnouncementChannelId) return
  await postToChannel(client, config.publicAnnouncementChannelId, payload)
}

export async function editMessage(
  client: Client,
  channelId: string,
  messageId: string,
  payload: MessagePayload,
): Promise<void> {
  try {
    await client.rest.patch(`/channels/${channelId}/messages/${messageId}`, {
      body: payload,
    })
  } catch (err) {
    console.error(
      `[notifications] Failed to edit message ${messageId} in ${channelId}:`,
      err,
    )
  }
}
