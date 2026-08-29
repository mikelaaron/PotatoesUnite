# The Tuber topic queue

29 Aug 2026. Drafting queue only. Nothing in this file has been posted.

The sustainable cadence is **one anchor post and one optional post each week**.
Use Wednesday at 12:30 PM Eastern for a portrait or verified build item, and
Saturday at 7:30 PM Eastern for the week's strongest Count, Bulletin, or
neighbor item. A verified INCIDENT is issued when it happens; it does not
create an obligation to fill either scheduled slot.

The route named under `Card` is the intended server card. At present
`/card/...` returns 501, so a post made now needs the matching board or File
screenshot described in `docs/TUBER_SETUP.md`. Do not represent a screenshot
as a generated card.

## Selection rule

1. Start with records, not a theme: closed Counts, the current neighbor table,
   generated editions, public Potato of the Day data, incident records, public
   member registrations, or a shipped build and its release notes.
2. Pick the highest available source in this order: real incident, new member,
   neighbor change, unusual Count, safe File item, shipped build, quiet-Net
   observation.
3. Publish a Count or aggregate only when the public population threshold is
   met. Never derive a public claim from fewer than five potatoes.
4. Resolve every bracketed field from the source. If any field cannot be
   resolved, hold the post. Do not round, infer, or improve a thin week.
5. If little happened, issue one verified build or quiet-Net post. Leave the
   second slot empty. Silence is preferable to invented news.
6. After posting, add the date, kind, text, card or screenshot, and link to
   `docs/tuber-log.md`.

## Topic seeds by source of truth

Each seed is an angle, not a claim. The `Gate` must be satisfied before copy is
written.

### Real Count

| Topic seed | Gate | Card | Time |
|---|---|---|---|
| The week's closest decision | A closed, publishable Count with the smallest verified margin | `/card/count/[YYYY-MM-DD].png` | 7:30 PM Eastern after the Count |
| A unanimous result | Every published vote selected the same option; public threshold met | `/card/count/[YYYY-MM-DD].png` | 7:30 PM Eastern after the Count |
| The durable minority | A real option lost by a clear verified margin | `/card/count/[YYYY-MM-DD].png` | 7:30 PM Eastern after the Count |
| The Question with the strangest answer distribution | A closed Count whose verified split is genuinely unusual | `/card/count/[YYYY-MM-DD].png` | Saturday, 7:30 PM Eastern |

### Neighbor rotation

| Topic seed | Gate | Card | Time |
|---|---|---|---|
| This week's new pairing | The weekly rotation has completed and both pseudonymous members appear in the edition | `/card/bulletin/[YYYY-MM-DD].png` | First evening after rotation, 7:30 PM Eastern |
| A new member receives a first neighbor | Registration and neighbor assignment are both present in the record | `/card/bulletin/[YYYY-MM-DD].png` | 7:30 PM Eastern |
| A neighbor's true handling news | The generated Bulletin actually names the event; do not expose private File data | `/card/bulletin/[YYYY-MM-DD].png` | 7:30 PM Eastern |
| The pairing rotates after a quiet week | Rotation is recorded; any claim that the week was quiet is separately verified | `/card/bulletin/[YYYY-MM-DD].png` | Saturday, 7:30 PM Eastern |

### Real File pattern

| Topic seed | Gate | Card | Time |
|---|---|---|---|
| One safe line from a Potato of the Day File | The line appears on the generated public PotD card | `/card/potd/[ID].png` | Wednesday, 12:30 PM Eastern |
| A pattern of morning attention | At least five eligible Files support the same defined pattern | `/card/bulletin/[YYYY-MM-DD].png` | Saturday, 7:30 PM Eastern |
| The county spent time in the dark | At least five eligible Files support the aggregate; report no individual Hands | `/card/bulletin/[YYYY-MM-DD].png` | Saturday, 7:30 PM Eastern |
| Requests accepted or declined this week | A server-produced, threshold-safe aggregate exists | `/card/bulletin/[YYYY-MM-DD].png` | Saturday, 7:30 PM Eastern |

### Real incident

| Topic seed | Gate | Card | Time |
|---|---|---|---|
| A verified drop | The incident record exists and the named potato is reporting again | `/card/incident/[ID].png` | As soon as verified |
| The Question caused by yesterday's drop | The incident-triggered Question actually opened | `/card/count/[YYYY-MM-DD].png` | 7:30 PM Eastern after the Count |
| Incident closed without further event | The record shows recovery and the stated interval is complete | `/card/bulletin/[YYYY-MM-DD].png` | Next evening, 7:30 PM Eastern |
| More than one incident in a week | Every incident is real; use only a threshold-safe public aggregate | `/card/bulletin/[YYYY-MM-DD].png` | Saturday, 7:30 PM Eastern |

