import fs from "node:fs"
import {
	getRecentDiscrawlObservations,
	getDiscrawlObservationCount
} from "../../src/services/discrawl.js"

export interface DiscrawlServerOptions {
	exportPath: string
	secret: string
	port?: number
}

export const startDiscrawlServer = (options: DiscrawlServerOptions) => {
	const { exportPath, secret, port = 3002 } = options

	return Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url)

			// Authenticate with Bearer token
			const auth = req.headers.get("Authorization")
			if (!auth || auth !== `Bearer ${secret}`) {
				return new Response(JSON.stringify({ error: "Unauthorized" }), {
					status: 401,
					headers: { "Content-Type": "application/json" }
				})
			}

			if (req.method !== "GET") {
				return new Response(JSON.stringify({ error: "Method not allowed" }), {
					status: 405,
					headers: { "Content-Type": "application/json" }
				})
			}

			if (url.pathname === "/api/discrawl/health") {
				return new Response(
					JSON.stringify({
						status: "ok",
						exportPathExists: fs.existsSync(exportPath)
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" }
					}
				)
			}

			if (url.pathname === "/api/discrawl/observations") {
				const guildId = url.searchParams.get("guildId") || ""
				const authorId = url.searchParams.get("authorId") || ""
				const windowDays = Number(url.searchParams.get("windowDays") || 7)
				const limit = Number(url.searchParams.get("limit") || 200)

				if (!authorId) {
					return new Response(JSON.stringify({ error: "Missing authorId" }), {
						status: 400,
						headers: { "Content-Type": "application/json" }
					})
				}

				const observations = getRecentDiscrawlObservations(
					exportPath,
					guildId,
					authorId,
					windowDays,
					limit
				)

				return new Response(JSON.stringify(observations), {
					status: 200,
					headers: { "Content-Type": "application/json" }
				})
			}

			if (url.pathname === "/api/discrawl/count") {
				const guildId = url.searchParams.get("guildId") || ""
				const authorId = url.searchParams.get("authorId") || ""
				const windowDays = Number(url.searchParams.get("windowDays") || 7)

				if (!authorId) {
					return new Response(JSON.stringify({ error: "Missing authorId" }), {
						status: 400,
						headers: { "Content-Type": "application/json" }
					})
				}

				const count = getDiscrawlObservationCount(
					exportPath,
					guildId,
					authorId,
					windowDays
				)

				return new Response(JSON.stringify({ count }), {
					status: 200,
					headers: { "Content-Type": "application/json" }
				})
			}

			return new Response(JSON.stringify({ error: "Not found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" }
			})
		}
	})
}
