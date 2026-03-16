import {
	type Client,
	ReadyListener,
	type ListenerEventData
} from "@buape/carbon"
import { startScheduler } from "../lib/scheduler.js"

export default class Ready extends ReadyListener {
	async handle(data: ListenerEventData[this["type"]], client: Client) {
		console.log(`Logged in as ${data.user.username}`)
		startScheduler(client)
	}
}