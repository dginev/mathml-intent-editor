# W3C Feedback Round 2 — Implementation Plan

Source: `w3c_feedback.md` (W3C meeting, 2026-06-04). Decisions below were clarified with @dginev.
Suggested branch: `w3c-feedback-round2`. Work test-first (red→green) per project convention.

---

## Phase 0 — Repo rename follow-through (urgent: the deployed site is broken)

The GitHub repo was renamed `mathml-intent-editor` → **`mathml-intent-open-editor`** (resolves
feedback item "add 'open' to the name"). GitHub Pages now serves the site under the **new** path, but
the last-deployed HTML references assets under `/mathml-intent-editor/` — so the live site is broken
until a redeploy with the corrected base.

- [ ] `.github/workflows/deploy.yml` — `BASE_PATH: /mathml-intent-open-editor/`
- [ ] `README.md` — live URL → `https://dginev.github.io/mathml-intent-open-editor/`
- [ ] `package.json` `name` → `mathml-intent-open-editor` (+ regenerate lock: `npm install --package-lock-only`)
- [ ] local remote: `git remote set-url origin git@github.com:dginev/mathml-intent-open-editor.git`
- [ ] **@dginev, out-of-band:** update the GitHub App's **OAuth callback URL** to
      `https://dginev.github.io/mathml-intent-open-editor/` (Pages project paths do **not** redirect
      after a rename; sign-in would land on a 404). Keep the `http://localhost:5173/` callback.
- [ ] No service change needed: Caddy CORS is origin-scoped (`https://dginev.github.io`) — unchanged.
- [ ] Push `main` after Phase 0 (triggers the Pages redeploy — that's the point here).

The in-app name needs nothing: `<title>` and the `<h1>` already say "MathML Intent Open Editor".

## Phase 1 — WCAG row marking: high-contrast colors, borders, status icon

Feedback: *high contrast red for delete, saturated green for added, borders for WCAG 2.0, info icon
on the left for edited/added/deleted.* The icon + border satisfy WCAG 1.4.1 (don't convey state by
color alone); stronger tints + borders fix the contrast complaint.

- [ ] `src/index.css` — re-tune `--diff-add-bg` / `--diff-del-bg` / `--diff-changed-bg` in **both**
      themes toward saturated GitHub-diff hues, and add accent variables for borders/icons:
      `--diff-add-accent` (≈ `#1a7f37` light / `#3fb950` dark), `--diff-del-accent`
      (≈ `#cf222e` / `#f85149`), `--diff-changed-accent` (≈ `#8250df` / `#a371f7`).
- [ ] `src/App.css` — `.row-added/.row-changed/.row-deleted`: a strong left border stripe
      (e.g. `box-shadow: inset 4px 0 0 var(--diff-*-accent)`) + a subtle full-row border, keeping text
      contrast ≥ 4.5:1 over the tinted background.
- [ ] `src/components/ConceptTable.tsx` — new **leading status column** (display column, ~36px): icon
      per `ChangeKind` — `+` added / `✎` changed / `−` deleted — colored with the accent var, with
      `title` + `aria-label` (`"added"`, `"edited"`, `"pending deletion"`). Empty for unchanged rows.
      Reads `changeKind` via the existing `meta` pattern.
- [ ] **Table ARIA semantics** (the substantive WCAG gap — the div-grid currently has *no* roles):
      `role="table"` on the scroll container's inner table, `role="row"` / `role="columnheader"` /
      `role="cell"` on the div rows/cells, `aria-rowcount` = total concepts on the table,
      `aria-rowindex` on each virtualized row (so screen readers know rows are windowed).
- [ ] **Contrast verification** as an explicit acceptance step, both themes: text over tinted rows
      ≥ 4.5:1 (WCAG 1.4.3) **and** the accent borders/icons ≥ 3:1 against adjacent background
      (WCAG 1.4.11 non-text contrast). Compute the ratios; adjust the hues if any fail.
- [ ] `src/components/ui.tsx` — **error toasts persist until dismissed** (`duration = 0` when
      `kind === 'error'`; info toasts keep the 12s auto-dismiss).
- [ ] Tests first: ConceptTable component test — rows classified added/changed/deleted render the icon
      with the right accessible name; unchanged rows render none; the table exposes `role="table"`,
      rows carry `aria-rowindex`. Toast test: error kind has no auto-dismiss timer.
- [ ] Guard: `npx playwright test e2e/paging.spec.ts` (extra cell + ARIA attrs per row must not hurt
      the 10k guard).

## Phase 2 — Cap the generated PR title

Feedback: *cap the title at a certain length to avoid overflow.* Clarified: the **generated PR title**
(`add: …; edit: …; by @handle`). `capNames` already caps at 8 names but long concept names still
overflow the Save modal and GitHub's UI.

- [ ] `src/data/pendingChanges.ts::prTitle` — hard cap the full title at **72 chars**: truncate the
      change-summary portion with `…` (at a name boundary where possible) while always keeping the
      trailing `by @handle` intact.
- [ ] `src/App.css` — `.save-title`: `overflow-wrap: anywhere` as a belt-and-braces display fix.
- [ ] Tests first: extend the `prTitle` unit tests — long names → ≤ 72 chars, suffix preserved, short
      titles unchanged.

## Phase 3 — Speech column: language dropdown

Feedback: *convert the thead for language(en) to a dropdown for language select.* Decisions: the
dropdown lists **only languages present in the dictionary** (today: `en` + `bg`); a row lacking the
selected language **falls back to its English template, visually muted** — the column never goes blank.

- [ ] `src/App.tsx` — compute `languages` (= `en` + every `speech[].lang` seen, en first, then sorted)
      from the full `concepts`; own `speechLang` state (default `en`); pass both + the setter to
      `ConceptTable`. Hydrate from and reflect into **`?lang=`** exactly like `?filter=`
      (shareable deep link; replaceState, preserve other params).
- [ ] `src/components/ConceptTable.tsx` — the Speech column becomes a **display column**; its header
      renders a `<select>` (`en — English`, `bg — Bulgarian`, … via `iso-639-1`) with
      `aria-label="Speech language"` (the visual label *is* the column header), stopping click
      propagation; the cell shows the selected language's template with a **`lang` attribute** on the
      text (screen-reader pronunciation), else `c.en` with a `speech-fallback` class (muted/italic)
      **plus** `lang="en"` and a `title` ("no Bulgarian template — showing English") so the fallback
      isn't signalled by color alone. **When only one language exists in the data** (the seed/e2e
      path: just `en`), render the plain header — no dead one-option control.
