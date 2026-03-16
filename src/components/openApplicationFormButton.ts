import {
	Button,
	ButtonStyle,
	type ButtonInteraction,
	type ComponentData,
} from "@buape/carbon"
import { eq } from "drizzle-orm"
import { db } from "../db.js"
import { applications } from "../db/schema.js"
import ApplicationModal from "../modals/applicationModal.js"

export default class OpenApplicationFormButton extends Button {
	customId = "onboarding-open-form"
	label = "Open Application Form"
	style = ButtonStyle.Primary

	constructor(applicationId?: string) {
		super()
		if (applicationId) {
			this.customId = `onboarding-open-form:applicationId=${applicationId}`
		}
	}

	async run(interaction: ButtonInteraction, data: ComponentData) {
		const applicationId = String(data.applicationId)

		// 1. Load the application from DB
		const application = await db
			.select()
			.from(applications)
			.where(eq(applications.id, applicationId))
			.get()

		if (!application) {
			await interaction.reply({
				content: "Application not found. Please contact a Team Lead.",
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 2. Verify it's still in FORM_SENT status
		if (application.status !== "FORM_SENT") {
			await interaction.reply({
				content: "This application has already been submitted or is no longer active.",
				flags: 64,
				allowedMentions: { parse: [] },
			})
			return
		}

		// 3. Show the modal — Carbon's showModal method handles this.
		// Note: showModal can only be used if the interaction is NOT deferred.
		// This button must NOT set defer = true.
		await interaction.showModal(new ApplicationModal(applicationId))
	}
}
