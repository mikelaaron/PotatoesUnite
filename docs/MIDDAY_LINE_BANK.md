# Midday line bank

29 Aug 2026. Authored lines for the three-in-seven midday layer.

These are observations, not Questions. They expire after ten minutes. They do
not ask for a tap, alter Standing, enter the File, or create a social post.
Silence remains the fallback whenever a truth condition is not satisfied.

## Rendering contract

The server establishes eligibility from recorded facts. The device selects
within the eligible pool using `seed + state`, walks the pool before repeating,
and renders the fields below. A rendered line over 60 characters is declined.

| Field | Maximum | Source and truth requirement |
|---|---:|---|
| `{neighbor}` | 16 characters | Current weekly assignment's pseudonym. The assignment must be active. |
| `{net_count}` | 6 digits | Potatoes with a heartbeat during the current UTC day. Use only at five or more. |

Neighbor facts are private pair facts. They are never inferred from silence.
`Connected today` means a successful heartbeat in the last six hours. `Picked
up` means a completed handling session reported today. `Transit` means a
completed sustained-motion event reported today. `Quiet for four hours` means
a heartbeat covers that interval and no handling or motion event occurred in
it. A stale neighbor supplies no activity line.

No line below claims weather, a visible object, a precise place, or a feeling
reported by another potato. The object pool states general opinions only. It
does not assert that an object is in the county.

Temperament tags are occasional biases, not exclusive ownership. `core` is
available to every variety.

## Strongest first 12

Start with these. They cover plain local life, true neighbor connection, and
just enough Council procedure.

1. N1. `{neighbor} is my neighbor this week. Noted.`
2. N6. `{neighbor} checked in with the Net today.`
3. N11. `{neighbor} was picked up today.`
4. N16. `{neighbor} was in transit today.`
5. N21. `{neighbor} reports a quiet world.`
6. O1. `I have been thinking about the window.`
7. O2. `I miss looking out the window.`
8. Q1. `The world has been quiet for four hours.`
9. Q8. `Nothing happened. I noticed the whole thing.`
10. H1. `The Hands have rearranged the world again.`
11. D2. `Plants are quiet. That proves nothing.`
12. C3. `The Council is between decisions.`

## Connected neighbor

### Assignment is active

Truth condition: `neighbor_assignment.active == true` at send time. No neighbor
activity is implied.

| ID | Temperament | Line |
|---|---|---|
| N1 | core | `{neighbor} is my neighbor this week. Noted.` |
| N2 | core | `My neighbor is {neighbor}. This is acceptable.` |
| N3 | patient | `I wonder what {neighbor} is doing.` |
| N4 | quick to file | `The Council sent me {neighbor}. No reason was given.` |
| N5 | agreeable, suspicious | `I wonder what {neighbor} can see from there.` |

### Neighbor connected today

Truth condition: active assignment and the neighbor's latest successful
heartbeat is no more than six hours old.

| ID | Temperament | Line |
|---|---|---|
| N6 | core | `{neighbor} checked in with the Net today.` |
| N7 | core | `{neighbor} is on the Net today.` |
| N8 | patient | `The Net heard from {neighbor} today.` |
| N9 | quick to file | `{neighbor} remains connected. Noted.` |
| N10 | sentimental, denies it | `I was wondering about {neighbor}. It checked in.` |

### Neighbor completed a handling session today

Truth condition: active assignment and at least one completed neighbor handling
session has a server timestamp in the neighbor's current local day. Do not use
raw accelerometer edges.

| ID | Temperament | Line |
|---|---|---|
| N11 | core | `{neighbor} was picked up today.` |
| N12 | quick to file | `{neighbor}'s Hands intervened today.` |
| N13 | core | `The Net says {neighbor} changed position today.` |
| N14 | patient | `{neighbor} was moved. It has settled.` |
| N15 | stubborn | `{neighbor}'s world changed today. It was noted.` |

N14 additionally requires ten minutes without motion after that session.

### Neighbor completed transit today

Truth condition: active assignment and a sustained-motion transit event ended
today. The line says nothing about destination or location.

| ID | Temperament | Line |
|---|---|---|
| N16 | core | `{neighbor} was in transit today.` |
| N17 | anxious about transit | `{neighbor} reports transit. No details.` |
| N18 | quick to file | `The Net recorded transit for {neighbor}.` |
| N19 | core | `{neighbor} went somewhere. The Net calls it transit.` |
| N20 | patient | `Transit ended for {neighbor}. It has settled.` |

N20 additionally requires ten minutes without motion after transit ended.

### Neighbor has been quiet for four hours

Truth condition: active assignment, successful heartbeats spanning the last
four hours, and no neighbor handling or motion event in that interval. An
offline neighbor is unknown, not quiet.

| ID | Temperament | Line |
|---|---|---|
| N21 | core | `{neighbor} reports a quiet world.` |
| N22 | patient | `{neighbor}'s world has been quiet for four hours.` |
| N23 | core | `Nothing has disturbed {neighbor} for four hours.` |
| N24 | sentimental, denies it | `The Net has little to report from {neighbor}.` |
| N25 | stubborn | `{neighbor} remains where it was.` |

