import { describe, expect, it } from "bun:test"
import {
	type CommandInteraction,
	serializePayload
} from "@buape/carbon"
import SayRootCommand from "../src/commands/say.js"

const flattenComponents = (component: unknown): Record<string, unknown>[] => {
	if (!component || typeof component !== "object") {
		return []
	}

	const record = component as Record<string, unknown>
	const children = Array.isArray(record.components)
		? record.components.flatMap(flattenComponents)
		: []

	return [record, ...children]
}

const renderSubcommand = async (name: string) => {
	const command = new SayRootCommand().subcommands.find(
		(subcommand) => subcommand.name === name
	)
	expect(command).toBeDefined()

	const replies: unknown[] = []
	await command?.run({
		options: {
			getUser: () => undefined
		},
		reply: async (payload: unknown) => {
			replies.push(payload)
		}
	} as unknown as CommandInteraction)

	return flattenComponents(serializePayload(replies[0]))
		.map((component) => component.content)
		.filter((content): content is string => typeof content === "string")
		.join("\n")
}

describe("/say", () => {
	it("only registers the retained subcommands", () => {
		expect(
			new SayRootCommand().subcommands.map((subcommand) => subcommand.name)
		).toEqual(["help", "pr-review", "clawtributor", "impersonation"])
	})

	it("points help requests to the support forum", async () => {
		const message = await renderSubcommand("help")

		expect(message).toContain("[Get support](https://community.openclaw.ai/)")
		expect(message).toContain("official OpenClaw support")
		expect(message).toContain("relevant topic")
		expect(message).toContain("redacted logs")
		expect(message).not.toContain("<#1459642797895319552>")
		expect(message).toContain("https://docs.openclaw.ai/help/faq")
		expect(message).not.toContain("old-help")
	})

	it("matches the current PR review requirements", async () => {
		const message = await renderSubcommand("pr-review")

		expect(message).toContain("What Problem This Solves")
		expect(message).toContain("User Impact")
		expect(message).toContain("Evidence")
		expect(message).toContain("make sure CI passes")
		expect(message).toContain("Allow edits by maintainers")
		expect(message).toContain(
			"https://github.com/openclaw/openclaw/blob/main/CONTRIBUTING.md"
		)
	})

	it("uses the current clawtributor claim flow", async () => {
		const message = await renderSubcommand("clawtributor")

		expect(message).toContain("Discord Settings -> Connections -> GitHub")
		expect(message).toContain("`/claim`")
		expect(message).toContain("private authorization link")
		expect(message).toContain("merged pull request")
		expect(message).not.toContain("</claim:0>")
	})

	it("keeps the impersonation warning evergreen", async () => {
		const message = await renderSubcommand("impersonation")

		expect(message).toContain("unsolicited DMs")
		expect(message).toContain("Do not share tokens")
		expect(message).toContain("Verify the person's identity")
		expect(message).toContain("Report impersonators")
		expect(message).not.toContain("We've seen reports")
	})
})
