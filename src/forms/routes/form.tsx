import { getFormAuthProviders, renderFormText } from "../forms.js"
import type { FormConfig, FormField } from "../types.js"
import {
	Alert,
	Button,
	ButtonLink,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	Input,
	Select,
	Textarea
} from "../components/ui.js"

const FieldInput = ({
	field,
	values
}: {
	field: FormField
	values?: Record<string, string>
}) => {
	if (field.type === "autofill") {
		return (
			<Input
				id={field.id}
				value={values?.[field.contextKey] ?? ""}
				placeholder={field.placeholder ? renderFormText(field.placeholder, values) : undefined}
				disabled
				readOnly
			/>
		)
	}
	if (field.type === "textarea") {
		return <Textarea id={field.id} name={field.id} required={field.required} placeholder={field.placeholder ? renderFormText(field.placeholder, values) : undefined} />
	}
	if (field.type === "select") {
		return (
			<Select id={field.id} name={field.id} required={field.required}>
				<option value="">Select one</option>
				{field.options.map((option) => <option key={option}>{option}</option>)}
			</Select>
		)
	}
	if (field.type === "text") {
		return <Input id={field.id} name={field.id} required={field.required} placeholder={field.placeholder ? renderFormText(field.placeholder, values) : undefined} />
	}
	if (field.type === "file") {
		return <Input id={field.id} name={field.id} required={field.required} type="file" accept={field.accept} multiple={field.multiple} />
	}
	return null
}

const fieldRequired = (field: FormField) => "required" in field && field.required

const Field = ({ field, values }: { field: FormField; values?: Record<string, string> }) => {
	const label = renderFormText(field.label, values)
	if (field.type === "checkbox") {
		return (
			<label
				className="flex cursor-pointer items-start gap-3 rounded-lg border border-input bg-secondary p-4 transition-colors hover:border-primary/40 hover:bg-accent/50"
				htmlFor={field.id}
			>
				<input
					className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
					id={field.id}
					name={field.id}
					required={field.required}
					type="checkbox"
					value={field.value ?? "on"}
				/>
				<span className="text-[0.9375rem] font-semibold leading-snug tracking-tight text-foreground">
					{label}{field.required ? <span className="text-primary"> *</span> : null}
				</span>
			</label>
		)
	}
	return (
		<section className="grid gap-2">
			<label className="text-[0.9375rem] font-semibold leading-tight tracking-tight text-foreground" htmlFor={field.id}>
				{label}{fieldRequired(field) ? <span className="text-primary"> *</span> : null}
			</label>
			<FieldInput field={field} values={values} />
		</section>
	)
}

const providerName = (provider: "discord" | "github" | "reddit") => {
	if (provider === "github") return "GitHub"
	if (provider === "reddit") return "Reddit"
	return "Discord"
}

const submitDedupeScript = `
document.addEventListener("submit", function (event) {
	var form = event.target;
	if (!(form instanceof HTMLFormElement) || !form.matches("[data-appeal-form]")) return;
	if (form.dataset.submitting === "true") {
		event.preventDefault();
		return;
	}
	form.dataset.submitting = "true";
	var button = form.querySelector("button[type='submit']");
	if (!button) return;
	button.disabled = true;
	button.textContent = "Submitting…";
});
window.addEventListener("pageshow", function () {
	document.querySelectorAll("[data-appeal-form]").forEach(function (form) {
		form.dataset.submitting = "false";
		var button = form.querySelector("button[type='submit']");
		if (!button) return;
		button.disabled = false;
		button.textContent = "Submit";
	});
});
`

export const AuthGateRoute = ({ form, error }: { form: FormConfig; error?: string }) => (
	<Card className="w-full">
		<CardHeader>
			{error ? <Alert>{error}</Alert> : null}
			<h1 className="m-0 text-2xl font-semibold tracking-tight">{form.title}</h1>
			<CardDescription>Sign in to continue.</CardDescription>
		</CardHeader>
		<CardContent className="flex flex-wrap gap-3">
			{getFormAuthProviders(form).map((provider) => (
				<ButtonLink href={`/oauth/${provider}/start?form=${form.id}`} key={provider}>
					Sign in with {providerName(provider)}
				</ButtonLink>
			))}
		</CardContent>
	</Card>
)

export const FormRoute = ({
	form,
	session,
	user,
	values,
	error
}: {
	form: FormConfig
	session: string | null
	user: { username: string } | null
	values?: Record<string, string>
	error?: string
}) => (
	<Card className="w-full">
		<CardHeader>
			{error ? <Alert>{error}</Alert> : null}
			<h1 className="m-0 text-2xl font-semibold tracking-tight">{form.title}</h1>
			<CardDescription>{user ? `Signed in as ${user.username}` : form.description}</CardDescription>
		</CardHeader>
		<CardContent>
			<form className="grid gap-4" method="post" action={`/${form.id}/submit`} encType={form.fields.some((field) => field.type === "file") ? "multipart/form-data" : undefined} data-appeal-form>
				{session ? <input type="hidden" name="session" value={session} /> : null}
				{form.fields.map((field) => <Field field={field} key={field.id} values={values} />)}
				<Button className="w-fit" type="submit">Submit</Button>
			</form>
			<script dangerouslySetInnerHTML={{ __html: submitDedupeScript }} />
		</CardContent>
	</Card>
)