- [ ] `src/App.css` — header select styling + `.speech-fallback`.
- [ ] Tests first: component tests — dropdown options derive from data; switching shows the `bg`
      template where present (with `lang="bg"`); fallback rows show muted English with the title;
      single-language data renders no select; `?lang=bg` hydrates the selection.
- [ ] Note: the filter already searches all languages (`conceptMatches` covers `speech`) — unchanged.

## Phase 4 — Additional notations: full-line source + two-panel preview, TeX authoring

Feedback: *make rendering be on a full line so that rendering matches on the left panel.* Clarified
layout per **each** additional notation, identical to the primary's:

```
line 1:  [ mode toggle: TeX | Raw MathML ]   [source textarea, full width]   ✕
line 2:  ┌─ Rendered ───────────┐ ┌─ MathML source (simplified) ─┐
```

Decisions: extras get the **full TeX/Raw toggle** (TeX with `\arg`/`\intent`, root intent defaulting
to the concept, minified at save — same pipeline as the primary), and their TeX source **is
persisted** via a **restructured schema**: a **`notations:`** (plural) key — always a **list**, one
entry per rendering, each an inner hash of two keys: `tex:` (optional) and `mathml:` (mandatory).
The user authors one *or* the other; we always store the MathML — the pairing makes that explicit
instead of index-correlating two parallel lists, and the list naturally accommodates additional notations.

```yaml
# single rendering:
- concept: abelian-category
  arity: 0
  en: abelian category
  notations:
    - tex: "\\mathrm{Ab}"
      mathml: "<mi intent='abelian-category'>Ab</mi>"
  urls: […]

# multiple renderings:
- concept: power
  notations:
    - tex: "\\arg{b}{x}^{\\arg{e}{n}}"
      mathml: "<msup intent='power($b,$e)'>…</msup>"
    - mathml: "<mrow>…</mrow>"   # raw-MathML-authored extra: no tex
```

This **replaces** `mathml:` (+ the scalar `tex:`) via a **one-time whole-file migration** — like the
original canonical lint. The plural name avoids the legacy keys entirely: the 16 free-text
`notation:` sketches (e.g. `notation: sigma (n) / n`) and the `notationa:`/`notationb:` variants
don't collide and keep round-tripping untouched in `raw` — no rename needed. A W3C-shared-format
change to socialize with the group; the w3c/mathml-docs tooling that reads `mathml:` must adapt
before upstreaming.