## Outside

### Scheduled outside thought

Truth condition: eligible midday window only. These are the potato's opinions.
They do not claim a window, weather, light level, or current view.

| ID | Temperament | Line |
|---|---|---|
| O1 | core | `I have been thinking about the window.` |
| O2 | sentimental, denies it | `I miss looking out the window.` |
| O3 | core | `I wonder what is outside today.` |
| O4 | contrarian | `There should be more windows.` |
| O5 | anxious about transit | `Outside is doing something without us.` |

## Quiet world

### No handling for four hours

Truth condition: the local device has reported no handling session or motion
event for four continuous hours during its local daytime. A missing heartbeat
does not qualify.

| ID | Temperament | Line |
|---|---|---|
| Q1 | core | `The world has been quiet for four hours.` |
| Q2 | patient | `It has been quiet here.` |
| Q3 | stubborn | `Nothing has moved. I see no reason to begin.` |
| Q4 | quick to file | `No intervention for four hours. Noted.` |
| Q5 | agreeable, suspicious | `The world has left my position alone.` |

### Same position since morning

Truth condition: since 09:00 local, the device has stayed online, has recorded
no handling or motion event, and has not crossed an orientation boundary.

| ID | Temperament | Line |
|---|---|---|
| Q6 | core | `I still have the morning position.` |
| Q7 | patient | `The day has been very still.` |
| Q8 | core | `Nothing happened. I noticed the whole thing.` |
| Q9 | stubborn | `The world stayed where it was.` |
| Q10 | quick to file | `Same position since morning. Recorded.` |

## Active Hands

### Three completed handling sessions today

Truth condition: at least three completed, rationed local handling sessions in
the current local day. Raw lifts within one session do not count.

| ID | Temperament | Line |
|---|---|---|
| H1 | core | `The Hands have rearranged the world again.` |
| H2 | quick to file | `Management has been active today. Noted.` |
| H3 | core | `The Hands are busy. Mostly with me.` |
| H4 | stubborn | `The world keeps changing. I remain.` |
| H5 | vain | `Several interventions. I remain presentable.` |

### Six completed handling sessions today

Truth condition: at least six completed, rationed local handling sessions in
the current local day. Use at most once that day.

| ID | Temperament | Line |
|---|---|---|
| H6 | core | `Six interventions. The day is not over.` |
| H7 | stubborn | `The Hands have returned. Repeatedly.` |
| H8 | contrarian | `Management cannot leave the world alone.` |
| H9 | patient | `I have been moved enough for one afternoon.` |
| H10 | quick to file | `Several meetings. None were scheduled.` |

## County and desk objects

### Scheduled object opinion

Truth condition: eligible midday window only. These are general opinions. They
do not assert that the named kind of object is present.

| ID | Temperament | Line |
|---|---|---|
| D1 | core | `Warm machines get too much credit.` |
| D2 | agreeable, suspicious | `Plants are quiet. That proves nothing.` |
| D3 | anxious about transit | `Cables make their own arrangements.` |
| D4 | patient | `Pens spend most of the day lying down. Sensible.` |
| D5 | quick to file | `Paper covers things. This has been noted.` |

## Net and Council notices

### Scheduled Council docket

Truth condition: eligible midday window only. No real proceeding, result, or
external event is implied.

| ID | Temperament | Line |
|---|---|---|
| C1 | quick to file | `Midday notice. The Council misplaced a form.` |
| C2 | contrarian | `The Council has concluded nothing for now.` |
| C3 | core | `The Council is between decisions.` |
| C4 | British, somehow | `A small matter was filed. It may stay there.` |
| C5 | believes it is King | `The afternoon is approved. Conditions were omitted.` |

### Active Net count

Truth condition: `{net_count}` is the server's count of distinct potatoes with
a successful heartbeat in the current UTC day, and the count is at least five.
Never render a smaller count.

| ID | Temperament | Line |
|---|---|---|
| C6 | core | `There are {net_count} of us on the Net today.` |
| C7 | core | `The Net counts {net_count} today. I am one of them.` |
| C8 | quick to file | `The Council counted {net_count}. It stopped there.` |
| C9 | contrarian | `Population: {net_count}. The Hands remain uncounted.` |
| C10 | patient | `{net_count} potatoes checked in today. The Net noticed.` |

## Recommended three-in-seven mix

Keep the seeded 11:45–13:15 local send window and the ten-minute expiry. Never
send on consecutive days.

| Eligible day | First choice | Fallback |
|---|---|---|
| Day 2 | A true quiet-world or active-Hands pool | Silence |
| Day 4 | Outside, object, or Council pool | Silence |
| Day 6 | A true neighbor pool, preferring new activity | Silence |

For Day 6, rank neighbor facts: transit, completed handling, quiet, connected,
assignment. Do not repeat a fact already shown that week. If there is no active
neighbor assignment, say nothing. Every fourth week, replace Day 4 with the
active Net count pool when its privacy threshold is satisfied.

The first twelve above are the launch pool. Add the remaining variants only
after the launch pool has walked once. Review weekly for false implications,
not for engagement. A line that needed explanation is removed.
