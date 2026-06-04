## MathML Intent Open Editor

A web app for open community curation (add / edit / remove) of the *Intent Open* concept list defined by [MathML 4 Intent](https://w3c.github.io/mathml-docs/intent/).

Use live at:

https://dginev.github.io/mathml-intent-open-editor/

## Tech stack

- **Frontend:** React 19 + Vite (static SPA on GitHub Pages); TanStack Table + TanStack Virtual for the
  virtualized 10k-row table; Temml for TeX→MathML; DOMPurify to sanitize rendered MathML.
- **Data:** the W3C `open.yml` dictionary, read straight from `raw.githubusercontent.com` and reconciled
  client-side (no DB). Edits open a pull request against [`dginev/mathml-intent-open`](https://github.com/dginev/mathml-intent-open).
- **Backend:** a small Fastify service (`service/`) on `latexml.rs` behind Caddy — GitHub-App OAuth +
  stateless JWT sessions; a bot account commits to a per-PR branch and opens/updates the PR.
- **Tooling:** TypeScript, ESLint, Vitest (unit) + Playwright (e2e); GitHub Actions for CI + the Pages deploy.