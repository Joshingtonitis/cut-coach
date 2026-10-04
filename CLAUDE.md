# CLAUDE.md — notes for Claude sessions working on this repo

## What this is

**Pinche Güey** is a personal weight-cut tracker for Josh. He uses it mostly as an
iPhone home-screen web app, and also on his laptop. It's a static site with no build
step, deployed by GitHub Pages from `main` to
https://joshingtonitis.github.io/cut-coach/ (about a minute after a merge).

Josh is learning as he goes. When you change something, explain what changed and how
the code works in plain language, with short sections and no jargon walls. Send
screenshots of visual changes.

## Files

| File | Role |
|------|------|
| `index.html` | All markup: intro overlay, 5 tab views (`section.view[data-view]`), viewer, tab bar |
| `styles.css` | Sci-fi HUD theme. Colors are CSS variables; `:root[data-mood=…]` blocks re-theme everything |
| `app.js` | The whole app in one IIFE: storage, schedules, stall-check analysis, rendering, form, debrief, photos, moods, intro, router, sync bridge, boot |
| `sync.js` | Optional Supabase sync engine (`window.createSync(bridge)`) |
| `config.js` | Supabase URL and publishable key (public by design, protected by row-level security) |
| `supabase/setup.sql` | Database setup: `records` table, RLS policies, private `photos` bucket |
| `supabase/health-import.sql` | Apple Health import: `ingest_keys` (hashed keys) + `ingest_nutrition()` security-definer function that merges calories/protein into `e:date` records |
| `quotes.js` | Daily home-screen lines (`window.CUT_QUOTES`) |
| `version.json`, `tools/release.sh` | Release version stamp. The script adds `?v=` to the local js/css links in `index.html` and writes `version.json`; the app's update check compares the two |
| `README.md` | User-facing docs: how features and the stall check work. Keep it in sync with changes |

## How the code fits together

- **Tabs** are hash routes (`#home`, `#log`, `#progress`, `#history`, `#settings`).
  `route()` shows the matching `section.view`. To add a tab, add a view plus a tab bar link.
- **Data on the device:** `localStorage` keys `cutcoach.entries` (days by `YYYY-MM-DD`),
  `cutcoach.goals`, `cutcoach.settings`, `cutcoach.moods` and `cutcoach.sync`.
  Progress photos live in IndexedDB (`pinche-guey` / `photos`). **Keep the `cutcoach.`
  key names**: renaming them would orphan Josh's existing data.
- **Example data** shows until the first real entry (`mode==='example'`). It's never
  saved, synced or exported.
- **Two logging rhythms:** daily fuel (calories, protein, steps, plan, debrief) and
  check-ins (weight + photo) on `settings.checkinDay` per the schedule. The two Log
  cards write disjoint fields into the same `e:date` record via `saveDay()`.
  `checkinStatus()` / `checkinText()` compute due / done / overdue.
- **Check-in schedules:** everything schedule-dependent is in the `SCHEDULES` table
  (daily / weekly / bi-weekly). Goals are `{calories, protein, steps}`.
- **Sync:** data is stored as records (`e:date`, `m:date`, `p:goals`, `p:settings`,
  `f:date`), and the newer change wins. **Any new kind of user data must be added to
  the bridge's `localRecords()` / `apply()`, and every local change must call
  `synced.touch(key)` or `synced.remove(key)`**, or it won't sync.
- **Themes:** accent colors are `r,g,b` variables (`--a1`, `--a2`, `--a3`) used as
  `rgba(var(--a1),.x)`, plus status colors (`--good`, `--warn`, `--bad`). New UI
  should use these variables, never hard-coded colors, so mood themes apply.
  Theme changes animate via View Transitions (`themeSwitch()`).
- **Style:** dark, futuristic HUD. Use corner-bracket panels (`.panel.hud`), mono
  labels (`.kicker`), sharp 2–3px radii, and glows from the accent variables. Keep it
  phone-first (390px wide), with no horizontal overflow, and respect
  `prefers-reduced-motion`.
- **Apple Health import:** MyFitnessPal → Apple Health → iOS Shortcut → `ingest_nutrition` RPC → `records`. The UI is in Settings; the key helpers are in `sync.js`. SQL changes can be tested against the local Postgres 16 install (`/usr/lib/postgresql/16/bin`) with stub `auth`/`storage` schemas.
- External scripts load only from cdn.jsdelivr.net (supabase-js) and Google Fonts.

## Testing before you push

Playwright and Chromium are installed (`NODE_PATH=$(npm root -g)`, browsers in
`/opt/pw-browsers`). There's no WebKit, so iOS-only quirks need Josh to check them on
his phone.

- Open `file://$PWD/index.html` at a 390×844 viewport. **Click `#intro` first** to
  skip the opening animation.
- `page.clock.setFixedTime(...)` tests time-of-day features (greeting, mood slots,
  the debrief after 5pm). Don't use `clock.install`, which freezes CSS animations.
- Check for no `pageerror`s, and that `document.documentElement.scrollWidth` equals
  the viewport width.
- To test sync without touching Josh's real data, fake supabase-js: route
  `https://cdn.jsdelivr.net/**` and `**/config.js` to a mock (served over
  `python3 -m http.server`). Never create test accounts in the real project.
- `node --check app.js sync.js` catches syntax errors.

## Workflow

1. Branch from the latest `main`. Commit with clear messages.
2. Test (see above). **Run `sh tools/release.sh` and commit its changes** (index.html + version.json) as the last step before pushing, so phones load the new version right away instead of a cached one. Then push, open a PR and merge it once Josh has said yes to the
   change. Then confirm the live site updated by fetching the page and grepping for
   the change.
3. Tell Josh to fully close and reopen the home-screen app to get the new version.

Never put the Supabase `service_role` / secret key or the database password anywhere
in the repo.
