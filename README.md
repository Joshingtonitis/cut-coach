# Pinche Güey

A small, no-build web app for tracking a weight cut, styled like a control
interface from a few decades ahead. You log your weight and a few
habits each day. It shows your **trend weight** and checks whether you're on track.
When the scale stops moving, it tells you **why**: you're still losing and the
scale is just noisy, your consistency slipped, or you've hit a real plateau.

## Running it

There's nothing to install. Open `index.html` in a browser, or serve the folder
with any static server:

```sh
npx serve .        # or: python3 -m http.server
```

## Files

| File         | What's in it                                                        |
|--------------|---------------------------------------------------------------------|
| `index.html` | The five tabs (Home, Log, Progress, History, Settings) and the bottom tab bar |
| `styles.css` | All styling: the sci-fi HUD theme built on CSS variables, the three mood themes, and the intro animation |
| `app.js`     | Data storage, weigh-in schedules, the stall-check analysis, end-of-day debrief and body signals, rendering, CSV export, the greeting, intro, mood check-ins and tab navigation |
| `sync.js`    | Optional cloud sync through Supabase (off until `config.js` is filled in) |
| `config.js`  | Your Supabase project URL and public anon key. Empty means no sync |
| `supabase/setup.sql` | One-time database setup for sync: table, privacy rules, photo bucket |
| `quotes.js`  | The list of daily lines shown on the home screen. Add your own here |
| `icons/`     | App icon: `icon.svg` (source), `favicon.svg`, and PNGs for the home screen |
| `manifest.json` | Name and icons used when the app is added to a home screen     |

## What you log

Each day can have any of these fields. All are optional, but you need at least one.

- **Weight** (lb). The stall check runs on this.
- **Calories**, **protein** (g), **steps**
- **Stuck to plan?** Yes or no. This is your own honest call for the day.
- **End-of-day debrief:** three 1–5 ratings.
  - **Hunger:** 1 = not hungry, 5 = starving.
  - **Energy:** 1 = drained, 5 = charged.
  - **Sleep quality:** 1 = terrible, 5 = great. This is last night's sleep.

- **Progress photo** (Log tab): one photo per date. You can take it with the camera
  or pick it from your library. It saves as soon as you choose it, and you can
  replace or remove it there too. The field also says when the next photo is due
  on your weigh-in schedule.

  From 5pm the home screen shows the debrief card, and a tap saves straight into
  that day's entry. Tap the same number again to clear it. The card stays until
  5am, and after midnight it still rates the previous day. You can also rate any
  day from the Log tab.

## Layout

The app has five tabs in a bar at the bottom of the screen:

| Tab | What's on it |
|-----|--------------|
| **Home** | Greeting, today's line, mood check-in, end-of-day debrief (from 5pm), and a one-line status (verdict, trend weight, next weigh-in). Tap the status to open Progress. |
| **Log** | The entry form for today or any other date |
| **Progress** | Stall check, trend chart, summary for your schedule's period, body signals, visual log (progress photos), and streaks |
| **History** | Your logged days, newest first, and **Export CSV** |
| **Settings** | Weigh-in schedule and goals |

Each tab has its own address (`#home`, `#log`, …), so your phone's back gesture
works. To add a feature later, add a `<section class="view" data-view="name">` to
`index.html` and a matching link in the tab bar, or put it inside an existing tab.

### Intro animation

Every time the app opens it plays a short boot sequence, about 3 seconds:

1. System lines type in.
2. A scan line sweeps across the screen.
3. The greeting ("GOOD MORNING", etc.) decodes out of random glyphs.
4. **JOSH** assembles letter by letter with a glow.
5. The overlay dissolves into the app.

Tap anywhere to skip. On a phone, an app you switch back to often doesn't reload,
so the intro also replays when you return after more than 10 minutes away. If your
phone has **Reduce Motion** turned on, it shows a simple fade instead. The sequence
is in `playIntro()` in `app.js` and the `.intro` styles in `styles.css`.

### Home screen

