import { __parseBlocksForTests as parse } from "../src/components/chat/FormattedReply";
const real = `To make coffee without a machine, you'll need a few basic ingredients.

**Method 1: French Press**

Ingredients:
* 1 tablespoon of coarsely ground coffee
* 6 oz of hot water

Instructions:
1. Add coffee to a glass.
2. Pour boiling water over the grounds.

Use \`kettle\` if you have one.

\`\`\`bash
brew --help
\`\`\`

> Steeping longer makes it stronger.`;
const blocks = parse(real);
console.log("blocks:", blocks.map(b => b.kind).join(", "));
const kinds = new Set(blocks.map(b => b.kind));
const want = ["p","ul","ol","code","quote"];
let fail = 0;
for (const w of want) { const ok = kinds.has(w as any); if(!ok) fail++; console.log(`${ok?"PASS":"FAIL"}  parses ${w}`); }
const ul = blocks.find(b => b.kind === "ul") as any;
const ol = blocks.find(b => b.kind === "ol") as any;
const okUl = ul?.items.length === 2, okOl = ol?.items.length === 2;
if(!okUl) fail++; if(!okOl) fail++;
console.log(`${okUl?"PASS":"FAIL"}  bullet list has 2 items (${ul?.items.length})`);
console.log(`${okOl?"PASS":"FAIL"}  numbered list has 2 items (${ol?.items.length})`);
const code = blocks.find(b => b.kind === "code") as any;
const okCode = code?.lines.join("") === "brew --help";
if(!okCode) fail++;
console.log(`${okCode?"PASS":"FAIL"}  code block body preserved`);
console.log(`\n${fail === 0 ? "all passed" : fail + " failed"}`);
process.exit(fail?1:0);
