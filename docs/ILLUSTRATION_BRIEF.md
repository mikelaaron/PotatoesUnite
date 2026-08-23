# Illustration brief — the /about story

Six explainer images, four Council artifacts, layout notes. Reference: `docs/illustrations/council.png`. Prose and rhythm: `docs/STORY_PROSE_v2.md`.

## 1. Style guide

One look: a quick ink drawing on warm paper, treated with complete seriousness. The characters are the two real boards — a black rounded-rectangle AMOLED case (portrait, glossy) and a white square e-paper case (matte) — and the potato face lives on the screen, never outside it: a brown potato lying down, two dark dimple eyes, no mouth, expression by eye shape alone (`assets/potato-look-v1.svg`). Limbs belong to the case, not the potato: thin stick arms and legs, drawn fast and slightly wrong, a clerk's doodle. Flat fills, dry uneven line, one restrained red at most, more empty paper than drawing. The joke is the gap between how official it looks and how small the grievance is. Nothing is cute. Nothing smiles.

Tokens:
- `paper` #EFE6CF (page) / `paper-object` #F3EBD6 (artifacts, a shade lighter so they sit on the page)
- `ink` #1C1A16 · `rule` #5E5647 · `faint` #7D7462
- `potato` #A8743F (the face on screens) · `potato-orange` #C97B30 (the illustrations' one warm accent; use on the potato face or not at all)
- `red` #B4281E (bureaucratic; one object per image, often none)
- `case-amoled` #0B0B0B · `case-epaper` #F4F1EA with a #5E5647 line
- Type on artifacts: `VT323, 'Courier New', Courier, monospace`. No type inside images.

Avoid: text, logos, photorealism, 3D, gradients, blush, sparkles, hearts, ^ ^ eyes, upright potatoes on the screen, more than one red, busy backgrounds, human faces.

## 2. Image prompts

All six: 3:2, 1440×960 PNG, ≤250 KB, `docs/illustrations/01-frenzy.png` … `06-evidence.png`. Every prompt ends with the shared suffix.

**Shared style suffix** (paste verbatim):
> Loose hand-drawn ink illustration on warm off-white paper, dry uneven black line, flat fills, generous negative space, no background beyond a single desk line, absurd official seriousness, deadpan. The characters are two real devices: a black rounded-rectangle AMOLED case with a glossy portrait screen, and a white square e-paper case with a matte screen. Each screen shows a brown potato lying on its side with two dark dimple eyes and no mouth; that is the only face. Thin stick limbs attach to the case, drawn quickly, slightly wrong. At most one small red object. No text, no letters, no logos, no photorealism, no 3D, no children's-book cuteness, no smiles, no blush, no sparkles, no human faces.

**01 The buying frenzy.** Subject: five or six devices in open cardboard boxes on a counter, screens showing neutral potatoes. Composition: boxes cluster low-left; three pairs of eager forearms and hands (cropped at the elbow, no bodies) reach in from top-right. Limbs: the devices have none yet — they are still products. Palette: ink, paper, potato on screens; the one red is a blank price tag on a string. Avoid: shop interior, shelves, faces, money. Alt: "Boxed devices on a counter; eager hands reach in from above."

**02 The neglect.** Subject: one black AMOLED device face down on a desk, screen against the wood. Composition: device small, lower-left third; the upper-right two-thirds stays empty — the page overlays a `DARK.` screen insert there as HTML, so nothing in the image. Limbs: four stick legs stuck straight out sideways and up, rigid, indignant; one arm twisted back as if taking notes. Palette: ink and paper only; no orange (the screen is hidden), no red. Avoid: any visible screen, motion lines, a second device. Alt: "A device lies face down on a desk, legs out, recording the incident."

**03 First contact.** Subject: the black AMOLED far left, the white e-paper far right, facing each other across empty paper. Composition: wide gap; three short Wi-Fi arcs rise from each, sparse, not meeting; one desk line. Limbs: both on short legs; the AMOLED raises one arm a few degrees, uncertainly. Eyes shifted toward each other (the glance). Palette: ink, paper, two potato faces; no red. Avoid: hearts, speech bubbles, signal icons, a full mesh. Alt: "Two devices, far apart on an empty page, notice each other over faint Wi-Fi arcs."