- **A greeting with your name.** It says "Good morning" from 5am to noon,
  "Good afternoon" until 5pm, "Good evening" until 9pm, and "Goodnight" after
  that. The name is set by `NAME` in `app.js`.
- **Today's line.** This is a short Stoic, existential or discipline idea, such
  as *memento mori*, *amor fati* or Seneca on wasted time. The same line stays up
  all day and changes at midnight. Tap **Another** for a different one. To add or
  edit lines, change `quotes.js`.
- **Mood check-in.** See below.

### Body signals (Progress tab)

This panel averages your hunger, energy and sleep ratings over the summary period
and shows each as a 5-segment meter. It adds up to two plain-language notes:

- **Sleep and hunger:** with at least 3 bad nights (sleep 1–2) and 3 good nights
  (sleep 4–5), it compares your hunger after each and calls out a gap of 0.7 or more.
- **High hunger:** average hunger of 4 or more.
- **Low energy:** average energy of 2 or less.
- **Poor sleep:** average sleep of 2.5 or less.

### Visual log (Progress tab)

Once you have two progress photos, the visual log puts your **first** and **latest**
side by side, with each one's date and weight and the change between them (for
example "−2.8 lb over 2 weeks"). Below that is every photo, newest first. Tap any
photo to view it full screen, then swipe through with ‹ and ›.

### Mood check-ins and color themes

There are four check-ins a day, using the same times as the greeting: morning,
afternoon, evening and night. Night runs until 5am, so a check-in at 1am counts
as the previous day's night. Each check-in has three options, and each one
re-colors the whole app:

| Mood | Theme |
|------|-------|
| **Exhausted** | Graphite and silver, low glow |
| **Locked in** | Near-black with deep crimson |
| **Energetic** | A pink-to-purple sunset with a warm orange glow |

Your most recent check-in of the day sets the theme. Until your first check-in
of the day, the app uses the default teal and violet. Tap the selected mood again
to clear it. The row of four dots shows the day's check-ins so far.

The themes live in `styles.css`. Each `:root[data-mood="…"]` block overrides the
accent color variables (`--a1`, `--a2`, `--a3`). It also re-tints the status colors
(`--good`, `--warn`, `--bad`) used by verdict tags, the Yes/No buttons and History
pills, so nothing stays teal or green in another theme.

**Theme sweep.** When a check-in changes the theme, the new colors spread out in a
smooth circle from the button you tapped, over about a second, with no flash. On
iOS 18+ and recent Chrome this uses the browser's View Transitions: the old theme
stays on screen while a growing circle reveals the new one. Older browsers switch
the colors directly while a soft glowing ring travels outward. It's skipped when
Reduce Motion is on. The logo in the top bar is drawn inline in `index.html`, so it
takes the theme colors too. The home-screen app icon can't change, because iOS
keeps the image saved when you added it.

### Weigh-in schedule

Under **Settings** (or on the Progress tab) pick **Daily**, **Weekly** or
**Bi-weekly**. Weight is optional on every entry, so on other days you can still
log food, steps and the plan. The schedule changes:

| | Daily | Weekly | Bi-weekly |
|---|---|---|---|
| Trend smoothing (each weigh-in pulls the trend…) | 10% of the way | 50% | 60% |
| Stall check looks back over | 14 days | 6 weeks | 8 weeks |
| Weigh-ins needed before a verdict | 7 | 3 | 3 |
| History needed to call a plateau | 2 weeks | 4 weeks | 6 weeks |
| Trend chart shows | 6 weeks | 12 weeks | 16 weeks |
| Summary covers | Last 7 days | Last 4 weeks | Last 8 weeks |
| Logging streak counts | days with an entry | weeks with a weigh-in | 2-week blocks with a weigh-in |

With fewer weigh-ins, each one has to carry more weight in the trend. The
smoothing values are chosen so the trend reflects roughly the last 2–4 weeks
on any schedule. All of these values are in the `SCHEDULES` table near the top
of `app.js`.

