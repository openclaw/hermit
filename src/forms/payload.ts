import type { FormConfig, FormField } from "./types.js"

const isCollectableField = (field: FormField) =>
	field.type === "text" ||
	field.type === "textarea" ||
	field.type === "select" ||
	field.type === "checkbox"

export const collectPayload = async (request: Request, form: FormConfig) => {
	const body = await request.formData()
	const allowed = new Set(form.fields.filter(isCollectableField).map((field) => field.id))
	const payload: Record<string, string> = {}
	body.forEach((value, key) => {
		if (key !== "session" && allowed.has(key)) {
			payload[key] = String(value).trim()
		}
	})
	return { payload, session: String(body.get("session") ?? "") }
}

export const buildSubmissionPayload = (
	collected: Record<string, string>,
	context: Record<string, string>
) => ({
	...collected,
	...context
})
