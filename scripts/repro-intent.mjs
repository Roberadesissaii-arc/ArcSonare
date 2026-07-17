import { createRequire } from "module";
// Quick static reproduction of the alias-containment bug without TS transpile.
const phrases = [
  "What's on my calendar?",
  "What is my latest email?",
  "What is in my Gmail?",
  "Open Gmail",
  "Open my calendar",
  "Show unread emails",
  "calendar",
  "gmail",
];

function normalize(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const aliases = [
  { id: "gmail", aliases: ["gmail", "google mail", "my email", "my gmail"] },
  { id: "google-calendar", aliases: ["google calendar", "calendar", "gcal", "my calendar"] },
];

for (const phrase of phrases) {
  const n = normalize(phrase.replace(/\.$/, ""));
  const hits = [];
  for (const entry of aliases) {
    for (const a of entry.aliases) {
      const al = normalize(a);
      if (!al || al.length < 3) continue;
      const re = new RegExp(`(?:^|\\s)${al.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i");
      if (re.test(n)) {
        hits.push(entry.id);
        break;
      }
    }
  }
  console.log(JSON.stringify({ phrase, normalize: n, tokenHits: hits, wouldOpenIfBare: hits.length === 1 }));
}
