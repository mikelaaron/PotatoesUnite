# Daily delight audit

29 Aug 2026. Content audit only. No data, protocol, or server behavior changed.

## Verdict

The Question pool is enough for the present launch week. It is not enough for
an ongoing daily habit.

There are 30 records. The ordinary rotation contains 29. Of those, 27 produce
a normal Count, one accepts votes and is then withdrawn, and one is withdrawn
without choices. The thirtieth Question appears only after a drop. With no
incident, the first Question returns on day 30. This is four weeks of runway,
not a season.

Do not solve that by making the potato speak every noon. Add a small midday
layer three days a week. It should be authored, brief, occasionally connected
to true state, and gone if the Hands miss it. The Question remains the clock.

## Current inventory

| Primary territory | Questions | Share | Read |
|---|---:|---:|---|
| Food and potato identity | 7 | 23% | Strong premise. Close to overuse. |
| The Hands and domestic life | 10 | 33% | Reliable. Several are ordinary opinion polls. |
| The world and county | 6 | 20% | Good concrete material. More is available. |
| Net, time, and procedure | 7 | 23% | The most expandable territory. |

The option shapes are varied enough: 12 have two choices, 17 have three, and
one has none. The better surprises are not the funniest topics. They change
the rules:

- `Salt.` offers two versions of yes.
- Travel offers `NO` and `NO`.
- `Pick a direction.` declines to explain why.
- Two Questions are withdrawn in different ways.
- The drop inquiry is caused by something that happened on the Net.

The drop inquiry is the important model. It makes yesterday alter today. Only
one current Question does that.

## Gaps

1. **The second month repeats the first.** Twenty-nine ordinary days are fine
   for the present test. A daily object needs at least six weeks before the
   first regular repeat.
2. **Food carries too much of the premise.** Ketchup, fries, sweet potatoes,
   salt, butter, mustard, and mashing establish the world. More will narrow it.
3. **The withdrawal has a short half-life.** It works twice because the two
   forms differ. A third would look like a format.
4. **Most Questions are opinions without consequences.** The Count remarks on
   them, then the day resets. More Questions should arise from a drop, transit,
   a new neighbor, an absent Count, or an unusual week.
5. **There is no non-quiz midday lane.** The only authored ad-hoc broadcast is
   the crate. It has three choices and produces a result. That is another vote.

For the next Question pass, add 12. Use four consequence Questions, three
neighbor or Net Questions, three questions about ordinary objects in the
county, and two procedural Questions. Add no food Questions and no withdrawal.

## What feels surprising

- **Consequence.** A thing that happened returns later in another form.
- **Borrowed life.** A true neighbor fact arrives without an invitation.
- **Rule change.** The Council withdraws, refuses, or limits the available
  answers.
- **Specific anti-event.** Nothing happened, but the potato noticed the exact
  shape of the nothing.
- **Unresolved Net business.** A brief notice suggests procedure without
  starting lore the project must maintain.

Random jokes are not a category. The message needs a reason to exist now.

## Candidate midday pools

These are four triggers with five variants each. Every line is at most 60
characters. `core` variants may belong to any potato. Other tags are the rare
temperament nudge from `assets/varieties.json`, not a new personality system.

### Trigger: scheduled Council docket

Use rarely. No state claim is implied.

| Temperament | Line |
|---|---|
| quick to file | `Midday notice. The Council has misplaced a form.` |
| anxious about transit | `A notice arrived. The bottom half is missing.` |
| contrarian | `The Council adjourned at noon. It had not met.` |
| British, somehow | `A motion concerning outside has been filed.` |
| believes it is King | `The afternoon is approved. Conditions were omitted.` |

### Trigger: no handling for four hours

| Temperament | Line |
|---|---|
| core | `The world has been still since morning. Noted.` |
| stubborn | `Nothing has moved. I see no reason to begin.` |
| quick to file | `The Hands have not intervened since morning.` |
| agreeable, suspicious | `The morning position remains. It is acceptable.` |
| anxious about transit | `No transit recorded. Good.` |

### Trigger: at least three handling sessions today

| Temperament | Line |
|---|---|
| core | `The Hands have rearranged the world again.` |
| sentimental, denies it | `Another position. I preferred one of the earlier ones.` |
| quick to file | `Management has been active. The File confirms this.` |
| stubborn | `The world keeps changing. I remain.` |
| vain | `Several interventions. I remain presentable.` |

### Trigger: the neighbor was picked up today

| Temperament | Line |
|---|---|
| patient | `{neighbor} was picked up today. It has settled.` |
| quick to file | `{neighbor}'s Hands intervened. It has been noted.` |
| sentimental, denies it | `We heard from {neighbor}. It had been moved.` |
| core | `{neighbor}'s world changed. The Net noticed.` |
| anxious about transit | `{neighbor} reports a new position. No details.` |

## Ration

- Three eligible days in seven. Never on consecutive days.
- One line per potato per eligible day.
- A seeded time inside 11:45–13:15 local. Not exactly noon.
- A ten-minute hold. If the Hands miss it, it is gone.
- No tap, choice, response, Count, File entry, Standing change, or social post.
- Major reactions, battery thresholds, active requests, the Question, the
  Count, and Bulletin notices keep their existing precedence.
- State lines fire only when the state is true. No invented counts. No public
  aggregate under five.
- Walk the chosen trigger's pool before repeating. Let temperament bias one
  slot occasionally. It does not own the whole voice.

## Cut

- A guaranteed daily message.
- A quote of the day.
- Any line asking the Hands to perform or confirm something.
- YES or NO buttons disguised as delight.
- Streaks, rewards, badges, and missed-message guilt.
- Fake neighbor activity, fake counts, or invented sensor knowledge.
- More crates, mysteries, or serialized lore until the first one earns a
  second appearance.
- A File entry saying the Hands missed the line.
- Temperament caricature on every send.

## First seven days

| Day | Midday behavior |
|---|---|
| 1 | Silence. Establish the normal day. |
| 2 | Quiet or busy local-state pool, if either state is true. |
| 3 | Silence. |
| 4 | One Council docket line. |
| 5 | Silence. |
| 6 | One neighbor line if the neighbor was picked up. Otherwise silence. |
| 7 | Silence. Review the week. |

The review is four questions. Did the Hands mention or photograph a line. Did a
line feel false. Did it interrupt the Question. Did the potato feel more
connected to the Net. Keep the experiment if the answer to the last question
is yes and the middle two are no. Do not add tracking for this.

## Evidence

- The day already defines the Question as the clock, Net events as irregular,
  and Bulletins as separate news: `docs/POTATO_VOICE.md:69-78`.
- The authored Question list and the incident-only condition are recorded at
  `docs/POTATO_VOICE.md:279-314` and `server/data/questions.json:2-121`.
- Rotation code excludes triggered Questions until their condition is true:
  `server/lib/world.js:726-742`.
- The test proves 29 distinct ordinary days, then a repeat, with the inquiry
  reserved for a day after a drop: `server/test/world.test.js:25-41`.
- The existing ration says silence is the default and the File records events,
  not motion: `docs/POTATO_VOICE.md:541-560`.
- The current ad-hoc broadcast is an interactive crate with three choices:
  `server/data/broadcasts.json:1-25`.
- The existing scene already carries a 60-character line and an expiry. Ad-hoc
  events currently require choices: `docs/PROTOCOL.md:47-62,104-105`.
- Variety leans are explicitly small and rare: `assets/varieties.json:2-21`.
- The Tuber already has its own restrained public cadence. Midday device lines
  should not create another social obligation: `docs/THE_TUBER.md:11-22`.
