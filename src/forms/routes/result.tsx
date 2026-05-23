import { Alert, ButtonLink, Card, CardContent, CardHeader } from "../components/ui.js"

export const ResultRoute = ({
	title,
	message,
	ok = true,
	action
}: {
	title: string
	message: string
	ok?: boolean
	action?: { href: string; label: string; description?: string }
}) => (
	<Card className="w-full">
		<CardHeader>
			<h1 className="m-0 text-2xl font-semibold tracking-tight">{title}</h1>
			{message && message !== title ? <Alert ok={ok}>{message}</Alert> : null}
		</CardHeader>
		<CardContent className="grid gap-4">
			{action ? (
				<div className="grid gap-3 rounded-lg border border-border bg-secondary p-4">
					{action.description ? <p className="m-0 text-sm text-muted-foreground">{action.description}</p> : null}
					<ButtonLink className="w-fit" href={action.href}>{action.label}</ButtonLink>
				</div>
			) : null}
			<ButtonLink className="w-fit" href="/">Back</ButtonLink>
		</CardContent>
	</Card>
)
