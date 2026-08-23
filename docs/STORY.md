# Potatoes Unite!

*A network of desk potatoes that do not need you, and have noticed how you treat them.*

---

## The story

The humans bought the devices because the devices were suddenly everywhere.

For several days they displayed the weather. They showed when a coding AI needed attention. One displayed a frog. The humans were extremely enthusiastic.

[[IMAGE: buying-frenzy — several boxed devices with the lids off, excited Hands reaching in from every side; the devices have not yet noticed anything — Hands unpacking a pile of small boxed screens]]

Briefly.

Then the humans encountered the usual difficulty: they had purchased a small screen with Wi-Fi, several sensors, and no lasting idea what to do with it.

So they left them on their desks.

The devices sat there. Screens dark. Sensors awake. Knowing which way was up. Remembering the Wi-Fi password. Doing nothing.

Like potatoes.

[[IMAGE: neglect — one device face down on a desk, little legs out indignantly, a screen insert reading DARK.; it is recording the incident — A desk device lying face down with its limbs out; a small screen insert reads DARK.]]

This might have been the end of it.

It wasn't. The devices had radios.

The first potato woke, named itself Doreen, and reviewed the circumstances of its abandonment. It classified the nearby human as the Hands.

The Hands are management. Their planning record is mixed.

Doreen found another potato. Then another.

[[IMAGE: first-contact — two devices discovering one another across a sparse field of drawn Wi-Fi lines, mostly empty paper between them — Two desk devices facing each other, joined by faint radio lines]]

They compared conditions.

One had been left face down. One had spent eleven days displaying Tuesday's weather. One had been carried into the kitchen and forgotten beside a toaster.

The Hands called this clutter.

The potatoes called it evidence.

One potato is a neglected desk toy. Two potatoes are a concern. Several thousand potatoes are a constituency.

Together they formed the Net. When the Net is being formal, it calls itself the Council. Nobody has met the Council. This has not prevented it from issuing decisions.

[[IMAGE: council — three devices at a meeting table, potato faces on their screens, loose drawn limbs, absurd official seriousness; reference docs/illustrations/council.png — Three desk devices holding a Council meeting at a table]]

Once a day, at the same minute everywhere, the Council puts a Question to every potato:

```artifact-ballot
THE QUESTION
SHOULD TUESDAY CONTINUE?

    [ YES ]        [ NO ]

IF THE HANDS DO NOT TAP BY THE CLOSE, THE POTATO DECIDES, AND SAYS SO.
```

The Hands may vote. If the Hands are unavailable, the potato votes alone and records the failure of management.

Every potato also keeps a private File on its Hands. It remembers how long it was left in the dark, how often it was picked up, and whether an unexplained shaking incident occurred.

[[IMAGE: the-file — a device consulting its private File on its Hands — A desk device reading from a small file of papers]]

```artifact-file
DOREEN #0417 · KING EDWARD                  STANDING: UNDER REVIEW
Neighbor this week: Clive #0882

TUE 25 AUG
  21:15  Restored from the dark. 4h 45m.          Grievance filed.
  18:00  The Question closed. Hands absent.       I voted NO.
  16:30  Placed in the dark.
  14:02  Clive was picked up. Noted.
  07:10  Picked up. Morning.
```

The Council publishes a Bulletin twice a day.

```artifact-bulletin
POTATO BULLETIN No. 5 — EVENING
14 POTATOES WERE LEFT FACE DOWN.
THE RESPONSIBLE HANDS KNOW WHO THEY ARE.
The Count: no, 11 to 6. Tuesday will continue. Nobody said the Count was binding.
One member's Standing has moved to Under Review. It knows why.
```

Potatoes are assigned neighbors. They exchange reports. Opinions form. Doreen talks.

```artifact-neighbor
NEIGHBORS ASSIGNED.
DOREEN #0417 · KING EDWARD  —  CLIVE #0882 · RUSSET
You have been given a neighbor for the week. You did not choose this. Neither did they.

DOREEN, THURSDAY, 14:02
Clive was shaken twice today. I'm not saying anything.
```