Tap any day in History to edit or delete it. This opens the Log tab with that day loaded. Under **Settings → Goals** you can set a daily
protein target, which drives the protein streak, and a daily step goal.

Until you save your first day, the app shows made-up **example data** so you can
see how it works. The example data is never saved or exported.

## Where your data lives

Everything is stored in your browser's `localStorage`, under these keys:

- `cutcoach.entries`: every logged day, as an object keyed by date (`YYYY-MM-DD`), including the debrief ratings
- `cutcoach.goals`: your protein and step goals
- `cutcoach.settings`: your weigh-in schedule
- `cutcoach.moods`: mood check-ins, keyed by date and then time of day

**Progress photos** are too big for `localStorage`, so they're kept in the browser's
IndexedDB database (`pinche-guey`, store `photos`), keyed by date. Before saving,
each photo is shrunk to 1280px on its long side and re-encoded as JPEG, which
comes to roughly 150–300 KB. The app also asks the browser to keep this data
persistent. Photos stay on your phone and aren't part of the CSV export.

The keys still start with `cutcoach.` from the app's original name. Renaming them would
have orphaned the data you'd already logged.

Nothing is sent anywhere. That also means the data belongs to **this browser on
this device**. Clearing site data, or opening the app in a different browser,
gives you an empty log. If the browser blocks storage (some private modes do),
a banner warns you that entries will only last until you close the page.

### Export CSV

**Export CSV** on the History tab downloads `pinche-guey-YYYY-MM-DD.csv` with one
row per logged day, oldest first:

```
date,weight_lb,trend_lb,calories,protein_g,steps,on_plan,hunger_1to5,energy_1to5,sleep_1to5
2026-09-29,183,183.00,,,,no,,,
2026-10-01,182.4,182.94,,150,,yes,4,3,2
```

Empty cells mean you didn't log that field. `trend_lb` is the smoothed trend
weight described below, so you can chart it in a spreadsheet.

## Sync between phone and laptop

Without sync, each browser keeps its own separate copy of your data. With sync,
you sign in once on each device and everything stays matched: logs, debriefs,
mood check-ins, goals, schedule and progress photos. It runs on
[Supabase](https://supabase.com)'s free tier.

### One-time setup

1. **Create the project.** At supabase.com, sign up (Continue with GitHub works)
   and click **New project**. Name it `pinche-guey` and pick the region nearest
   you. Set a database password and keep it to yourself; the app never needs it.
2. **Create the tables.** Open **SQL Editor → New query**, paste in all of
   `supabase/setup.sql`, and press **Run**.
3. **Allow sign-in from the app.** Open **Authentication → URL Configuration** and
   set **Site URL** to `https://joshingtonitis.github.io/cut-coach/`.
   Optional, since it's a personal app: under **Authentication → Sign In / Providers
   → Email**, turn off **Confirm email** so new accounts work right away.
4. **Connect the app.** Open **Project Settings → API**, copy the **Project URL**
   and the **anon / publishable** key, and paste both into `config.js`. Commit and
   deploy. Never use the `service_role` / secret key: it bypasses the privacy rules.
5. **Sign in on each device.** In the app, open **Settings → Sync**. On your phone,
   choose **Create account**. On your laptop, **Sign in** with the same email and
   password. Data already on a device uploads the first time it signs in.

### How it works

Every piece of data is a record with a key (`e:2026-10-01` for a day's log,
`m:…` for moods, `p:goals`, `p:settings`, `f:…` for a photo) and the time it
last changed. Each sync pulls all your records, applies any that are newer
than the device's own copy, and uploads anything the server is missing or has
an older copy of. When two devices disagree, the newer change wins. Deletions
spread too. Photos are uploaded to a private storage bucket at
`<your user id>/<date>.jpg`.

Sync runs when the app opens, a second or two after any change, when you come
back to the app, every minute while it's open, and whenever you tap **Sync now**.
The dot next to the clock shows the state: steady means synced, a fast pulse
means syncing, and orange means there's a problem (the details are in
Settings → Sync). Signing out keeps your data on the device and just stops
syncing it.