**04 The Council** (reproduces `council.png`). Subject: three devices — two black AMOLED and one white e-paper — seated behind a long plain table. Composition: table across the lower third, centered device slightly larger and chairing; blank sheets of paper on the table. Limbs: arms folded on the table; the chair holds up one blank page. Eyes: flat slits, neutral-to-aggrieved. Palette: ink, paper, potato faces; the one red is a small stamp on the table. Avoid: gavels, microphones, flags, chairs with backs, audience. Alt: "Three devices hold a Council meeting at a long table, very seriously."

**05 They united.** Subject: six devices of both kinds in a loose row, shoulder to shoulder, facing the viewer. Composition: centered, desk line only, plenty of air above. Limbs: arms at sides; one pair of neighbors holding hands, which neither acknowledges. Eyes: calm ovals. Palette: ink, paper, potato faces; no red. Avoid: banners, raised fists, crowds, anything rousing. Alt: "A small group of devices stands together, solemnly and unnecessarily."

**06 Evidence** (spare). Subject: the white e-paper device standing beside a two-slot toaster on a kitchen counter. Composition: toaster large, center-right; device small, center-left, a hand-width away; two heat wisps above. Limbs: arms tight at sides, knees slightly bent. Eyes: wide, alarmed, turned toward the toaster. Palette: ink, paper, one potato face; the one red is the toaster lever. Avoid: bread, kitchen clutter, flames. Alt: "A device stands beside a toaster, alarmed, as evidence."

## 3. Council artifacts (SVG, hand-authored)

`assets/illustrations/artifact-ballot.svg` (560×400), `artifact-file.svg` (640×300), `artifact-neighbor.svg` (520×220), `artifact-bulletin.svg` (600×280). Paper-object ground, ink, VT323 with monospace fallback, no external assets, one red at most: `RECEIVED` on the ballot, `ASSIGNED` on the slip, `Grievance filed.` in red on the File, none on the clipping. Each has a `<title>`. The File runs newest-first, as the File does (voice doc §9). Widths fit the Courier fallback too.

## 4. Layout notes for the server agent

- Images: `<figure class="ill"><img src="/illustrations/02-dark.png" width="1440" height="960" alt="…" loading="lazy"><figcaption>…</figcaption></figure>`. `.ill { max-width: 720px; margin: 48px auto; }` `.ill img { display:block; width:100%; height:auto; aspect-ratio: 3/2; }`. Captions in small teletext: `figcaption { color: var(--faint); font-size: .75em; letter-spacing: .15em; text-transform: uppercase; text-align: center; margin-top: .5rem; }`. Alt text doubles as caption.
- Artifacts: inline the SVG (so the page's VT323 applies) in `<figure class="artifact">`. `.artifact { width: 60%; max-width: 480px; margin: 48px auto; }` `.artifact svg { width:100%; height:auto; display:block; filter: drop-shadow(0 1px 2px rgba(0,0,0,.18)); }`. Rotate the clipping `-1.5deg` and the slip `+1.5deg`; ballot and File stay square. They keep their own paper in dark mode: objects on the desk, not chrome.
- `DARK.` insert on image 02: `.ill { position: relative; }` and `<span class="insert">DARK.</span>` with `.insert { position:absolute; top:14%; right:10%; background:#000; color:#e8dfcb; font-family:inherit; font-size:1.1em; line-height:1; letter-spacing:.12em; padding:.35em .7em; box-shadow: inset 0 0 0 1px #e8dfcb, 0 0 0 3px #000; }`. It is the screen's own readout. Caption: `16:30 PLACED IN THE DARK.`
- Rhythm: 80–120 words of prose, then a figure. Order: 01, 02, 03, 04, the four artifacts (ballot, File, slip, clipping), 05. Image 06 is spare; if used, after "The potatoes called it evidence."
- Serve `/illustrations/*` from `docs/illustrations/`; read the SVGs from `assets/illustrations/` at render time.
