// @ts-check
import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"
import starlightLinksValidator from "starlight-links-validator"
import { cliBridge, cliSrc } from "./cli-bridge.mjs"

const repo = "https://github.com/nata-t/klin"

/**
 * Code blocks in the CLI's grayscale: every theme color becomes the gray of the same luminance.
 * @param {string} color
 */
const toGray = (color) => {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color ?? "")
  if (!match) return color
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16))
  const level = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b).toString(16).padStart(2, "0")
  return `#${level}${level}${level}${match[2] ?? ""}`
}

export default defineConfig({
  devToolbar: { enabled: false },
  // TODO: set `site` to the real domain once it's picked (canonical URLs, sitemap, social cards).
  integrations: [
    starlight({
      title: "klin",
      description: "A spotless full-stack TypeScript starter: one command for an API, a web app, auth, a database and the Zod schemas they share.",
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: repo }],
      editLink: { baseUrl: `${repo}/edit/master/website/` },
      lastUpdated: false,
      customCss: ["@fontsource-variable/geist", "@fontsource-variable/geist-mono", "./src/styles/docs.css"],
      components: {
        SiteTitle: "./src/components/docs/SiteTitle.astro",
      },
      expressiveCode: {
        themes: ["min-dark", "min-light"],
        customizeTheme: (theme) => {
          for (const rule of theme.settings) {
            if (rule.settings?.foreground) rule.settings.foreground = toGray(rule.settings.foreground)
          }
          for (const key of Object.keys(theme.colors)) theme.colors[key] = toGray(theme.colors[key])
          return theme
        },
        styleOverrides: {
          borderRadius: "6px",
          borderColor: "var(--sl-color-hairline)",
          codeFontFamily: "'Geist Mono Variable', ui-monospace, monospace",
          uiFontFamily: "'Geist Mono Variable', ui-monospace, monospace",
          frames: { shadowColor: "transparent" },
        },
      },
      // The landing page (/) is a custom page the validator can't see into, so its anchors are listed here.
      plugins: [starlightLinksValidator({ exclude: ["/", "/#wizard", "/#schema", "/#kit", "/#grow"] })],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "docs" },
            { label: "Getting started", slug: "docs/getting-started" },
          ],
        },
        {
          label: "Create a project",
          items: [
            { label: "The wizard", slug: "docs/create/wizard" },
            { label: "Presets", slug: "docs/create/presets" },
            { label: "Choosing your stack", slug: "docs/create/choosing-your-stack" },
          ],
        },
        {
          label: "Your project",
          items: [
            { label: "Layout", slug: "docs/project/layout" },
            { label: "One schema everywhere", slug: "docs/project/shared-schemas" },
            { label: "Scripts", slug: "docs/project/scripts" },
            { label: "Environment", slug: "docs/project/environment" },
            { label: "Deploying", slug: "docs/project/deploying" },
          ],
        },
        {
          label: "Grow it",
          items: [
            { label: "klin generate", slug: "docs/grow/generate" },
            { label: "klin add & remove", slug: "docs/grow/add-remove" },
            { label: "klin doctor", slug: "docs/grow/doctor" },
            { label: "klin upgrade", slug: "docs/grow/upgrade" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI", slug: "docs/reference/cli" },
            { label: "Options & modules", slug: "docs/reference/options" },
            { label: "klin.json", slug: "docs/reference/klin-json" },
            { label: "Custom templates", slug: "docs/reference/custom-templates" },
          ],
        },
        {
          label: "Help",
          items: [
            { label: "Troubleshooting", slug: "docs/troubleshooting" },
            { label: "Changelog", slug: "docs/changelog" },
          ],
        },
      ],
    }),
  ],
  vite: {
    plugins: [cliBridge()],
    resolve: { alias: { "@cli": cliSrc } },
  },
})
