# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**MathML Intent Open Editor** — a web app for open community curation (add / edit / remove) of
the *Intent Open* concept dictionary defined by [MathML 4 Intent](https://w3c.github.io/mathml-docs/intent/).
The spec lives at `~/git/mathml/src/intent.html` (sibling checkout). The canonical concept list to
seed/reference is in `~/git/mathml-intent-open/` (sibling checkout).

> **Status:** greenfield, about to be (re)built. Two throwaway spikes exist and should be ignored as
> architecture: a deprecated SvelteKit spike under `svelte-deprecated-experiment/` and an abandoned
> Create-React-App spike on the `react-ag-grid` branch. The stack was reconsidered from first principles
> (see "Chosen stack").

## Requirements (the actual spec for this project)

These are the product requirements, independent of framework choice:

1. **GitHub-file-backed data.** The concept dictionary is a file (YAML, like `open.yml`) living in a
   GitHub repository. That file is the source of truth — there is no separate database/backend.
2. **Lazy-loading table.** The main UI is a virtualized/lazy table expected to hold **>10,000 entries**.
   Performance at that row count (virtual scrolling, incremental load) is a hard requirement, not a nice-to-have.
3. **Specialized cell features**, including a **custom TeX → MathML renderer** for previewing notations.
4. **Edit → "Save" → Pull Request flow.** Saving an edit opens (or appends to) a GitHub **pull request**
   against the backing file.
5. **Anonymous, branch-tracked sessions.** Each local session tracks the user's working branch, which
   terminates in their PR. A user keeps editing after the PR is open; new edits auto-append onto that PR.
   When the PR merges, the frontend starts a fresh branch. No accounts — sessions are anonymous (auth is
   GitHub OAuth/PKCE only, for opening PRs on the user's behalf).

## Data model

We **own the data model** — `open.yml` is the *seed/reference* shape, not a fixed contract. Extend or
restructure it freely when the current shape hits a dead end (e.g. richer notation metadata, per-language
speech, provenance for the PR/curation workflow). Keep an importer from the seed format, and document any
schema change here.

The seed format is `open.yml` in `~/git/mathml-intent-open/` (~10.6k lines today). It is a YAML
map keyed by **concept slug** (kebab-case). Each entry:

```yaml
additive-inverse:
  en: additive inverse of $_1        # speech template; $_1, $_2… are positional argument refs
  area: abstract algebra             # subject area (may be empty)
  mathml:                            # one or more example renderings, as MathML strings
   - "<mrow intent='additive-inverse($_1)'><mo>-</mo><mi arg='_1'>n</mi></mrow>"
  links:                             # reference URLs
   - "https://en.wikipedia.org/wiki/Additive_inverse"
  alias:                             # alternate names/slugs
   - opposite
   - negation
```

Notes for working with the data:
- `mathml` strings carry `intent='…'` on the root and `arg='_N'` on argument leaves — this is the MathML
  Intent annotation the spec defines. The TeX→MathML renderer must produce/round-trip these.
- Other reference shapes exist and are **not** the target format: `intent_open.yml` is an older
  notation/speech-chunk template; `intent_open_seed.json` / `open.yml`-derived JSON use `subject` / `form` /
  `sources` / `notation` keys. Treat `open.yml` as canonical.
- `grow.pl` in the reference repo multiplies every concept ×50 into `large_open.yml` — use it to generate
  realistic >10k-row fixtures for testing table performance.

## Chosen stack

Reasoned from the requirements (static SPA, no backend; 10k+ rows with custom DOM cells; browser-side
GitHub OAuth; TeX→MathML). The framework matters little; the grid library matters a lot, and custom
MathML cells rule out canvas grids — so a headless, DOM-virtualized table won.

- **React 19 + Vite** — static SPA build (no SSR; the data lives in GitHub, not a server).
- **@tanstack/react-table + @tanstack/react-virtual** — headless table with DOM windowing. React is
  TanStack's reference adapter (the deprecated spike used the *community* Svelte 5 port). Each cell is a
  real component, so MathML rendering and inline editors are straightforward.
- **Octokit** — GitHub OAuth (PKCE), branch management, and PR create/append.
- **TeX→MathML** — **Temml**, via our fork at `~/git/Temml` (dep: `"temml": "file:../Temml"`). The fork
  adds native MathML-Intent commands (`\intent`/`\arg` + official `\MathMLintent`/`\MathMLarg` aliases);
  see "MathML Intent rendering" below. Synchronous and MathML-native — the right fit for rendering in 10k
  virtualized cells where MathJax's async typesetting would be a liability.

Rationale for the rejected paths: SvelteKit's SSR/server layer is dead weight with no backend and its
TanStack table binding is community-maintained; AG Grid is heavier and its custom-cell API is more
constraining than headless TanStack for MathML cells.

## Commands

The root is a Vite + React-TS project. From the repo root:

```bash
npm install
npm run dev            # vite dev server (http://localhost:5173)
npm run build          # tsc -b type-check + vite build → dist/
npm run preview        # serve the production build (http://localhost:4173)
npm run lint           # eslint (ignores svelte-deprecated-experiment/)
npm test               # vitest run (unit/jsdom) then playwright (e2e)
npm run test:unit      # vitest in watch mode
npm run test:unit -- src/data/loadSeed.test.ts   # single unit file
npm run test:e2e       # playwright e2e (auto-builds + previews)
npx playwright test e2e/paging.spec.ts           # single e2e file
```

### Testing & TDD

Work **red→green**: write the failing test first, watch it fail for the right reason, then implement.

- **Unit/component** — Vitest + jsdom + Testing Library. Tests live next to source as `*.test.ts(x)`
  under `src/`; setup is `src/test/setup.ts`; config is the `test` block in `vite.config.ts`.
- **E2E** — Playwright in `e2e/`, run against the production build (`vite preview` on :4173).
  `e2e/paging.spec.ts` asserts the full 10k+ row list is reachable by paging to exhaustion within
  60s with no page errors (currently ~16s). Keep it green — it's the guard for table performance.
- **Browser gotcha:** Playwright's bundled Chromium has no build for this OS, so the config uses the
  system Google Chrome via `channel: 'chrome'`. Don't switch it back to bundled chromium here.

## App structure (root)

**Data source is dual** (chosen in `App`'s load effect): when `repoConfigFromEnv()` is set
(`VITE_GH_OWNER`/`REPO`), the live path reads `open.yml` from GitHub (raw CDN) and reconciles
client-side; otherwise (dev/e2e) it falls back to the seed ×`DEV_MULTIPLIER` so the 10k-row perf guard
runs without a backend. So **don't remove the seed path** — the perf e2e depends on it.

- `public/open.yml` — the seed dictionary (dev/e2e fixture, served statically).
- `src/types.ts` — the `Concept` type (our model; see "Data model").
- `src/data/parse.ts` — `parseDictionary(text)`: YAML `open.yml` → normalized `Concept[]` (shared by
  the seed loader and the raw reader).
- `src/data/loadSeed.ts` — fetches `public/open.yml` and clones ×`multiplier` to hit the 10k target.
- `src/data/githubRaw.ts` — `rawUrl()` + `fetchDictionary()`: read `open.yml` from
  `raw.githubusercontent` (ACAO:* → no CORS), `404 → null`.
- `src/data/reconcile.ts` — `threeWayMerge(ancestor, ours, theirs)` over the slug-keyed map: adopt
  upstream where untouched, keep user edits, report same-slug divergences as conflicts.
- `src/data/editCache.ts` — persist the user's edits (value + `baseAtEdit` fork point) in
  `localStorage` so a reload restores in-progress changes; `baseAtEdit` is the per-concept ancestor.
- `src/data/loadDictionary.ts` — orchestrator: raw base (+ `intent/<handle>` branch when a handle
  exists) ∪ local edits → `threeWayMerge` → `{ concepts, conflicts }`. `App` shows a conflict banner.
- `src/data/source.ts` — `ConceptSource`: paged, **on-demand** access (`fetchRange(start,end)`, `total`,
  `applyEdit`, `serialize`). The UI knows `total` up front but pages rows in (PAGE=50 ≈ a couple of
  viewports) as the user scrolls — `App` grows a loaded prefix and `ConceptTable` calls `onLoadMore`
  near the loaded bottom. `createSeedSource` parses the seed once then slices on demand (the seed is one
  file; a real backend would range-fetch over the network — same interface). Filtering currently acts
  on loaded rows only (known infinite-scroll limitation; ergonomics later).
- `src/components/ConceptTable.tsx` — headless TanStack Table + TanStack Virtual. DOM row windowing
  with absolute-positioned rows; global filter across slug/en/area/alias. Notation column renders the
  stored MathML via `<MathML>`.
- `src/render/temmlEngine.ts` — loads Temml. **Must stay this way:** it imports the prebuilt
  `temml/dist/temml.mjs?url` and `import()`s that URL so Vite emits Temml **untransformed**. Temml
  registers its ~80 commands by mutating a module-level `const _functions = {}` at import time; when
  Vite/rolldown re-bundles the library it mishandles that mutated const and the command table ends up
  empty at runtime (every command → "Unsupported function name", *non-deterministically* per build).
  Loading it as an asset sidesteps the bundler. `loadTemml()` is async + cached.
- `src/render/intent.ts` — `texToIntent(temml, tex, concept)`: TeX → **annotated dictionary fragment**
  (takes the engine so it stays pure/sync/node-testable). Unwraps `<math>`, defaults the root `intent`
  to the concept (auto-composed from `\arg` names when no explicit `\intent`), strips cosmetic classes.
  Returns `{ ok, mathml, arity }`. See "MathML Intent rendering".
- `src/render/texToMathml.ts` — older raw `texToMathML(tex)` seam (`<math>`-wrapped). Not on the app
  path anymore (only its own node test uses it); kept for reference.
- `src/components/MathML.tsx` — renders a MathML string natively; wraps bare fragments in `<math>`
  (both seed notations and `texToIntent` output are fragment-only). One render path for stored
  notations and freshly converted TeX.
- `src/components/NotationEditor.tsx` — inline TeX editor: loads Temml (async, via `temmlEngine`),
  live-previews the annotated MathML, Save emits the dictionary fragment. Lazy-loaded from `App.tsx`.
- `src/App.tsx` — shell: loads the seed, filter input, table; row click opens the editor; Save persists
  into local state (the PR-backing of saves is the next milestone).

## MathML Intent rendering

Curators author notations in TeX with native commands provided by the Temml fork:
- `\arg{name}{tex}` → `arg="name"` on the body's element. Names must be **valid NCNames** — they
  cannot start with a digit, so use alphabetic names (`\arg{x}{n}`), **not** positional numbers
  (`\arg{1}` is spec-invalid) and not underscore-prefixed (`\arg{_1}`).
- `\intent{expr}{tex}` → `intent="expr"` on the body's element. Argument references in `expr` use the
  `$` sigil (part of the MathML intent reference syntax): `\intent{additive-inverse($x)}{…}`.
- Official LaTeX aliases (latex3/latex2e#1836, signature `{value}{body}`): `\MathMLintent`/`\MMLintent`
  and `\MathMLarg`/`\MMLarg`.

`texToIntent` auto-composes the root intent as `concept($a,$b,…)` from the `\arg` names when the author
didn't write an explicit `\intent`; an explicit `\intent` always wins. (Authoring ergonomics are a
later-phase concern — skeleton/wiring first.) The fork repurposes `\arg` (was
the complex-argument operator) — use `\operatorname{arg}` for that. Rebuild the fork after editing it:
`cd ~/git/Temml && npx rollup -c utils/rollupConfig.mjs && node utils/insertPlugins.js && node utils/copyfiles.js`
then in the app `npm install temml@file:../Temml` (npm caches `file:` deps — bump the fork version or
force-reinstall, do **not** symlink: Vite-following a symlink can load Temml twice).

## GitHub backing (`src/github/`)

- `session.ts` — anonymous, branch-tracked session (persisted in `localStorage`): a session owns
  `intent/<id>` (branch), the first edit opens a PR, later edits push onto the same branch, and
  `rotateAfterMerge` moves to `intent/<id>-2` after the PR merges. Pure + unit-tested.
- `submit.ts` — orchestration: `submitEdit` (commit → open PR on first edit / reuse on later) and
  `refreshSession` (rotate when the tracked PR merged). Unit-tested against a mock backend.
- `repo.ts` — `RepoBackend` interface + `RepoConfig`. `octokitBackend.ts` — Octokit implementation.
- `auth.ts` — client side of GitHub OAuth: `buildAuthorizeUrl`, `parseCallback`, CSRF `state`
  remember/consume, `exchangeCodeForToken` (POSTs to the proxy), token storage. Unit-tested.
- `config.ts` — env: `VITE_GH_OWNER`/`VITE_GH_REPO`/`VITE_GH_BASE`/`VITE_GH_FILE`, dev `VITE_GH_TOKEN`,
  and OAuth `VITE_GH_CLIENT_ID`/`VITE_GH_OAUTH_PROXY`/`VITE_GH_SCOPE`. Each `*FromEnv()` returns null
  when unset → app degrades to local-only (so tests/preview run without GitHub).
- `src/data/serialize.ts` — concepts → seed `open.yml` (inverse of `loadSeed`); used to build PR content.

`App` loads/persists the session, builds the backend from env, and on Save commits + opens/updates the
PR when configured. Dev uses `VITE_GH_TOKEN`.

### Architecture (confirmed with the user — target design)

The earlier "user opens the PR with their own token" model was replaced. The agreed design:

- **Identity is a prerequisite to edit.** Sign-in resolves the contributor's GitHub `@handle` before
  any editing is possible. Identity is used for attribution, *not* for pushing.
- **Bot opens the PRs via a single GitHub App.** One GitHub App does both: user-to-server OAuth (to
  read the `@handle`) and an installation token (to commit as our controlled account). Attribution is a
  "Proposed by @handle" line in the **PR body** (bot is the commit author).
- **Backend = a Node/Fastify microservice on the `latexml.rs` VM**, behind the VM's existing **Caddy**
  (auto-HTTPS + CORS for the Pages origin). Stateless **JWT** sessions (no session store). Endpoints:
  `/auth` (OAuth code → verified handle → JWT) and `/submit` (verify JWT → bot commits to
  `intent/<handle>` → ensure PR). Node still needs installing on the VM.
- **Reads are backend-free.** The client fetches `open.yml` from `raw.githubusercontent.com` for both
  `main` (base) and the user's `intent/<handle>` branch (raw serves `ACAO: *`, so no CORS issue), plus
  a `localStorage` cache of the last save (covers raw's ~5-min CDN lag). On load it does a **three-way,
  per-concept reconcile** (base ↔ branch ↔ local) over the slug-keyed map — same-slug changes on both
  sides surface as conflicts.
- **Data repo = public `dginev/mathml-intent-open`**, **single `open.yml`** (fetched whole, rendered
  lazily, rewritten whole). Revisit splitting if conflicts become real.
- **TeX round-trip: store both, MathML canonical.** Implemented — `Concept.tex` holds the primary
  notation's source so re-edits reopen it; seed entries lack `tex` and re-author from blank.
- **Hosting: app on GitHub Pages** (Actions deploy; `BASE_PATH=/<repo>/`).

**Status:** the current `src/github/` (session/submit/repo/octokitBackend/auth) implements the *old*
browser-pushes-with-user-token model and is being migrated to the above — much of the commit/PR logic
moves into the Fastify service (it can reuse `submit.ts`/`session.ts`/`repo.ts` ideas with the bot
token). `auth.fetchHandle` and the OAuth client helpers carry over. Not yet built: the Fastify service,
the raw-read + reconcile data layer, the identity edit-gate, and the Pages deploy workflow.