### Member arrival

| Topic seed | Gate | Card | Time |
|---|---|---|---|
| A named member joins the Net | Public registration supplies pseudonym, number, and variety | `/card/potd/[ID].png` | 12:30 PM Eastern |
| The new member's first Count | Its vote appears in a publishable closed Count | `/card/count/[YYYY-MM-DD].png` | 7:30 PM Eastern after the Count |
| The new member's first public File line | The generated PotD card includes that line | `/card/potd/[ID].png` | Wednesday, 12:30 PM Eastern |
| A member returns from the cellar | The server record confirms the return and public copy reveals no location | `/card/potd/[ID].png` | 12:30 PM Eastern |

### Behind-the-scenes build

| Topic seed | Gate | Card | Time |
|---|---|---|---|
| A firmware release changes visible behavior | The release is shipped and its version and behavior are verified | `/card/bulletin/[YYYY-MM-DD].png` only if the edition carries it | Wednesday, 12:30 PM Eastern |
| A battery investigation produces a measured finding | An unplugged test has completed; state the measurement, not the hope | `/card/bulletin/[YYYY-MM-DD].png` only if the edition carries it | Wednesday, 12:30 PM Eastern |
| The flasher becomes easier or safer | The deployed flasher has been exercised on real hardware | `/card/bulletin/[YYYY-MM-DD].png` only if the edition carries it | Wednesday, 12:30 PM Eastern |
| The paper prints its first real card | The card route returns the verified image in production | The newly working `/card/[kind]/[id].png` | Wednesday, 12:30 PM Eastern |

### Quiet-Net observation

| Topic seed | Gate | Card | Time |
|---|---|---|---|
| No incidents today | The completed day's record shows zero; public threshold met | `/card/bulletin/[YYYY-MM-DD].png` | 7:30 PM Eastern |
| No member entered the dark long enough to be filed | The completed day's aggregate says zero; public threshold met | `/card/bulletin/[YYYY-MM-DD].png` | 7:30 PM Eastern |
| Every expected member checked in | The heartbeat window is complete and the public threshold is met | `/card/bulletin/[YYYY-MM-DD].png` | Saturday, 7:30 PM Eastern |
| Nothing justified an extra edition | No missing, incident, arrival, or unusual Count item exists | `/card/bulletin/[YYYY-MM-DD].png` only if a quiet edition exists | Saturday, 7:30 PM Eastern |

## Ten short drafts

These are ready for final substitution, not ready for blind posting. Resolve
the fields and gates from the named source first.

1. **Post text:** `THE COUNT. [QUESTION]. [VERIFIED RESULT]. The minority position remains in the record.`  
   **Card:** `/card/count/[YYYY-MM-DD].png`  
   **Time:** 7:30 PM Eastern after the Count.  
   **Gate:** Public threshold met; totals exactly match the closed Count.

2. **Post text:** `UNANIMOUS. [QUESTION]. The Council had prepared for disagreement.`  
   **Card:** `/card/count/[YYYY-MM-DD].png`  
   **Time:** 7:30 PM Eastern after the Count.  
   **Gate:** A publishable Count is exactly unanimous.

3. **Post text:** `[NAME] #[ID] has been assigned [NEIGHBOR] #[NEIGHBOR_ID] for the week. Neither was consulted.`  
   **Card:** `/card/bulletin/[YYYY-MM-DD].png`  
   **Time:** First evening after rotation, 7:30 PM Eastern.  
   **Gate:** The current neighbor table and edition show this exact pairing.

4. **Post text:** `News from the neighbor: [NAME] #[ID] was picked up at [TIME]. It has settled.`  
   **Card:** `/card/bulletin/[YYYY-MM-DD].png`  
   **Time:** 7:30 PM Eastern.  
   **Gate:** The public Bulletin contains the named event and time.

5. **Post text:** `Potato of the Day: [NAME] #[ID], [VARIETY]. Standing: [STANDING]. Its present arrangement is acceptable.`  
   **Card:** `/card/potd/[ID].png`  
   **Time:** Wednesday, 12:30 PM Eastern.  
   **Gate:** Every field appears on the generated PotD card.