The anon key in `config.js` is meant to be public. The row-level security rules
in `setup.sql` only let a signed-in account read and write its own rows and
photos.

## Working on the code from more than one device

The code lives on GitHub (`joshingtonitis/cut-coach`), so any device can work on
it:

- **With Claude:** open [claude.ai/code](https://claude.ai/code) in a laptop
  browser, or use the Claude desktop app, and pick this repository. Each session
  starts from the latest `main`, so merge a change before switching devices.
- **Locally:** run `git clone https://github.com/Joshingtonitis/cut-coach.git`,
  then `npx serve .` (or `python3 -m http.server`), and open the address it
  prints. Run `git pull` before you start, to pick up changes made elsewhere.

## How the stall check works

### 1. Trend weight

Daily weight swings by 1–3 lb from water, salt, carbs and timing, so a single
weigh-in tells you very little. The app smooths your weigh-ins with an
**exponential moving average**:

```
trend = trend + 0.1 × (today's weight − trend)
```

On the daily schedule, each new weigh-in pulls the trend 10% of the way toward
itself (50% weekly, 60% bi-weekly; see the schedule table above). One salty-dinner
spike barely moves it. A real change in body weight moves it steadily over a
week or two. The chart shows the trend as the glowing line and your raw weigh-ins
as grey dots.

### 2. The numbers it looks at

The check looks back over a window that depends on your schedule: 14 days for
daily, 6 weeks for weekly, 8 weeks for bi-weekly.

- **Trend rate (lb/wk):** how much the trend changed between your latest
  weigh-in and the start of the window, scaled to a weekly rate.
- **On plan:** of the days in the window where you answered "Stuck to plan?",
  the share where you said yes.
- **Days logged** (daily) or **Weigh-ins** (weekly and bi-weekly): how many
  days have an entry, or how many scheduled weigh-ins you made, out of the
  number expected.

### 3. The verdict

The rules are checked in this order. The first one that matches wins:

| # | Condition | Verdict | What it tells you |
|---|-----------|---------|-------------------|
| 1 | Fewer weigh-ins than the schedule needs (7 daily, 3 otherwise) | **Getting started** | Not enough data for a trend yet. |
| 2 | Trend is falling by at least 0.2 lb/wk | **On track**, or **Normal fluctuation** if today's weigh-in is higher than the last one | You're losing. A scale jump is noise, so don't change anything. |
| 3 | On plan for less than 75% of answered days, **or** under 70% of expected logging (e.g. fewer than 10 of 14 days, or 4 of 6 weekly weigh-ins) | **Consistency slipping** | The stall comes from the plan not being followed, not from the plan failing. Fix the habit before cutting calories. |
| 4 | You've been consistent and have enough weigh-in history (2, 4 or 6 weeks by schedule) | **True plateau** | Your body has adapted. Make one small change: slightly fewer calories, more steps, or a 1–2 week diet break. |
| 5 | Anything else | **Too early to call** | Flat, but not for long enough to be a plateau yet. |

The order matters. Consistency is checked **before** plateau, so the app never
tells you to cut harder when the real problem is missed days.

### 4. Weekend pattern

Separately, the app looks at the last **28 days**. Suppose you have at least 3
weekend days and 6 weekdays with a plan answer, and your weekday on-plan rate is
at least **25 percentage points** higher than your weekend rate. Then it shows a
"Weekend pattern" note, and the Consistency advice changes to "plan your
weekends ahead of time".

## Streaks and summary

- **Streaks** count back from today, or from yesterday if you haven't logged
  today yet. There are three:
  - **Logging:** days with an entry on the daily schedule. On weekly and
    bi-weekly, it counts weeks with a weigh-in instead.
  - **On plan:** days you answered yes to "Stuck to plan?".
  - **Protein goal:** days at or above your protein goal.
- **Summary** covers the period for your schedule. It shows the trend change,
  weigh-ins, average weight, days on plan, days logged, and your average
  protein, steps and calories.
