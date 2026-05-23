import { renderToStaticMarkup } from "react-dom/server"
import {
	createStaticHandler,
	createStaticRouter,
	StaticRouterProvider,
	type RouteObject
} from "react-router"
import { Layout } from "./components/Layout.js"
import { HomeRoute } from "./routes/home.js"
import { ResultRoute } from "./routes/result.js"

const document = (title: string, children: React.ReactNode) =>
	`<!doctype html>${renderToStaticMarkup(<Layout title={title}>{children}</Layout>)}`

export const renderPage = (title: string, children: React.ReactNode) =>
	document(title, children)

export const renderResultPage = (
	title: string,
	message: string,
	ok = true,
	action?: { href: string; label: string; description?: string }
) =>
	document(title, <ResultRoute title={title} message={message} ok={ok} action={action} />)

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
		document("OpenClaw Forms", <StaticRouterProvider router={router} context={context} hydrate={false} />),
		{ headers: { "content-type": "text/html; charset=utf-8" } }
	)
}

export { AuthGateRoute, FormRoute } from "./routes/form.js"
export { HomeRoute }
