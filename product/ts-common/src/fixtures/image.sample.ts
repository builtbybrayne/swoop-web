import type { Image } from "../domain.js";

export const SampleImage: Image = {
  id: "image_puma_ridge_001",
  slug: "puma-on-ridgeline-torres-del-paine",
  title: "Puma on the ridgeline at dawn",
  summary:
    "A female puma, backlit by the rising sun, watches a guanaco herd cross the plateau below.",
  url: "https://cdn.example.com/puma-fixtures/puma-ridgeline.jpg",
  altText: "A puma stands in profile on a rocky ridge, sun low behind it, Patagonian steppe below.",
  photographerCredit: "Roberto Mendez",
  annotations: {
    wildlife: ["puma", "guanaco"],
    landscape: ["steppe", "ridgeline"],
    mood: ["dramatic", "dawn"],
    region: ["torres-del-paine"],
  },
};
