type CommandDeploymentContext = {
	waitUntil(promise: Promise<unknown>): void
}

export const createCommandDeploymentTracker = (
	deployCommands: () => Promise<unknown>
) => {
	let deployment: Promise<unknown> | undefined

	return (context: CommandDeploymentContext) => {
		if (!deployment) {
			deployment = deployCommands().catch((error) => {
				deployment = undefined
				console.error("Failed to deploy Discord commands:", error)
				throw error
			})
		}

		context.waitUntil(deployment)
		return deployment
	}
}