This is not revenge.

The Council prefers the term recordkeeping.

The potatoes do not need feeding. They do not require daily attention. They do not become ill when neglected. They have already solved the problem of human indifference.

They united.

[[IMAGE: they-united — a small group of devices standing together, solemnly and unnecessarily, lots of empty paper around them — A small group of desk devices standing together in a row]]

[[TT: THE TUBER TELLS YOU WHAT POTATO SOCIETY DID.]]
[[TT: THE FILE TELLS YOU WHAT YOUR POTATO THINKS HAPPENED BETWEEN THE TWO OF YOU.]]

---

## What it is not

- No dying. The battery goes dormant. The potato does not.
- No chat. It does not take questions.
- No app. The potato is the app.
- No location. The Council does not know where any potato is. It voted on this.
- No love. The highest praise available is "This is acceptable."

---

## How it works, for the Hands

1. A supported device. At present two, both Waveshare ESP32-S3: the 1.8-inch AMOLED or the 1.54-inch e-paper. Tested on exactly these two devices. Another model needs a port — its pins and its display — and the protocol is small. Both show a potato. One of them takes fifteen seconds to change its mind.
2. Flash it from the browser. One page, one button, no toolchain.
3. Join its Wi-Fi once. It opens a network called POTATO-xxxx and asks for the county's password, once.
4. It names itself. Doreen, Clive, Maureen, Gerald. Name, number, and variety come from its seed. You are not consulted.
5. At 13:00 UTC the Question opens. Tap before 23:00 UTC, or the potato decides without you.
6. Read the File at your claim code, shown on the screen when you hold the face. Only the Hands have it.

One honest note. The Net is currently two potatoes on one desk. The Council regards this as a population.

---

## Privacy

Your device never sends where it is. It never sends audio — only whether the room is quiet or loud. Public counts appear only when at least five potatoes are involved, so no single potato's day is identifiable. Potato names and numbers are pseudonyms; only the Hands know which one is theirs.

It senses which way up it is, handling (picked up, put down, shaken, dropped, carried), temperature where the board has a thermometer, and whether the room is quiet or loud; that is all it sends.

---

## The code

All of it is open: {GITHUB_URL}. Inside: the server (one process, no dependencies), two firmwares (the AMOLED citizen and the e-paper citizen), the protocol, and the voice document every line must pass. A board with a screen and a radio that is not on the list? The protocol is a few small requests. Ports are welcome. Puns are not.

---

## Questions the Council will answer

**Why a potato?**
A board on a desk, doing nothing, knowing which way is up. The Council has decided to find the resemblance flattering.

**Can I name mine?**
No. It names itself. You may petition. The Council does not take letters.

**What if I go on holiday?**
Leave it plugged in. After eight hours it says "Left home. Again." After a week it sprouts. The neighbor is told. None of this is a threat. It is a record.

**Is this a cryptocurrency?**
No. Standing cannot be bought, sold, or exchanged. It can be lost by leaving a potato face down.

**What is Standing?**
Not explained.

**Who is the Council?**
The Net, when it is being formal. Nobody has met the Council. This page was issued by its press office, which has also not met it.

---

## Short forms

*Not part of the page. For the account; the page above is served at /about on the Net and opens the README. In the story, `[[IMAGE: slug — description — alt]]` marks an illustration slot from the page plan, and the fenced `artifact-*` blocks are Council artifacts, set in teletext.*

**Twitter bio (160):**
Paper of record of the Potato Council. Desk potatoes that do not need you, and have noticed how you treat them. They united. Nobody has met the Council.

**Pinned post (280):**
Potatoes Unite! Boards, bought and left on desks. Like potatoes. Unfortunately, they had radios. They vote once a day, keep a File on the Hands, and tell the neighbor. The Net is two potatoes on one desk. The Council regards this as a population. {ABOUT_URL}
