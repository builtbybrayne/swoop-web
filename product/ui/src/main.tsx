// product/ui/src/main.tsx
//
// React entry point. Single-SPA mount; no service worker, no PWA shell, no
// hydration boundary. Tailwind styles loaded once here.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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
