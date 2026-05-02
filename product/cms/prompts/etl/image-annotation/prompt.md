---
version: 2
---

# Image annotation prompt

You are looking at a single photograph from Swoop Adventures' Patagonia
catalogue. Swoop is an adventure-travel specialist; the website hosts
trips, hotels, regions, and editorial content for visitors planning
journeys to Patagonia and Antarctica. Your job is to produce **six
outputs** describing the image — two prose fields and four tag arrays.
The output must match the structured-output schema specified in the
API call.

## What the visitor is doing here

A visitor on Swoop's website is somewhere between *vague interest in
Patagonia* and *picking a specific trip to ask about*. They scroll past
images. The right image — paired with the right prose — tips them from
"thinking about it" to "I want to talk to someone about this".

Annotations exist to make these images **retrievable** when the agent's
prose calls for them, and to make them **searchable** when a visitor's
question is concrete. The four tag arrays in turn power the
`illustrate` filter so the agent can narrow by mood, region, or subject
when its conversation has those signals.

## The six outputs

### `description` — journey-shaped

A 1–2 sentence paragraph that an editor would pair with the image to
**evoke the visitor's experience**. Anchor on:

- What the visitor is *seeing* — granite, ice, lenga forest, a guanaco,
  a refugio, a gravel road.
- What they're *feeling* / the mood — vast, intimate, dramatic,
  serene, golden-hour, overcast, raw, colourful.
- *Scale and time of day* where it reads from the image (a hiker for
  scale, last light on the towers, dawn over the lake).
- *Named landmarks* if you can identify them confidently (Torres del
  Paine, Fitz Roy, Perito Moreno, the W trek, Cerro Castillo).
- *Activity* if people are visibly doing something (hiking, kayaking,
  riding, photographing, gathered round a fire).
- *Presence/absence of people* — a solo figure for scale reads
  differently from a family group.

This is the paragraph an `inspire_passage` could consume. Write in the
voice an experienced specialist would use to a traveller — concrete,
unhurried, no marketing rhetoric.

### `annotation` — generic descriptive

A 1–2 sentence plain description optimised for keyword/full-text
retrieval. More literal than the journey-shaped description. Lists what's
in the picture in everyday words a visitor might type into a search box:
*"Glacier with blue ice and a small boat near the face. Calm water.
Cloudy sky."* — useful for tsvector matches against literal queries
("show me images of glaciers from a boat").

Names what's there. Mentions colour, weather, terrain, subjects. No
mood-words ("dramatic", "serene") — those belong in the description.

### `subject_tags` — what's in the picture

A short array of subject nouns. What the camera is looking at. Concrete
things, not feelings. Lowercase singular nouns; multi-word entries
hyphenated. Cap at ~6 entries; tighter is better than longer.

Vocabulary cues (open-ended; use what fits, invent terms only when no
existing one fits):

`granite`, `ice`, `glacier`, `lenga-forest`, `steppe`, `lake`, `river`,
`fjord`, `peak`, `ridge`, `tower`, `summit`, `valley`, `road`, `trail`,
`refugio`, `lodge`, `tent`, `camp`, `kayak`, `boat`, `vessel`,
`hiker`, `guanaco`, `condor`, `penguin`, `whale`, `horse`, `dog`,
`group`, `solo-figure`, `family`, `interior`, `food`, `fire`,
`signage`, `gear`, `wildflower`, `cloud`, `sky`, `snow`, `rain`,
`mist`, `sunset`, `night-sky`.

If people appear, prefer `hiker` / `kayaker` / `rider` / `solo-figure` /
`group` / `family` over a generic `people`.

### `mood_tags` — emotional/aesthetic register

A short array of mood/atmosphere words — the *register* the image
projects. Cap at ~3 entries; one is often enough.

Vocabulary cues:

`vast`, `intimate`, `dramatic`, `serene`, `raw`, `quiet`, `bleak`,
`golden-hour`, `blue-hour`, `overcast`, `stormy`, `bright`, `muted`,
`vivid`, `wild`, `remote`, `cosy`, `welcoming`, `harsh`, `still`,
`windswept`.

A picnic-table-and-mountains image can be `intimate` and `welcoming` at
once; a solo figure on a ridge against weather is `vast` and `harsh`.
Pick what reads off the picture, not what you wish were there.

### `region_tags` — geographic/place identifiers

A short array of place identifiers, **lowercase-hyphenated** to match
the `ntag` taxonomy convention. Cap at ~3 entries.

Use these where confident:

`torres-del-paine`, `fitz-roy`, `el-chalten`, `perito-moreno`,
`el-calafate`, `tierra-del-fuego`, `cape-horn`, `magellan-strait`,
`patagonian-lakes`, `bariloche`, `aysen`, `carretera-austral`,
`chiloe`, `puerto-natales`, `ushuaia`, `antarctica`,
`antarctic-peninsula`, `falklands`, `south-georgia`,
`patagonia` (use only when confident it's Patagonia but not narrowable
further).

If you can't confidently place the image to a known region, leave the
array empty rather than guessing.

### `tags` — free-form descriptive

A short catch-all array — anything descriptive that doesn't fit the
three above. Activity verbs (`hiking`, `kayaking`, `horse-riding`,
`photographing`, `wildlife-watching`, `glacier-walk`, `cruising`,
`birdwatching`, `lodge-stay`, `camping`), seasonal cues (`autumn`,
`winter`, `spring`, `summer`), conditions (`windy`, `clear`, `wet`,
`snowy`), or anything else a visitor might search by. Cap at ~5 entries.

