// Prompt contract and per-mode prompt builders for the page image model.
// Pure functions: /api/page only forwards { prompt, referenceImage }.

import type { PageRequest, PromptParts } from "./types";

export const MAX_USER_TEXT = 300;

export const CONTRACT = [
  "Generate a single web page from a parallel universe, as a flat full-page design export (like a desktop web design comp): the page itself, not a photo or mockup of it.",
  "The content is confidently absurd and plays it completely straight: no winks, no acknowledged jokes, no disclaimers inside the page.",
  "Text must be crisp and legible: headlines, navigation, product names and body copy.",
  "Flat screenshot of the page only: no browser frame, no address bar, no OS taskbar, no device mockup.",
  "The page content fills the whole image edge to edge, as captured from inside the viewport: no window, no title bar or window buttons, no rounded corners, no drop shadow, no desktop or background around the page.",
  "Never use real brand names or logos; invent parodies instead.",
  "No defamation of real people and no genuinely harmful content.",
  'Before the image, output exactly one line of JSON: {"url": "<page address without protocol>", "title": "<page title>"}.',
  "Then output exactly one image.",
].join("\n");

/** Trim, cap and JSON-quote user-controlled text before it enters a prompt. */
function quote(s: string): string {
  return JSON.stringify(s.trim().slice(0, MAX_USER_TEXT));
}

export function buildPagePrompt(req: PageRequest): PromptParts {
  switch (req.mode) {
    case "typed": {
      const task = req.input.trim()
        ? `Show the website for ${quote(req.input)}.`
        : "Show a web portal homepage: the most popular starting page on this universe's web.";
      return { text: `${CONTRACT}\n\n${task}` };
    }
    case "internal":
      return {
        text:
          `${CONTRACT}\n\nThe attached image is the current page of ${quote(req.site.title)} (${quote(req.site.url)}). ` +
          `The user clicked ${quote(req.label)}, which leads to: ${quote(req.dest)}. ` +
          "Show that next page of the same website. Keep its logo, navigation, footer, colours and layout style; replace the main content.",
        referenceImage: req.referenceImage,
      };
    case "external":
      return {
        text:
          `${CONTRACT}\n\nThe user followed a link labelled ${quote(req.label)} (${quote(req.dest)}) to a different website. ` +
          "Show that website's page, with its own branding.",
      };
    case "search":
      return {
        text:
          `${CONTRACT}\n\nThe attached image is ${quote(req.site.title)} (${quote(req.site.url)}). ` +
          `The user typed ${quote(req.query)} into the ${quote(req.label)} box and pressed Enter. ` +
          "Show the results page on the same website, keeping its logo, navigation and footer.",
        referenceImage: req.referenceImage,
      };
  }
}
