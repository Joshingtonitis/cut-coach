# Cut Coach

A small, no-build web app for tracking a weight cut. You log your weight and a few
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
| `index.html` | The home screen plus one view per section (log, stall check, trend, streaks, last 7 days, history, goals) |
| `styles.css` | All styling: a dark, high-tech theme built on CSS variables        |
| `app.js`     | Data storage, the stall-check analysis, rendering, CSV export, the greeting and the home/section navigation |
| `quotes.js`  | The list of daily lines shown on the home screen. Add your own here |
| `icons/`     | App icon: `icon.svg` (source), `favicon.svg`, and PNGs for the home screen |
| `manifest.json` | Name and icons used when the app is added to a home screen     |

## What you log

Each day can have any of these fields. All are optional, but you need at least one.

- **Weight** (lb). The stall check runs on this.
- **Calories**, **protein** (g), **steps**
- **Stuck to plan?** Yes or no. This is your own honest call for the day.

### Home screen

The app opens on a home screen:

- **A greeting with your name.** It says "Good morning" from 5am to noon,
  "Good afternoon" until 5pm, "Good evening" until 9pm, and "Goodnight" after
  that. The name is set by `NAME` near the bottom of `app.js`.
- **Today's line.** This is a short Stoic, existential or discipline idea, such
  as *memento mori*, *amor fati* or Seneca on wasted time. The same line stays up
  all day and changes at midnight. Tap **Another** for a different one. To add or
  edit lines, change `quotes.js`.
- **A tile for each section.** Each tile shows its key number, such as whether
  you've logged today or your current verdict. Tap a tile to open that section
  full screen. Tap **Home**, or use your phone's back gesture, to return.

Tap any day in History to edit or delete it. This opens the Log view with that day loaded. Under **Goals** you can set a daily
protein target, which drives the protein streak, and a daily step goal.

Until you save your first day, the app shows made-up **example data** so you can
see how it works. The example data is never saved or exported.

## Where your data lives

Everything is stored in your browser's `localStorage`, under these keys:

- `cutcoach.entries`: every logged day, as an object keyed by date (`YYYY-MM-DD`)
- `cutcoach.goals`: your protein and step goals

Nothing is sent anywhere. That also means the data belongs to **this browser on
this device**. Clearing site data, or opening the app in a different browser,
gives you an empty log. If the browser blocks storage (some private modes do),
a banner warns you that entries will only last until you close the page.

### Export CSV

**Export CSV** in the History panel downloads `cut-coach-YYYY-MM-DD.csv` with one
row per logged day, oldest first:

```
date,weight_lb,trend_lb,calories,protein_g,steps,on_plan
2026-09-29,183,183.00,,,,no
2026-10-01,182.4,182.94,,150,,yes
```

Empty cells mean you didn't log that field. `trend_lb` is the smoothed trend
weight described below, so you can chart it in a spreadsheet.

## How the stall check works

### 1. Trend weight

Daily weight swings by 1–3 lb from water, salt, carbs and timing, so a single
weigh-in tells you very little. The app smooths your weigh-ins with an
**exponential moving average**:

```
trend = trend + 0.1 × (today's weight − trend)
```

Each new weigh-in pulls the trend 10% of the way toward itself. One salty-dinner
spike barely moves it. A real change in body weight moves it steadily over a
week or two. The chart shows the trend as the blue line and your raw weigh-ins
as grey dots.

### 2. The numbers it looks at

The check looks at the **last 14 days**, ending today:

- **Trend rate (lb/wk):** how much the trend changed between your latest
  weigh-in and 14 days before it, scaled to a weekly rate. It needs at least 5
  days of span to compute one.
- **On plan, 14d:** of the days in the window where you answered "Stuck to
  plan?", the share where you said yes.
- **Days logged:** how many of the 14 days have any entry.

### 3. The verdict

The rules are checked in this order. The first one that matches wins:

| # | Condition | Verdict | What it tells you |
|---|-----------|---------|-------------------|
| 1 | Fewer than 7 weigh-ins total | **Getting started** | Not enough data for a trend yet. |
| 2 | Trend is falling by at least 0.2 lb/wk | **On track**, or **Normal fluctuation** if today's weigh-in is higher than the last one | You're losing. A scale jump is noise, so don't change anything. |
| 3 | On plan for less than 75% of answered days, **or** fewer than 10 of 14 days logged | **Consistency slipping** | The stall comes from the plan not being followed, not from the plan failing. Fix the habit before cutting calories. |
| 4 | You've been consistent and have 14+ days of weigh-in history | **True plateau** | Your body has adapted. Make one small change: slightly fewer calories, more steps, or a 1–2 week diet break. |
| 5 | Anything else | **Too early to call** | Flat, but not for long enough to be a plateau yet. |

The order matters. Consistency is checked **before** plateau, so the app never
tells you to cut harder when the real problem is missed days.

### 4. Weekend pattern

Separately, the app looks at the last **28 days**. Suppose you have at least 3
weekend days and 6 weekdays with a plan answer, and your weekday on-plan rate is
at least **25 percentage points** higher than your weekend rate. Then it shows a
"Weekend pattern" note, and the Consistency advice changes to "plan your
weekends ahead of time".

## Streaks and recap

- **Streaks** count consecutive days back from today, or from yesterday if you
  haven't logged today yet. There are three: days logged, days on plan, and days
  at or above your protein goal.
- **Last 7 days** shows the change in trend weight, days on plan, days logged,
  and your average protein, steps and calories.
