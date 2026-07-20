import { describe, expect, it, mock } from "bun:test"
import { createCommandDeploymentTracker } from "../src/runtime/commandDeployment.js"

describe("command deployment lifecycle", () => {
	it("tracks one deployment per worker isolate", async () => {
		const deployCommands = mock(async () => ({ usedDevGuilds: false }))
		const tracked: Promise<unknown>[] = []
		const trackDeployment = createCommandDeploymentTracker(deployCommands)
		const context = {
			waitUntil(promise: Promise<unknown>) {
				tracked.push(promise)
			}
		}

		const first = trackDeployment(context)
		const second = trackDeployment(context)

		expect(deployCommands).toHaveBeenCalledTimes(1)
		expect(first).toBe(second)
		expect(tracked).toEqual([first, first])
		await first
	})

	it("allows a later request to retry after deployment fails", async () => {
		const consoleError = mock(() => {})
		const previousConsoleError = console.error
		console.error = consoleError
		let attempts = 0
		const deployCommands = mock(async () => {
			attempts += 1
			if (attempts === 1) {
				throw new Error("Discord unavailable")
			}
			return { usedDevGuilds: false }
		})
		const trackDeployment = createCommandDeploymentTracker(deployCommands)
		const context = { waitUntil() {} }

		try {
			await expect(trackDeployment(context)).rejects.toThrow(
				"Discord unavailable"
			)
			await expect(trackDeployment(context)).resolves.toEqual({
				usedDevGuilds: false
			})
			expect(deployCommands).toHaveBeenCalledTimes(2)
			expect(consoleError).toHaveBeenCalledTimes(1)
		} finally {
			console.error = previousConsoleError
		}
	})
})
