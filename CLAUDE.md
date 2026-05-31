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

## GitHub integration (`src/github/`)

The browser holds **no** GitHub token. It signs the user in (to get a `@handle`) and sends edits to the
service; the **bot** (in `service/`) does all the writing. The old browser-push modules
(`session.ts`/`submit.ts`/`repo.ts`/`octokitBackend.ts`) were removed — that logic now lives server-side
in `service/src/github.js`.

- `auth.ts` — sign-in client: `buildAuthorizeUrl` (GitHub App user OAuth, no scope), `parseCallback`,
  CSRF `state` helpers, `exchangeCodeForIdentity(serviceUrl, code)` → `{ handle, jwt }` (POSTs
  `/auth`), `renewIdentity(serviceUrl, jwt)` (POSTs `/renew` for the sliding session), and identity
  storage (`save/load/clearIdentity`). The session JWT is a sliding **7-day** TTL: `loadIdentity` reads
  the JWT `exp` and treats an expired token as signed-out (`isExpired`/`secondsUntilExpiry`); `App`
  auto-signs-out at expiry and renews on a visit once the token has aged past its first day. Unit-tested.
- `submitClient.ts` — `submitToService(serviceUrl, jwt, { content, message })` → POSTs `/submit`
  (Bearer JWT) → `{ prNumber, prUrl }`; `resetSession(serviceUrl, jwt)` → POSTs `/reset` to delete the
  caller's branch. Unit-tested.
- `prSession.ts` — tracks the active PR (`localStorage`) and `fetchPullState()` polls its open/closed
  state via the **public** `api.github.com` (plain `fetch`, no token — see [client GitHub access]).
- `config.ts` — `repoConfigFromEnv()` (`VITE_GH_OWNER`/`REPO`/`BASE`/`FILE`) and
  `serviceConfigFromEnv()` (`VITE_GH_CLIENT_ID`, `VITE_GH_SERVICE`). Either returns null → graceful
  fallback (no repo → seed fixture; no service → local-only, ungated editing). See `.env.example`.
- `src/data/serialize.ts` — concepts → `open.yml` (the content sent to `/submit`).

`App` flow: **sign in** (`/auth` → store `{handle, jwt}`) gates editing when a service is configured;
**Save** → `submitToService` (bot commits to `intent/<handle>` + opens/updates the PR) and opens the PR
link. Signing in reloads the dictionary with the user's branch (`handle` dep on the load effect).

**Session reset on PR close.** The user's branch terminates in a PR; when that PR is closed or merged
the session must end. `App` tracks the active PR and, on mount + window focus, polls its state
(`fetchPullState`); if it's `closed` (merged counts), it calls `/reset` (bot deletes `intent/<handle>`),
clears the local edit cache, and reloads from `main` — so the next edit starts a fresh branch with a
minimal diff. `/submit` also self-heals: if the branch has no open PR it drops the stale branch before
committing (lazy cleanup if `/reset` was missed).

The service itself is in **`service/`** (Fastify, deployed on `latexml.rs` behind Caddy at
`https://intent-api.latexml.rs`) — see `service/README.md`.

### Architecture (confirmed with the user — target design)

The earlier "user opens the PR with their own token" model was replaced. The agreed design:

- **Identity is a prerequisite to edit.** Sign-in resolves the contributor's GitHub `@handle` before
  any editing is possible. Identity is used for attribution, *not* for pushing.
- **Bot opens the PRs via a single GitHub App.** One GitHub App does both: user-to-server OAuth (to
  read the `@handle`) and an installation token (to commit as our controlled account). The PR **title**
  (`add: …; edit: …; by @handle`) and **Markdown description** are auto-generated client-side from the
  change set in the "Describe your changes" Save modal (`prTitle`/`markdownChangeSummary` in
  `pendingChanges.ts`) and sent to `/submit`; the bot appends a "Proposed by @handle" attribution footer
  to the body (bot is the commit author).
- **Backend = a Node/Fastify microservice on the `latexml.rs` VM**, behind the VM's existing **Caddy**
  (auto-HTTPS + CORS for the Pages origin). Stateless **JWT** sessions (no session store), a sliding
  **7-day** TTL. Endpoints: `/auth` (OAuth code → verified handle → JWT), `/renew` (verify a valid JWT →
  re-issue a fresh-TTL one), `/reset` (verify JWT → bot deletes `intent/<handle>`),
  and `/submit` (verify JWT → bot commits to
  `intent/<handle>` → ensure PR). **Deployed and verified** at `https://intent-api.latexml.rs`.
- **Reads are backend-free.** The client fetches `open.yml` from `raw.githubusercontent.com` for both
  `main` (base) and the user's `intent/<handle>` branch (raw serves `ACAO: *`, so no CORS issue), plus
  a `localStorage` cache of the last save (covers raw's ~5-min CDN lag). On load it does a **three-way,
  per-concept reconcile** (base ↔ branch ↔ local) over the slug-keyed map — same-slug changes on both
  sides surface as conflicts.
- **Data repo = public `dginev/mathml-intent-open`**, **single `open.yml`** (fetched whole, rendered
  lazily, rewritten whole). Revisit splitting if conflicts become real.
- **TeX round-trip: store both, MathML canonical.** `Concept.tex` holds the primary notation's source;
  it is **written to `open.yml` as `tex:`** (when present) and read back, so re-edits reopen it. Seed
  entries lack `tex` and re-author from blank.
- **Hosting: app on GitHub Pages** (Actions deploy; `BASE_PATH=/<repo>/`).

**Status:** built and wired end-to-end — raw-read + three-way reconcile data layer, the Fastify service
(deployed on `latexml.rs`), the identity edit-gate, sign-in → `/auth`, and Save → `/submit`. The
browser-push modules were removed. **Remaining:** the GitHub Pages deploy workflow (set the
`VITE_GH_*` env at build), and an end-to-end live test of a real sign-in + PR. The three-way reconcile
becomes fully exercised once users have `intent/<handle>` branches.
