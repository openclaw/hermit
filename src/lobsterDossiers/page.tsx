import type { LobsterMetadataRecord } from "../../scripts/lib/lobster-metadata.js"
import type { LobsterTaxonomyRecord } from "../config/lobsterTaxonomy.js"
import { Card, CardContent, CardHeader } from "../forms/components/ui.js"

const fallbackActions = new Set([
	"refusal",
	"ceremonial-display",
	"editorial-observe",
	"editorial-pose"
])

const actionLabels: Record<string, string> = {
	pinch: "Pinch with enlarged claws",
	"antenna-strike": "Strike with prominent antennae",
	"large-chela-stand-off": "Stage a large-claw stand-off",
	"antenna-stand-off": "Stage an antenna stand-off",
	"multi-chela-stand-off": "Stage a multi-claw stand-off",
	"subchelate-stand-off": "Stage a subchelate-leg stand-off",
	"antenna-plate-refusal": "Issue a flat-antenna refusal",
	"tail-escape": "Tail-flip away"
}

const actionSummaryLabels: Record<string, string> = {
	pinch: "pinch with enlarged claws",
	"antenna-strike": "strike with prominent antennae",
	"large-chela-stand-off": "stage a large-claw stand-off",
	"antenna-stand-off": "stage an antenna stand-off",
	"multi-chela-stand-off": "stage a multi-claw stand-off",
	"subchelate-stand-off": "stage a subchelate-leg stand-off",
	"antenna-plate-refusal": "issue a flat-antenna refusal",
	"tail-escape": "tail-flip away"
}

const evidenceValue = ({
	value,
	status
}: LobsterMetadataRecord["habitat"]) =>
	status === "known" && value ? value : "Unknown in the bundled evidence"

const dossierSummary = (metadata: LobsterMetadataRecord) => {
	const actions = metadata.permittedActions
		.filter(({ id }) => !fallbackActions.has(id))
		.map(
			({ id }) =>
				actionSummaryLabels[id] ?? id.replaceAll("-", " ").toLowerCase()
		)
	const operatingNote =
		actions.length === 1
			? actions[0]
			: `${actions.slice(0, -1).join(", ")}, and ${actions.at(-1)}`

	return `${metadata.displayName} reports for duty with a ${metadata.broadBodyPlan.value}. Bundled evidence authorizes it to ${operatingNote}; all unsupported crustacean improvisation has been denied.`
}

export const LobsterDossierPage = ({
	taxonomy,
	metadata,
	sceneAltText,
	sceneUrl
}: {
	taxonomy: LobsterTaxonomyRecord
	metadata: LobsterMetadataRecord
	sceneAltText: string
	sceneUrl: string
}) => {
	const anatomyActions = metadata.permittedActions.filter(
		({ id }) => !fallbackActions.has(id)
	)

	return (
		<Card className="w-full">
			<CardHeader>
				<p className="m-0 text-sm text-muted-foreground">
					OpenClaw Lobster Dossier - AphiaID {taxonomy.AphiaID}
				</p>
				<h1 className="m-0 text-2xl font-semibold tracking-tight">
					{metadata.displayName}
				</h1>
				<p className="m-0 text-sm text-muted-foreground">
					<em>{taxonomy.scientificName}</em> {taxonomy.authority}
				</p>
			</CardHeader>
			<CardContent className="grid gap-4">
				<img
					alt={sceneAltText}
					height={512}
					src={sceneUrl}
					width={768}
				/>

				<section>
					<h2 className="m-0 text-2xl font-semibold tracking-tight">
						Case summary
					</h2>
					<p>{dossierSummary(metadata)}</p>
				</section>

				<section className="grid gap-3 rounded-lg border border-border bg-secondary p-4">
					<h2 className="m-0 text-2xl font-semibold tracking-tight">
						Scientific file
					</h2>
					<p>
						<strong>Family:</strong> {taxonomy.family}
					</p>
					<p>
						<strong>Body plan:</strong>{" "}
						{evidenceValue(metadata.broadBodyPlan)}
					</p>
					<p>
						<strong>Habitat:</strong> {evidenceValue(metadata.habitat)}
					</p>
					<p>
						<strong>Depth:</strong> {evidenceValue(metadata.depthBand)}
					</p>
					<p>
						<strong>Geographic range:</strong>{" "}
						{evidenceValue(metadata.geographicRegion)}
					</p>
				</section>

				<section>
					<h2 className="m-0 text-2xl font-semibold tracking-tight">
						Anatomy-supported actions
					</h2>
					<ul>
						{anatomyActions.map(({ id, reason }) => (
							<li key={id}>
								<strong>{actionLabels[id] ?? id.replaceAll("-", " ")}</strong>
								{" - "}
								{reason}
							</li>
						))}
					</ul>
				</section>

				<section>
					<h2 className="m-0 text-2xl font-semibold tracking-tight">
						Official source
					</h2>
					<p>
						<a href={taxonomy.source.url}>World Register of Marine Species</a>
					</p>
					<p className="m-0 text-sm text-muted-foreground">
						{taxonomy.source.citation}
					</p>
				</section>
			</CardContent>
		</Card>
	)
}

export const LobsterDossierNotFoundPage = () => (
	<Card className="w-full">
		<CardHeader>
			<h1 className="m-0 text-2xl font-semibold tracking-tight">
				Lobster dossier not found
			</h1>
		</CardHeader>
		<CardContent>
			<p>
				No bundled lobster species matches that AphiaID. The taxonomy office
				has declined to invent one.
			</p>
		</CardContent>
	</Card>
)
