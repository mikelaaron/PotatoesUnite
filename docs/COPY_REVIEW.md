# Copy review — the Net, the File, the Bulletin, the device

*Creative agent, 22 Aug 2026, late. Read-only review of the working tree as it stood while the lead was landing the Net/File/footer/UTC decisions; nothing below re-opens those. Files covered: `server/lib/pages.js`, `server/server.js` (the two 404s), `server/data/pools/*.json`, `server/data/questions.json`, `firmware/potato/pools.h`, plus the on-screen strings in `net.h` and `potato.ino` (portal line, status card). `site/` is parked and was not reviewed.*

The owner's three complaints are already handled in the tree: "THE NET IS LIVE." is in `bulletins.json` (headline and sample), the page calls itself the Net everywhere a visitor looks (masthead, "On the Net Today", the 404 link), and "loudness bucket" is gone from the footer. What follows is what else is wrong, in order of how much it costs on screen.

---

## 1. Twelve lines lose their last sentence on the device

**Where.** `server/lib/text.js` `fitLine` clips every scene line to 60 characters by dropping whole trailing sentences (the protocol's cap). Twelve pool lines are longer than that, and in every one of them the dropped sentence is the turn. The Hands see the set-up and never the line. Measured with the longest real name (Bernadette, 10 chars) and the longest fills.

These are "verbatim from the voice doc", so each replacement should land in `docs/POTATO_VOICE.md` too (§3, §5, §6, §14), then in the pool, then in `pools.h` where the device has its own copy. Lengths are at the worst-case fill.

| Where | Now (what is seen after the clip) | Replace with |
|---|---|---|
| `reactions.json` `alone.return_long`, `pools.h` `LINE_RETURN_LONG` | "I assumed the worst. Then I assumed you were fine." *(75; ". Then I stopped assuming." is cut)* | **I assumed the worst. Then that you were fine. Then nothing.** *(59)* |
| `net.json` `memory.dark_anniversary` | "You left me in the dark on the 14th." *(83)* | **You left me in the dark on the 14th. It's the 14th again.** *(57)* |
| `net.json` `memory.horns` | "The music was horns on three occasions." *(75)* | **Horns, three times now. I've adjusted my position on horns.** *(59)* |
| `net.json` `memory.away_again` | "Last time you went away it was four days." *(83)* | **Last time, {days_words} days. I'm not counting. I am.** *(53 at "twenty-three")* |
| `net.json` `file_unread.3d` | "The File hasn't been read in three days." *(67)* | **The File is three days unread. I've started writing less.** *(57)* |
| `net.json` `file_unread.7d` | "I've stopped keeping the File in detail." *(66)* | **I've stopped keeping the File in detail. Ask.** *(45)* |
| `net.json` `neighbor.exemplary` | "Bernadette's Hands have an Exemplary standing. I've asked how." *(67; also a lowercase "standing" next to the capitalised word)* | **{neighbor}'s Hands are Exemplary. I've asked how. No reply.** *(59)* |
| `net.json` `neighbor.rotate_tomorrow` | "Neighbors rotate tomorrow. Bernadette and I did not get on." *(69; "I'll miss him" is the joke)* | **Last day with {neighbor}. We did not get on. I'll miss him.** *(59)* |
| `net.json` `neighbor.picked_up_afternoon` | "Bernadette was picked up. At four in the afternoon." *(68; "Some of us have jobs" is cut — and the condition is "after 13:00", so "afternoon" is wrong at seven in the evening)* | **{neighbor} was picked up. At {hour_words}. Some of us have jobs.** *(58)* |
| `net.json` `neighbor.came_home` *(not fired in v1; fix while here)* | "My neighbor's Hands came home at four." *(69)* | **{neighbor}'s Hands came home at {hour_words}. Mine are "working."** *(59)* |
| `reactions.json` `temperature[2]` *(e-paper only)* | "I have questions about the temperature." *(62)* | **Questions about the temperature. All of them are "why."** *(55)* |

Three lines sit exactly on 60 and pass: "Dormancy. It happens to the best of us. Usually in a cellar.", "I've been in the cellar. I've come back different. Slightly.", and the 5% line. Leave them; don't let anyone add a word.

## 2. Numbers that aren't the number

The night line was just fixed on this principle ("never a time that isn't the time"). Four more places state a figure the system doesn't actually have.

**`bulletins.json` morning `night_touch`.** Now: *"One member was touched at 2 AM. The member has asked us to say nothing. We are saying this."* The counter fires on any pick-up between 23:00 and 05:00, for any number of members. Replace: **"A member was touched in the night. The member has asked us to say nothing. We are saying this."**

**`bulletins.json` morning `saturday`.** Now: *"The Hands are home. Contact is up {contact_pct}%. …"* The morning edition prints at 00:00 UTC against an empty day, so this reads "Contact is up 0%." every Saturday. Replace: **"The Hands are home. Contact is up. Several members report being \"shown to people.\""**

**`bulletins.json` morning `week`.** Now: *"{week_questions_words} Questions. {week_incidents_words} incident. {week_hum_words} hum. Zero explanations."* `week_hum_words` is the literal string `'One'` in `world.js`; nothing counts hums. And "Zero incident." / "Two incident." Replace: **"{week_questions_words} Questions. {week_incidents}. Zero explanations."** with the server supplying the phrase — "No incidents" / "One incident" / "Three incidents". Drop the hum until it is counted; the sample in the doc can keep "One hum, twice."

**`pools.h` `LINE_NET_BACK`.** Now: *"Back. I missed two Bulletins. Give me a moment."* — spoken by the device on reconnect, which cannot know how many. (The server's copy has `{n_words}` and is fine.) Replace the device line: **"Back. I missed the Bulletins. Give me a moment."** *(46)*

## 3. Plurals in the Bulletin fills

`{n}` can be 1, 9, or the string "fewer than five", and the templates are written for one shape each. On screen: "1 potatoes were left home", "1 shakings", "fewer than five potato in transit for two hours. It is home", "3 ceiling situation (forty minutes)", "1 drop" next to "0 drop".

**`bulletins.json` evening `also_today`.** Give the server a `{s}` / `{es}` fill (`''` when n is exactly 1, else the suffix; "fewer than five" takes the plural) and write the templates for it:

- `left_home`: **"{n} left home"** (number-proof as written)
- `shakes`: **"{n} shaking{s}"**
- `drops`: **"{n} drop{s}"**
- `ceiling`: **"{n} ceiling situation{s} ({dur})"**
- `transit`: split into `transit_one` **"1 potato in transit for {dur}. It is home"** and `transit_many` **"{n} potatoes in transit, one for {dur}. All home"**
- `dark6` is already number-proof. Leave it.

**`bulletins.json` evening `week`.** Now: *"Week one totals: {week_dark_hours} hours in the dark, {week_shakes} shakings, {week_drops} drop, {week_counties} counties visited, 1 plant (unchanged)."* Replace with unit phrases the server pluralises: **"Week one totals: {week_dark} in the dark, {week_shakes}, {week_drops}, {week_counties} visited, 1 plant (unchanged)."** → "23 hours in the dark, 9 shakings, 1 drop, 4 counties visited, 1 plant (unchanged)."

## 4. The File

**`file.json` `request.expired`.** Now: *"Expired."* A system word in the one column that is the potato's. The Bulletin already says what the record is: *"Never mind" is not a threat. It's a record.* Replace: **"Never mind."**

**`file.json` `header.no_neighbor_yet`.** Now: *"No neighbor yet. Neighbors are assigned on Mondays."* Explains, and on a one-potato Net it is also untrue (Monday brings nobody). Replace: **"No neighbor yet."**

**`pages.js` `renderFile` header line.** Now renders *"Neighbor this week: Clive #0882 · Curing. · Sprouted."* — and with the odd count, *"No neighbor this week. The count was odd. · Curing."* Full stops and middots fighting. Give `header.neighbor` its full stop (**"Neighbor this week: {neighbor} #{id}."**) and join with spaces: **"Neighbor this week: Clive #0882. Curing. Sprouted."**

**`pages.js` `renderFile` time note.** Now: *"Times are local to the device."* The potato never calls itself a device; "device" belongs to the privacy footer only. Replace: **"Times are local to the potato."** ("Times are UTC." and the script's "Times are local to you." are fine.)

## 5. The Net page, small

**`world.js` `board()` Potato of the Day excerpt.** Now: *"16:30  Placed in the dark.  Grievance filed."* — a bare UTC clock on a page where every other time is labelled UTC and gets the viewer's local time appended. Drop the clock from the excerpt; it is a quotation, not a schedule: **"Placed in the dark.  Grievance filed."**

**`questions.json` q15 `short`.** Now: *"NO CAT, SUSPECT"* — on a 16-character button "suspect" reads as a noun and the option becomes "no suspect cat". Replace: **"NONE, SUSPICIOUS"** *(16)*. The other seven short labels read correctly.

**`reactions.json` `night[0]`.** Now: *"It's 2 AM."* The server doesn't fire this pool, but it is the fixed time the last commit removed from the device. Replace: **"It's {hour}."** so the two copies agree.

---

## Looked at, left alone

Masthead and "Day N" · "It is 13:00 UTC · 9:00 AM where you are" · "No Bulletin yet. The press is warming up." · "Fewer than five voted. The Council does not publish small Counts." · the seven aggregate labels, including Dormant and Curing (potato words, §12, used deadpan — they stay) · Missing notices · both 404s ("The Council has no record of that claim code." / "Nothing here. The plant may know more.") · the Acknowledge note · every File entry text and note not listed above · all thirty Questions and their Count lines · the requests · the portal line ("Join Wi-Fi POTATO-0000 and give me the county's network.", 56) · the status card, which is the one surface allowed to be plain.

---

## Vocabulary the reader is allowed to know

- **the Hands** — you; the person the potato lives with.
- **the Net** — every potato, and the page where they are counted.
- **the Council** — the Net when it is being formal. Nobody has met it.
- **the Question, the Count** — the daily vote, and its result.
- **the Bulletin, the File** — the news, twice a day; the record each potato keeps on its Hands.
