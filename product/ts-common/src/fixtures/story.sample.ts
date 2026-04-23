import type { Story } from "../domain.js";

export const SampleStory: Story = {
  id: "story_tracking_pumas_001",
  slug: "tracking-pumas-with-roberto",
  title: "Tracking Pumas With Roberto",
  summary:
    "A morning on the steppe outside Torres del Paine with Roberto, a former park ranger who " +
    "spent a decade learning how pumas hunt. Written by Swoop's Joe.",
  body:
    "The jeep stops on a ridgeline before first light. Roberto lifts binoculars, scans the slope. " +
    "'There,' he says quietly. 'Three cubs, maybe four months old, and their mother is waiting for " +
    "the guanaco to move wrong.' We watch, in the cold, for two hours. Nothing happens. Everything " +
    "happens. This is how you see a puma — patient, with someone who has learned the land.",
  heroImageUrl: "https://cdn.example.com/puma-fixtures/puma-story-hero.jpg",
  tags: ["wildlife", "puma", "torres-del-paine", "field-notes"],
  publishedAt: "2026-02-14T09:00:00.000Z",
};
