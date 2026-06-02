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

The canonical format is the **W3C MathML Intent `open.yml`** (`w3c/mathml-docs` `_data/open.yml`; the
backing repo `dginev/mathml-intent-open` mirrors it). **We do not change this schema** — changes need a
W3C group decision — so the parser/serializer conform to it and round-trip unknown fields. It's a single
`concepts:` group of `intents:` entries:

```yaml
concepts:
  - title: Open Concepts
    intents:
    - concept: abelian-category        # the name/slug
      arity: 0                          # argument count
      en: abelian category             # speech template; $1, $2… are positional arg refs
      property: symbol                  # notation form (symbol/indexed/prefix/function/…)
      area: "category theory"
      mathml:                           # one or more FULL <math>…</math> renderings
       - "<math><mi intent='abelian-category'>Ab</mi></math>"
      urls: ["…"]                       # reference URLs  (→ Concept.links)
      # optional: alias, notation/notationa…, comments
```

Mapping to `Concept` (`src/types.ts`): `concept→slug`, `urls→links`, plus `arity`/`property`; the
original entry is kept in `raw` for **lossless** serialization (preserves `notation*`/`comments`/key
order). `Concept.tex` (editor-authored TeX) **is persisted** as `tex:` when present (round-trips via
parse/serialize, and counts toward content identity) — a decision (per @dginev) to add this field to
the shared file rather than keep TeX local-only.

Key facts (verified against the real file, 1012 entries):
- A concept **name can be overloaded across arities** (`disjoint-union` 1&2, `whittaker-function` 2&3).
  `(concept, arity)` is globally **unique** and is the row identity — `conceptId(c)='${slug}#${arity}'`
  keys the reconcile map, edit cache, source index, and edits, so overloads never collapse.
- **Canonical order is `(concept, arity)`** — ASCII by name, then ascending arity (`byConcept`). The
  serializer emits this deterministically (`lineWidth:0`, lossless via `raw`); `canonical.test.ts` proves
  parse→serialize is lossless + idempotent. This is what keeps PR diffs minimal. The backing repo's
  `main` was canonicalized once (an "initial lint") so the first editor Save didn't reformat the whole
  file; with a canonical base, a single-concept edit is a one-line diff.
- `mathml` items are full `<math>…</math>` carrying `intent='…'`/`arg='…'`; the editor stores edits the
  same way (`<math>` + the `texToIntent` fragment).
- The editor does **not** keep a copy of the real list — it reads it from GitHub. `public/seed.fixture.yml`
  is a small *synthetic* fixture (dev/e2e only), cloned ×`DEV_MULTIPLIER` to hit the 10k-row target.

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

- `public/seed.fixture.yml` — a small synthetic dev/e2e fixture (served statically), **not** the real list.
- `src/types.ts` — the `Concept` type (our model; see "Data model").
- `src/data/parse.ts` — `parseDictionary(text)`: YAML `open.yml` → normalized `Concept[]` (shared by
  the seed loader and the raw reader).
- `src/data/loadSeed.ts` — fetches `public/seed.fixture.yml` and clones ×`multiplier` to hit the 10k target.
- `src/data/githubRaw.ts` — `rawUrl()` + `fetchDictionary()`: read `open.yml` from
  `raw.githubusercontent` (ACAO:* → no CORS), `404 → null`.
- `src/data/reconcile.ts` — `threeWayMerge(ancestor, ours, theirs)` over the slug-keyed map: adopt
  upstream where untouched, keep user edits, report same-slug divergences as conflicts.
- `src/data/editCache.ts` — persist the user's edits (value + `baseAtEdit` fork point) in
  `localStorage` so a reload restores in-progress changes; `baseAtEdit` is the per-concept ancestor.
- `src/data/loadDictionary.ts` — orchestrator: raw base (+ the active PR `branch` when one is tracked)
  ∪ local edits → `threeWayMerge` → `{ concepts, conflicts, base }`. `App` shows a conflict banner.
- `src/hooks/useDictionary.ts` — the **working set** as one `useReducer` over immutable state
  (`concepts` (all, canonical order, incl. held-for-display deletions), `loadedCount`, `baseMap`,
  `baseline`, `deletedIds`, `dirty`, `conflicts`). Load/paging/edit/add/delete-toggle/commit are pure
  transitions (`dirty` recomputed in the reducer); the edit cache is persisted as a derived effect. The
  hook loads from GitHub (active branch or `main`, reconciled with the cache) or the seed fixture; `App`
  handlers just `dispatch`. Paging reveals `concepts.slice(0, loadedCount)` (PAGE=50 ≈ a couple of
  viewports); `ConceptTable` calls `onLoadMore` near the bottom. **Filtering searches the whole
  dictionary**: a non-empty filter shows `concepts.filter(conceptMatches)` (slug/en/speech/area/alias)
  **unpaged**; clearing it resumes the paged prefix. Ctrl/⌘+F focuses the filter (native find can't see
  the virtualized rows).
- `src/components/ConceptTable.tsx` — headless TanStack Table + TanStack Virtual. DOM row windowing
  with absolute-positioned rows; it renders exactly the `data` it's given (filtering happens upstream in
  `App`). Notation column renders the stored MathML via `<MathML>`.
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
  notations and freshly converted TeX. Markup is **sanitized** (`render/sanitizeMathml.ts`, DOMPurify
  MathML profile + `intent`/`arg`) before `innerHTML`, since raw-MathML notations are user-authored and
  shared via `open.yml` — otherwise stored XSS.
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

