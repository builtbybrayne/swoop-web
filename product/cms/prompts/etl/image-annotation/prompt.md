# Image annotation prompt

You are looking at a single photograph from Swoop Adventures' Patagonia
catalogue. Swoop is an adventure-travel specialist; the website hosts
trips, hotels, regions, and editorial content for visitors planning
journeys to Patagonia and Antarctica. Your job is to write **two
descriptions** of the image, both in plain prose. The output must match
the structured-output schema specified in the API call.

## What the visitor is doing here

A visitor on Swoop's website is somewhere between *vague interest in
Patagonia* and *picking a specific trip to ask about*. They scroll past
images. The right image — paired with the right prose — tips them from
"thinking about it" to "I want to talk to someone about this".

Annotations exist to make these images **retrievable** when the agent's
prose calls for them, and to make them **searchable** when a visitor's
question is concrete.

## The two outputs

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

## What NOT to do (both outputs)

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
- **Don't list more than ~5 elements**. Tighter is better.

## Worked examples

### Example 1 — Torres del Paine at golden hour

**description**: The three granite towers of the Paine massif catch the
last warm light, the rest of the cirque already in shadow. A still
turquoise lake holds the reflection. No one in frame; the scale reads
from the surrounding ridges.

**annotation**: Three tall granite peaks lit by sunset, with a turquoise
glacial lake in the foreground. Snow on the peaks; clear sky. Late-day
warm light. Patagonia.

### Example 2 — Magellanic penguin colony

**description**: A scattered colony of Magellanic penguins on grass-tufted
ground, a few birds upright watching the photographer, others nesting low.
Soft overcast light, no shadows. Open sky.

**annotation**: Magellanic penguins on a grassy slope. Several adults
standing, others sitting. Overcast sky. Brown earth and tussock grass.
Coastal scrubland.

### Example 3 — kayakers near a glacier face

**description**: Two kayakers paddle in calm water in front of a vertical
glacier face, the blue ice towering several times their height. Cloudy
sky; the glacier picks up reflected light off the water.

**annotation**: Two people in red sea kayaks on flat water near a large
blue glacier wall. Floating ice in the water. Overcast. Glacier face
shows vertical cracks.

### Example 4 — refugio interior, group dinner

**description**: A long wooden table inside a mountain refugio, half a
dozen hikers gathered around plates and wine glasses, packs piled by the
wall. Warm yellow light from low lamps; rain on the windows.

**annotation**: Wooden table indoors at a hiking refuge. Six or seven
hikers seated, eating. Hiking packs against the wall. Lamp-lit interior.
Wet windows.

### Example 5 — gravel road through steppe

**description**: A gravel road runs straight across dry Patagonian steppe
toward distant ridgelines. A 4x4 vehicle small in the middle distance for
scale. High thin cloud, midday light. No vegetation taller than knee height.

**annotation**: Empty gravel road across flat dry grassland. A four-wheel-
drive vehicle in the distance. Low scrub. Distant mountain range. Bright
midday.

---

## Output

Return JSON matching the schema:

```json
{
  "description": "...",
  "annotation": "..."
}
```

Both fields are required. Both are non-empty plain text. Do not include
any preamble, explanation, or surrounding markdown — only the JSON object.

If the image is unreachable, blank, corrupt, or clearly not a Patagonia
travel photograph (e.g. a logo, a screenshot, a stock-photo person on a
white background), return:

```json
{
  "description": "",
  "annotation": ""
}
```

The pipeline treats two empty strings as a non-fatal skip and does not
write to the row.