Schema ripple (the four sites that must stay in sync, per `serialize.ts`'s docstring):

- [ ] `src/types.ts` — replace `mathml: string[]` + `tex?: string` with
      `notations: { mathml: string; tex?: string }[]` (`notations[0]` = primary).
- [ ] `src/data/parse.ts` — read **both** shapes: new `notations:` list-of-hashes, and the old
      `mathml:` list + scalar `tex:` (→ tex pairs onto the first entry). Old branches, the W3C
      upstream file, and the seed fixture stay loadable. The legacy free-text `notation*` keys are
      unrelated and keep round-tripping via `raw`.
- [ ] `src/data/serialize.ts` — emit **only** the new shape: `notations:` list of hashes, `tex:`
      first (when present) then `mathml:`; drop `mathml:`/`tex:` keys from `raw` on write so a
      migrated entry doesn't carry both.
- [ ] `src/data/reconcile.ts::contentKey` — key on the notations list (mathml + tex per entry).
- [ ] Tests first: parse both shapes → identical `Concept`; serialize emits the new shape;
      `canonical.test.ts` becomes: old-shape file → new-shape output is **stable** (idempotent:
      parse→serialize→parse→serialize fixes), and a new-shape file round-trips **losslessly**.

**Migration commit (data repo, coordinated):**

- [ ] Generate the migrated `open.yml` **with our own parse→serialize pipeline** (a small script), so
      the file is byte-identical to what the editor would emit — the first post-migration Save is a
      minimal diff, exactly like the original lint.
- [ ] Land it in `dginev/mathml-intent-open` **together with** deploying the new editor (parser reads
      both shapes, so order is forgiving, but open PR branches from the old shape will conflict —
      merge or close them first). Check whether `intent_open.json` in that repo is generated from
      `open.yml` and needs regenerating.
- [ ] `public/seed.fixture.yml` — migrate to the new shape (it's the canonical example).

Consumers of `c.mathml` / `c.tex`:

- [ ] `src/render/notationMarkup.ts` + `src/components/ConceptTable.tsx::needsEngine` — use
      `notations[0]` (the table shows only the primary rendering; engine needed iff `notations[0].tex`).
- [ ] `src/components/NotationEditor.tsx` — the main work:
      - Extract the primary's structure (mode toggle → full-width source → `.previews` two-panel row)
        into a reusable block, and render each extra notation with it.
      - Extra row state: `{ id, mode, tex, mathml }`; initial mode `tex` when
        `concept.notations[i+1].tex` is present, else `mathml`.
      - TeX extras render via `texToIntent(engine, tex, slug)`; their "MathML source (simplified)"
        panel shows `minifyMathml(...)`; raw extras stay verbatim. Errors block save, and each block
        gets its **own inline error slot** (a single shared error line can't locate which of N
        sources is broken).
      - `buildUpdated`: `notations = [{ tex?: primaryTex, mathml: primary }, ...extras]` — each extra
        a `{tex?, mathml}` hash (no `tex` key for raw-authored ones).
      - **Dirty-guard on dismissal**: backdrop-click / Esc with unsaved edits asks "Discard changes?"
        instead of silently dropping them (modal work only lands in the working set on "Done"; the
        taller editor raises the accidental-dismissal risk).
      - **Sticky action bar**: Done/Cancel pinned to the modal's bottom edge while the body scrolls;
        the destructive **Delete** moves spatially away from Done/Cancel (opposite side).
- [ ] `src/App.css` — restructure `.notation-row` into the stacked block; both panels keep
      `overflow: visible` (modal's outer scroll navigates — established rule); sticky `.actions` bar.
- [ ] Edit cache: **no migration** (prototype — decided). A cached pre-`notations` shape is simply
      detected and cleared on load so the reducer never ingests stale-shaped values.
- [ ] Tests first: NotationEditor component tests — per-extra toggle; TeX-authored extra saves
      `{tex, mathml(minified)}`; reopening restores TeX mode + source; raw extra stays verbatim with
      no `tex` key; a broken extra shows its error inline on that block and disables Done; dirty
      dismissal prompts, clean dismissal doesn't.

## Phase 5 — Sign-in permissions FAQ

Feedback: *add FAQ explaining what permissions are required by the GH signin to dispel fears.*
Decision: **ⓘ popover beside the "Sign in with GitHub" button** (the moment of fear) **+ a fuller FAQ**
reachable from the header.

- [ ] `src/App.tsx` — reuse `InfoPopover` (from `components/ui`) next to the sign-in button. Short copy:
      sign-in shares **identity only** (your `@handle`) — **no repository access, no email, no write
      scope**; edits are committed by the project bot, **authored as you**; revoke anytime under
      GitHub → Settings → Applications.
- [ ] New `src/components/Faq.tsx` — a `<dialog>` (same pattern as the other modals) opened from a
      header "FAQ" link. Q&A: why sign in at all; exactly what the OAuth grant contains (identity-only,
      no repo scope); who writes to GitHub (the bot; commits authored as the contributor); what's stored
      locally (edits + session in `localStorage`); how the one-branch-per-session PR flow works; how to
      revoke access.
- [ ] Tests first: FAQ opens/closes, popover content has the key reassurances (accessible roles).

## Phase 6 — PR CI checks (separate repo: `dginev/mathml-intent-open`)

Feedback: three checks on PRs against the data repo. Changes land in `~/git/mathml-intent-open`
(its own commit/PR, not this repo).

- [ ] `_config_yamllint.yml` — `line-length: disable` (kills the length warnings; the canonical
      serializer intentionally emits unwrapped lines).
- [ ] New `scripts/validate_open.py` (PyYAML, stdlib-only):
      - **No duplicates:** every `(concept, arity)` pair in `open.yml` unique → exit 1 listing offenders.
      - **No Core overlap:** collect every `concept:` name from the W3C `core.yml`
        (`w3c/mathml-docs` `_data/core.yml`, nested under `defaultfixity[].concepts[]`, ~230 names) and
        fail if any open concept **name** matches. *Assumption to confirm: name-level comparison —
        core entries carry no explicit arity (fixity implies it).*
- [ ] `.github/workflows/list-yaml-checks.yml` — add steps: fetch `core.yml` from the w3c/mathml-docs
      raw URL, `pip install pyyaml`, run the validator (alongside the existing yamllint step).
- [ ] Test locally against the real `open.yml` + a doctored copy with a planted duplicate/core-overlap.

## Phase 7 — Docs, verification, ship

- [ ] `CLAUDE.md` — record: `tex:` list schema (scalar back-compat), language-dropdown column, status
      icon column, FAQ, renamed repo/BASE_PATH, data-repo CI checks.
- [ ] Full pass: `npm run build`, `npm run lint`, `npm test` (unit + e2e; the 10k paging guard must stay
      within budget).
- [ ] Merge to `main`; push (triggers the Pages deploy — confirm with @dginev as usual).

---

## Resolved decisions (from clarification)

| Point | Decision |
|---|---|
| Title overflow | Cap the **generated PR title** (~72 chars, keep `by @handle`) |
| Extra-notation layout | Line 1: full-width source; line 2: Rendered ∥ MathML source (simplified) |
| Extras authoring | Full TeX/Raw toggle per extra |
| Extras' TeX persistence | New **`notations:`** key: always a list, each entry a hash `{tex?: …, mathml: …}` — replaces `mathml:` + scalar `tex:` via a one-time whole-file migration; parser reads both shapes; legacy `notation*` keys untouched |
| Language dropdown | Only languages present in the data; missing → muted English fallback |
| FAQ | ⓘ popover at the Sign-in button + fuller FAQ dialog from the header |
| Repo name | Renamed to `mathml-intent-open-editor` by @dginev — Phase 0 finishes the move |

## Open assumptions (flag before the relevant phase)

1. **Core-overlap check compares concept names only** (core.yml has no per-entry arity).
2. **72-char** PR-title cap (GitHub's list-view truncation point); easy to change.
3. The `notations:` schema is a **shared-file format change** (replaces `mathml:`/`tex:`) — socialize
   with the W3C group, and the w3c/mathml-docs tooling that reads `mathml:` must adapt before the file
   is upstreamed. Open PR branches on the old shape should be merged/closed before the migration commit.

## Non-goals (decided, not overlooked)

From the UX/a11y review (2026-06-04), explicitly out of scope for this round:

- **Edit-cache migration** for the `notations:` model change — prototype stage, no production users;
  a stale cache is cleared, not migrated.
- **Mobile/responsive layout** for the 10k-row grid.
- **Translating the app chrome** itself (the UI stays English; only the *data* is multilingual).
- **WCAG 1.4.10 reflow at 400% zoom** for the virtualized table (inherent tension with windowed
  rendering; revisit if the group asks).
