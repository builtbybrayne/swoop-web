// product/ui/src/main.tsx
//
// React entry point. Single-SPA mount; no service worker, no PWA shell, no
// hydration boundary. Tailwind styles loaded once here.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Swoop's own faces, self-hosted via Fontsource — no third-party font CDN
// request, so the GDPR posture stays clean. Barlow is swoop-patagonia.com's
// body family; Barlow Semi Condensed stands in for its DIN 2014 display face
// until the host wires up Swoop's Typekit kit (see --swoop-x-font-display).
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/400-italic.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-semi-condensed/500.css";
import "@fontsource/barlow-semi-condensed/600.css";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("#root element missing from index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
