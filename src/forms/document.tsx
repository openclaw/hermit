import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Layout } from "./components/Layout.js"

export const renderDocument = (title: string, children: ReactNode) =>
	`<!doctype html>${renderToStaticMarkup(<Layout title={title}>{children}</Layout>)}`