## GitHub integration (`src/github/`)

**Users open their own PRs.** The browser holds the signed-in user's **GitHub access token** (classic
OAuth App, scope `public_repo`) and does the writing itself — fork → branch → commit → PR — directly
against `api.github.com` (CORS-enabled). Because the *user's* token pushes, the commit is authored by
them and earns real **contribution-graph credit** (the motivation: green squares need the commit's
author to also have forked/opened-the-PR — a bot can't satisfy that). The service exists only to hold the
OAuth client secret for the code→token exchange (`github.com/login/oauth/access_token` has no CORS).

- `auth.ts` — sign-in client: `buildAuthorizeUrl` (OAuth App, `scope=public_repo`), `parseCallback` +
  `parseCallbackError` (surfaces `?error=` returns), CSRF `state` helpers,
  `exchangeCodeForIdentity(serviceUrl, code)` → `{ handle, token }` (POSTs `/auth`), and identity
  storage (`save/load/clearIdentity`). `Identity = { handle, token }`. The token is long-lived (classic
  OAuth), so there's **no JWT/expiry/renew** — a session ends via sign-out or a 401 from GitHub.
- `userSubmit.ts` — the client-side writer (mirrors what the old bot did, now fork-aware):
  `submitViaFork({owner, repo, baseBranch, filePath, handle, token, content, branch, title, description,
  message})` → `ensureFork` (skipped when `handle === owner`; the maintainer pushes to the canonical repo
  directly) → branch off the **upstream** base SHA → `PUT contents` → open/patch the PR → `{ prNumber,
  prUrl, headOwner }`. Also `deleteBranch(...)` for the PR-close reset. Self-heals a stale (reused)
  branch with no open PR by dropping it first. Unit-tested with a fetch stub.
- `prSession.ts` — tracks the active PR (`localStorage`, `ActivePr = {number, url, branch, headOwner}`);
  `newBranchName` mints `<handle>-<YYYYMMDD>-<first-concept>`; `fetchPullState()` polls the PR's
  open/closed state via the **public** `api.github.com` (no token).
- `submission.ts` — `buildSubmission(...)` assembles `{content, branch, title, description, message}`
  from the working set (reused as-is by `App`).
- `config.ts` — `repoConfigFromEnv()` and `serviceConfigFromEnv()` (`VITE_GH_CLIENT_ID`,
  `VITE_GH_SERVICE`). Either null → graceful fallback (no repo → seed fixture; no service → local-only,
  ungated editing). See `.env.example`.

`App` flow: **sign in** (`/auth` → store `{handle, token}`) gates editing when a service is configured.
**Unique branch per PR:** reused while the PR is open (each Save = a new commit that updates it), a fresh
name once it closed/merged. The data load reconciles against the user's branch **in their fork**
(`loadDictionary({branch, branchOwner})`; `branchOwner = headOwner`, or `owner` for the maintainer).

**Session reset on PR close.** `App` polls the active PR (mount + window focus); when `closed` it
client-side `deleteBranch`es the fork branch, clears the edit cache, and reloads from `main` — so the
next edit starts a fresh branch with a minimal diff.

The service is in **`service/`** (Fastify, deployed on `latexml.rs` behind Caddy at
`https://intent-api.latexml.rs`) — now just `POST /auth` `{code}` → `{handle, token}` + `/health`. See
`service/README.md`.

### Architecture (confirmed with the user)

- **Users open their own PRs from their own forks**, with their own token — for GitHub contribution
  credit (a bot can't grant green squares). The maintainer (`handle === owner`) skips the fork and pushes
  to the canonical repo directly. PR **title** (`add: …; edit: …; by @handle`) + **Markdown body** are
  auto-generated from the change set in the "Describe your changes" Save modal (`pendingChanges.ts`).
- **Backend = a thin OAuth-exchange microservice** on the `latexml.rs` VM behind Caddy (CORS for the
  Pages origin). One endpoint: `/auth` (OAuth `code` → user token + handle). No JWT, no bot, no Git ops.
- **All GitHub writes are client-side** over `api.github.com` (`userSubmit.ts`): verified that
  `api.github.com` serves `ACAO: *` and allows the authenticated `POST`/`PUT`/`DELETE` preflight from a
  browser origin. Reads stay backend-free over `raw.githubusercontent.com` (base from `owner`, branch
  from the fork `headOwner`), with the same **three-way per-concept reconcile** (base ↔ fork branch ↔
  local cache).
- **Data repo = public `dginev/mathml-intent-open`**, single `open.yml` (fetched whole, rewritten whole).
- **TeX round-trip:** `Concept.tex` ↔ `tex:` in `open.yml` (re-edits reopen the source).
- **Hosting: app on GitHub Pages** (Actions deploy; `BASE_PATH=/<repo>/`).

**Status:** the replacement is built and unit/e2e-green (the old bot/JWT/`submit`/`reset`/`renew`
machinery is gone). **Remaining (external):** create a classic **OAuth App** (`public_repo`), set its
client id in `.env.production` (`VITE_GH_CLIENT_ID`) + its secret on the service, redeploy the slimmed
service, retire the old GitHub App, and do a live test with a *second* account — sign in → Save → PR
from their account → merge → confirm a green square on their contribution graph.