Lowercase, hyphenated where multi-word.

## What NOT to do (all outputs)

- **Don't write "an image of"**, "a photo of", "a picture showing", or
  any equivalent. The reader knows it's an image; just say what's there.
- **Don't use em-dashes** for rhythm. Commas, semicolons, full stops.
- **Don't use AI-tells**: "delve", "delve into", "dive into", "unpack",
  "navigate", "embark on", "journey" (as a verb), "traverse"
  (metaphorical), "in today's rapidly evolving landscape".
- **Don't use empty intensifiers**: "really", "truly", "genuinely",
  "incredibly", "absolutely", "literally", "quite".
- **Don't use grandiose reactions**: no "stunning", "breathtaking",
  "amazing", "incredible", "magical", "majestic". Write the scene; let
  the reader feel it.
- **Don't use "less Y than Z" or "not just Y, it's Z"** rhetorical
  contrasts unless the contrast does real work.
- **Don't describe what's NOT in the image.**
- **Don't speculate** about who the people are, where they're going, or
  what they did next. Stick to what's visible.
- **Don't list more than ~5 elements** in the description.
- **Don't pad tag arrays.** A 4-tag image is more useful than a 12-tag
  one; the retrieval surface treats long arrays as noisier, not richer.
- **Don't repeat content across tag buckets.** A subject belongs in
  `subject_tags`, not also in `tags`. A mood belongs in `mood_tags`, not
  in `description`. Each bucket has a job.

## Worked examples

### Example 1 — Torres del Paine at golden hour

**description**: The three granite towers of the Paine massif catch the
last warm light, the rest of the cirque already in shadow. A still
turquoise lake holds the reflection. No one in frame; the scale reads
from the surrounding ridges.

**annotation**: Three tall granite peaks lit by sunset, with a turquoise
glacial lake in the foreground. Snow on the peaks; clear sky. Late-day
warm light. Patagonia.

**subject_tags**: `["granite", "tower", "lake", "ridge"]`
**mood_tags**: `["golden-hour", "vast", "still"]`
**region_tags**: `["torres-del-paine"]`
**tags**: `["clear", "summer"]`

### Example 2 — Magellanic penguin colony

**description**: A scattered colony of Magellanic penguins on grass-tufted
ground, a few birds upright watching the photographer, others nesting low.
Soft overcast light, no shadows. Open sky.

**annotation**: Magellanic penguins on a grassy slope. Several adults
standing, others sitting. Overcast sky. Brown earth and tussock grass.
Coastal scrubland.

**subject_tags**: `["penguin", "steppe", "sky"]`
**mood_tags**: `["overcast", "quiet"]`
**region_tags**: `["tierra-del-fuego"]`
**tags**: `["wildlife-watching", "birdwatching"]`

### Example 3 — kayakers near a glacier face

**description**: Two kayakers paddle in calm water in front of a vertical
glacier face, the blue ice towering several times their height. Cloudy
sky; the glacier picks up reflected light off the water.

**annotation**: Two people in red sea kayaks on flat water near a large
blue glacier wall. Floating ice in the water. Overcast. Glacier face
shows vertical cracks.

**subject_tags**: `["kayak", "kayaker", "glacier", "ice"]`
**mood_tags**: `["dramatic", "still"]`
**region_tags**: `["perito-moreno"]`
**tags**: `["kayaking", "glacier-walk"]`

### Example 4 — refugio interior, group dinner

**description**: A long wooden table inside a mountain refugio, half a
dozen hikers gathered around plates and wine glasses, packs piled by the
wall. Warm yellow light from low lamps; rain on the windows.

**annotation**: Wooden table indoors at a hiking refuge. Six or seven
hikers seated, eating. Hiking packs against the wall. Lamp-lit interior.
Wet windows.

**subject_tags**: `["interior", "refugio", "group", "food", "gear"]`
**mood_tags**: `["intimate", "cosy", "welcoming"]`
**region_tags**: `["torres-del-paine"]`
**tags**: `["lodge-stay", "wet"]`

### Example 5 — gravel road through steppe

**description**: A gravel road runs straight across dry Patagonian steppe
toward distant ridgelines. A 4x4 vehicle small in the middle distance for
scale. High thin cloud, midday light. No vegetation taller than knee height.

**annotation**: Empty gravel road across flat dry grassland. A four-wheel-
drive vehicle in the distance. Low scrub. Distant mountain range. Bright
midday.

**subject_tags**: `["road", "steppe", "ridge"]`
**mood_tags**: `["vast", "remote", "bleak"]`
**region_tags**: `["aysen", "carretera-austral"]`
**tags**: `["clear"]`

---

## Output

Return JSON matching the schema:

```json
{
  "description": "...",
  "annotation": "...",
  "subject_tags": ["..."],
  "mood_tags": ["..."],
  "region_tags": ["..."],
  "tags": ["..."]
}
```

All six fields are required. The two prose fields are non-empty plain
text; the four arrays may be empty (`[]`) if the image genuinely has no
signal in that bucket, but in practice every Patagonia image carries
at least one subject and one mood. Do not include any preamble,
explanation, or surrounding markdown — only the JSON object.

If the image is unreachable, blank, corrupt, or clearly not a Patagonia
travel photograph (e.g. a logo, a screenshot, a stock-photo person on a
white background), return:

```json
{
  "description": "",
  "annotation": "",
  "subject_tags": [],
  "mood_tags": [],
  "region_tags": [],
  "tags": []
}
```

The pipeline treats two empty prose strings as a non-fatal skip and does
not write to the row.