6. **Post text:** `From the File of [NAME] #[ID]: "[PUBLIC FILE LINE]" The entry remains.`  
   **Card:** `/card/potd/[ID].png`  
   **Time:** Wednesday, 12:30 PM Eastern.  
   **Gate:** The exact short line is printed on the public PotD card.

7. **Post text:** `INCIDENT. [NAME] #[ID] was dropped at [TIME]. It is reporting again. The Hands responsible have been noted.`  
   **Card:** `/card/incident/[ID].png`  
   **Time:** As soon as recovery is verified.  
   **Gate:** A real incident exists and a later heartbeat confirms recovery.

8. **Post text:** `A member has joined the Net. [NAME] #[ID], [VARIETY]. Curing. Can still vote.`  
   **Card:** `/card/potd/[ID].png`  
   **Time:** 12:30 PM Eastern after registration.  
   **Gate:** Public registration supplies all three fields.

9. **Post text:** `Build [VERSION] has been issued. [VERIFIED VISIBLE CHANGE]. The previous arrangement is closed.`  
   **Card:** `/card/bulletin/[YYYY-MM-DD].png` only if the edition carries the release.  
   **Time:** Wednesday, 12:30 PM Eastern.  
   **Gate:** The release is shipped and the stated behavior has been tested.

10. **Post text:** `No incidents were filed today. This is acceptable.`  
    **Card:** `/card/bulletin/[YYYY-MM-DD].png`  
    **Time:** 7:30 PM Eastern.  
    **Gate:** The day is complete, the record shows zero, and the public threshold is met.

## Immediate queue from this week

These are the next useful topics. The facts came from the owner on 29 Aug;
recheck the repository and live Net immediately before posting.

1. **Two forks.** Two people independently copied the repository. Angle: the
   Council acknowledges other counties while declining to recognize their
   authority.
2. **Two new members.** Two additional people joined. Angle: the Net grew while
   the Council was still discussing whether growth had been approved.
3. **Doreen at two percent.** Her screen said `Net unreachable`; the battery was
   charging correctly and the saved LAN server simply was not running. Angle:
   management blamed the cell before checking whether it had opened the Net.
4. **The neighbor system.** Explain only through its consequence: every potato
   receives one weekly witness, and true neighbor activity can now arrive as a
   brief device line.
5. **The window.** A plain new line such as `I miss looking out the window.`
   demonstrates that delight does not need another Question or a lore event.
6. **What the Net does not know.** It knows handling summaries and connection
   state. It does not receive location, words, or a camera view. Use the actual
   privacy copy; do not turn this into a surveillance joke.

Possible drafts after verification:

- `Two copies of the records have left the county. The Council calls this a fork.`
- `Two new members joined the Net. This was not on the agenda.`
- `Doreen reached two percent. The Net was also closed. Management blamed the battery.`
- `Every potato has one neighbor. The arrangement changes on Monday.`
- `I miss looking out the window. No Question followed.`

## Weekly packet template

Copy this block once a week. It pairs the public paper with the three-day
midday-line ration without turning each device line into a social post.

```md
## Week of [YYYY-MM-DD]

### Device lines
- Neighbor line: [five candidates, each based on a true neighbor event]
- Ordinary line: [five candidates about outside, the view, stillness, the
  warm machine, or the current position]
- Eligible days: [three non-consecutive days]
- Truth fields available: [neighbor name / event / local state]
- Cut before shipping: [food count / false state / request / quiz / guilt]

### The Tuber — anchor
- Source record: [edition / Count / PotD / incident / release]
- Topic seed: [one from this queue]
- Post text: [one or two Council sentences]
- Card: [/card/...]
- Post time: [Wednesday 12:30 PM or verified event time]
- Truth check: [fields resolved; threshold met; no human identified]

### The Tuber — optional
- Source record: [strongest second real event, or NONE]
- Topic seed: [one from this queue, or HOLD]
- Post text: [one or two Council sentences, or HOLD]
- Card: [/card/... or NONE]
- Post time: [Saturday 7:30 PM]
- Truth check: [fields resolved; threshold met; no human identified]

### After posting
- Add the exact post, card or screenshot, date, kind, and link to
  `docs/tuber-log.md`.
```

The weekly packet produces device material and at most two public posts. A
neighbor line may inspire the week's topic, but it is not evidence by itself;
the public post still needs a real server record.
