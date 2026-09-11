import { afterEach, describe, expect, mock, test } from "bun:test"
import { Permission, type Command, type CommandInteraction } from "@buape/carbon"
import HelperRootCommand from "../../src/commands/helper.js"
import SolvedModCommand from "../../src/commands/solvedMod.js"

const helperParentId = "helper-forum-parent"

type ThreadChannelMock = {
	parentId: string | null
	archive: ReturnType<typeof mock>
	lock: ReturnType<typeof mock>
}

const extractReplyText = (reply: ReturnType<typeof mock>) => {
	const payload = reply.mock.calls[0]?.[0] as {
		components?: { components?: { content?: string }[] }[]
	}
	return payload?.components?.[0]?.components?.[0]?.content ?? ""
}

const makeThreadChannel = (parentId: string | null): ThreadChannelMock => ({
	parentId,
	archive: mock(() => Promise.resolve()),
	lock: mock(() => Promise.resolve())
})

const makeInteraction = (channel: ThreadChannelMock | null) => {
	const reply = mock(() => Promise.resolve())
	const interaction = {
		rawData: {
			channel_id: "thread-1",
			guild_id: "guild-1",
			channel: { id: "thread-1" }
		},
		channel: { id: "thread-1" },
		user: { id: "user-1", username: "helper", globalName: "Helper" },
		client: {
			fetchChannel: mock(() => Promise.resolve(channel))
		},
		reply
	}
	return { interaction, reply }
}

const getHelperSubcommand = (name: string): Command => {
	const command = new HelperRootCommand().subcommands.find(
		(subcommand) => subcommand.name === name
	)
	if (!command) {
		throw new Error(`Missing /helper ${name} subcommand`)
	}
	return command
}

const runHelperClose = async (channel: ThreadChannelMock | null) => {
	const { interaction, reply } = makeInteraction(channel)
	await getHelperSubcommand("close").run(
		interaction as unknown as CommandInteraction
	)
	return { reply, channel }
}

describe("HelperRootCommand close permissions", () => {
	const originalHelperParent = process.env.HELPER_THREAD_WELCOME_PARENT_ID

	afterEach(() => {
		if (originalHelperParent === undefined) {
			delete process.env.HELPER_THREAD_WELCOME_PARENT_ID
		} else {
			process.env.HELPER_THREAD_WELCOME_PARENT_ID = originalHelperParent
		}
	})

	test("exposes the same permission bits as /solved", () => {
		const helper = new HelperRootCommand()
		const solved = new SolvedModCommand()
		expect(helper.permission).toEqual(solved.permission)
		expect(helper.permission).toEqual([
			Permission.ManageMessages,
			Permission.ManageThreads
		])
	})

	test("close refuses a thread whose parent is not the helper parent", async () => {
		process.env.HELPER_THREAD_WELCOME_PARENT_ID = helperParentId
		const channel = makeThreadChannel("some-other-forum")
		const { reply } = await runHelperClose(channel)
		const text = extractReplyText(reply)

		expect(text.toLowerCase()).toContain("helper")
		expect(text.toLowerCase()).not.toContain("now closed")
		expect(channel.archive).not.toHaveBeenCalled()
		expect(channel.lock).not.toHaveBeenCalled()
	})

	test("close archives and locks when the parent matches", async () => {
		process.env.HELPER_THREAD_WELCOME_PARENT_ID = helperParentId
		const channel = makeThreadChannel(helperParentId)
		const { reply } = await runHelperClose(channel)

		expect(channel.archive).toHaveBeenCalledTimes(1)
		expect(channel.lock).toHaveBeenCalledTimes(1)
		expect(extractReplyText(reply)).toContain("This thread is now closed")
	})
})
