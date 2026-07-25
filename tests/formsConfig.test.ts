import { describe, expect, it } from "bun:test"
import { formConfigs, formSettings } from "../forms.config.js"

describe("form review routing", () => {
	it("routes moderator reports to CT automod for Community Team review", () => {
		const form = formConfigs.find((item) => item.id === "report-mod")

		expect(formSettings.moderatorReportReviewChannelId).toBe("1457498550651851005")
		expect(formSettings.moderatorReportReviewRoleId).toBe("1477360613125787678")
		expect(form?.reviewChannelId).toBe(formSettings.moderatorReportReviewChannelId)
		expect(form?.reviewRoleId).toBe(formSettings.moderatorReportReviewRoleId)
	})
})
