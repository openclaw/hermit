import {
	createStaticHandler,
	createStaticRouter,
	StaticRouterProvider,
	type RouteObject
} from "react-router"
import { renderDocument } from "./document.js"
import { HomeRoute } from "./routes/home.js"
import { ResultRoute } from "./routes/result.js"

export const renderPage = (title: string, children: React.ReactNode) =>
	renderDocument(title, children)

export const renderResultPage = (
	title: string,
	message: string,
	ok = true,
	action?: { href: string; label: string; description?: string }
) =>
	renderDocument(
		title,
		<ResultRoute title={title} message={message} ok={ok} action={action} />
	)

export const routes: RouteObject[] = [
	{
		path: "/",
		Component: HomeRoute
	}
]

export const renderReactRouter = async (request: Request) => {
	const { query, dataRoutes } = createStaticHandler(routes)
	const context = await query(request)
	if (context instanceof Response) {
		return context
	}
	const router = createStaticRouter(dataRoutes, context)
	return new Response(
		renderDocument(
			"OpenClaw Forms",
			<StaticRouterProvider router={router} context={context} hydrate={false} />
		),
		{ headers: { "content-type": "text/html; charset=utf-8" } }
	)
}

export { AuthGateRoute, FormRoute } from "./routes/form.js"
export { HomeRoute }
