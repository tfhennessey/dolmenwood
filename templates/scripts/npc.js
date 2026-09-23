// npc.js — Templater user script: generate a Dolmenwood NPC.
//
// Called from templates/NPC.md as:  tp.user.npc()
// Templater injects `tp` as the first argument automatically.
//
// Behaviour:
//   1. Prompts for kindred, class, and (where relevant) a name/sex style.
//   2. Reads the kindred note, parses its rollable tables, and rolls them.
//   3. Reads the class note for level-1 stats (HP, attack, saves, etc.).
//   4. Returns the full NPC markdown, with results baked in.

const KIND = ["Breggle", "Elf", "Grimalkin", "Human", "Mossling", "Woodgrue"];
const CLS = ["Bard", "Cleric", "Enchanter", "Fighter", "Friar", "Hunter", "Knight", "Magician", "Thief"];

const KIND_DIR = "01_Rules/Kindreds";
const CLASS_DIR = "01_Rules/Classes";

// Friendly labels + preferred ordering for the physical-trait tables.
const TRAIT_LABELS = {
  head: "Head",
  face: "Face",
  body: "Body",
  fur: "Fur",
  dress: "Dress",
  demeanour: "Demeanour",
  desires: "Desires",
  beliefs: "Beliefs",
  speech: "Speech",
  "symbiotic-flesh": "Symbiotic Flesh",
};
const TRAIT_ORDER = ["head", "face", "body", "fur", "dress", "demeanour", "desires", "beliefs", "speech", "symbiotic-flesh"];

// ---- RNG ----
function makeRng() {
  return {
    int(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; },
    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  };
}

// ---- Markdown table parsing ----
function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
}

function parseDie(cell) {
  const s = String(cell);
  const m = s.match(/dice:\s*\d*d(\d+)/i) || s.match(/\b\d*d(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseRange(cell, die) {
  const s = String(cell).replace(/[–—]/g, "-").trim();
  const parts = s.split("-").filter((x) => x.trim() !== "");
  const toNum = (t) => {
    t = t.trim();
    if (t === "00") return die === 100 ? 100 : 0; // percentile "00" == 100
    return parseInt(t, 10);
  };
  if (parts.length === 1) { const v = toNum(parts[0]); return [v, v]; }
  if (parts.length === 2) return [toNum(parts[0]), toNum(parts[1])];
  return [null, null];
}

// Parse every rollable table in a note, keyed by its `^block-id` marker.
function parseTables(content) {
  const lines = content.split("\n");
  const tables = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\^([a-z][a-z0-9-]*)\s*$/);
    if (!m) continue;
    const id = m[1];

    // Walk backwards (skipping blank lines) to collect the table's rows.
    const rowLines = [];
    let j = i - 1;
    while (j >= 0) {
      const l = lines[j];
      if (l.trimStart().startsWith("|")) { rowLines.unshift(l); j--; }
      else if (l.trim() === "") { j--; }
      else break;
    }
    if (rowLines.length < 3) continue; // need header + separator + >=1 data row

    let die = parseDie(splitRow(rowLines[0])[0]);
    const rows = [];
    for (let k = 2; k < rowLines.length; k++) {
      const cells = splitRow(rowLines[k]);
      if (cells.length < 2) continue;
      const [lo, hi] = parseRange(cells[0], die);
      rows.push({ min: lo, max: hi, value: cells[1] });
    }
    if (!die) {
      const maxN = Math.max(...rows.map((r) => (r.max === 100 ? 100 : r.max)).filter((n) => n != null));
      die = maxN || 100;
    }
    tables[id] = { die, rows };
  }
  return tables;
}

function rollTable(table, rng) {
  const n = rng.int(1, table.die);
  for (const row of table.rows) {
    if (n >= row.min && n <= row.max) return { n, value: row.value };
  }
  const last = table.rows[table.rows.length - 1];
  return { n, value: last ? last.value : "" };
}

// ---- Class note parsing ----
function parseFrontmatter(content) {
  const fm = {};
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (m) {
    for (const line of m[1].split("\n")) {
      const mm = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (mm) fm[mm[1]] = mm[2].trim();
    }
  }
  return fm;
}

function parseAdvancement(content) {
  const lines = content.split("\n");
  let seen = false;
  let hdr = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^## .*Advancement/.test(lines[i])) seen = true;
    else if (seen && lines[i].trim().startsWith("|")) { hdr = i; break; }
  }
  if (hdr < 0) return null;
  const cols = {};
  splitRow(lines[hdr]).forEach((c, ix) => { cols[c] = ix; });
  let lvl1 = null;
  for (let i = hdr + 2; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith("|")) break;
    const cells = splitRow(l);
    if (cells[0] === "1") { lvl1 = cells; break; }
  }
  return { cols, lvl1 };
}

function rollHp(formula, rng) {
  const m = String(formula).match(/(\d*)d(\d+)/);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const faces = parseInt(m[2], 10);
  let total = 0;
  for (let i = 0; i < count; i++) total += rng.int(1, faces);
  return total;
}

// ---- Name assembly (handles the three naming schemes) ----
function buildName(tables, nameChoice, rng) {
  // Elf: rustic/courtly epithets, no surname.
  if (tables["names-rustic"] || tables["names-courtly"]) {
    let c = nameChoice;
    if (!c || c === "Random") c = rng.pick(["Rustic", "Courtly"]);
    const t = c === "Courtly" ? tables["names-courtly"] : tables["names-rustic"];
    return t ? rollTable(t, rng).value : "";
  }
  // Grimalkin: non-gendered first name + surname.
  if (tables["names-first"]) {
    const first = rollTable(tables["names-first"], rng).value;
    const sn = tables["names-surname"] ? rollTable(tables["names-surname"], rng).value : "";
    return [first, sn].filter(Boolean).join(" ");
  }
  // Gendered kindreds: given name + surname.
  let c = nameChoice;
  if (!c || c === "Random") c = rng.pick(["Male", "Female", "Unisex"]);
  let t = tables["names-male"];
  if (c === "Female") t = tables["names-female"];
  else if (c === "Unisex") t = tables["names-unisex"];
  const given = t ? rollTable(t, rng).value : "";
  const sn = tables["names-surname"] ? rollTable(tables["names-surname"], rng).value : "";
  return [given, sn].filter(Boolean).join(" ");
}

// ---- Pure generator: inputs in, markdown out (unit-testable) ----
function generate({ kindred, kindredContent, cls, classContent, nameChoice, rng }) {
  const tables = parseTables(kindredContent);
  const name = buildName(tables, nameChoice, rng);
  const background = tables["backgrounds"] ? rollTable(tables["backgrounds"], rng).value : "";
  const trinket = tables["trinkets"] ? rollTable(tables["trinkets"], rng).value : "";

  const traitIds = TRAIT_ORDER.filter((id) => tables[id]);
  for (const id of Object.keys(tables)) {
    if (id in TRAIT_LABELS && !traitIds.includes(id)) traitIds.push(id);
  }

  const fm = parseFrontmatter(classContent);
  const adv = parseAdvancement(classContent);
  const hpFormula = adv ? adv.lvl1[adv.cols["Hit Points"]] : fm.hit_points || "";
  const hpRolled = rollHp(hpFormula, rng);
  const attack = adv ? adv.lvl1[adv.cols["Attack"]] : "";
  const saves = adv ? ["Doom", "Ray", "Hold", "Blast", "Spell"].map((k) => adv.lvl1[adv.cols[k]]) : [];

  const out = [];
  out.push("---");
  out.push("tags: [npc]");
  out.push(`kindred: ${kindred}`);
  out.push(`class: ${cls}`);
  out.push(`name: "${name}"`);
  out.push("---");
  out.push("");
  out.push(`# ${name}`);
  out.push("");
  out.push(`> **${kindred}** · **${cls}**`);
  out.push("");
  out.push("## Identity");
  out.push("");
  out.push(`- **Kindred:** [[${kindred}]]`);
  out.push(`- **Class:** [[${cls}]]`);
  if (background) out.push(`- **Background:** ${background}`);
  if (trinket) out.push(`- **Trinket:** ${trinket}`);
  out.push("");
  out.push("## Appearance");
  out.push("");
  for (const id of traitIds) {
    const r = rollTable(tables[id], rng);
    out.push(`- **${TRAIT_LABELS[id]}:** ${r.value}`);
  }
  out.push("");
  out.push("## Stats");
  out.push("");
  out.push("| Stat | Value |");
  out.push("| ---- | ----- |");
  if (fm.prime_abilities) out.push(`| Prime Abilities | ${fm.prime_abilities} |`);
  if (fm.combat_aptitude) out.push(`| Combat Aptitude | ${fm.combat_aptitude} |`);
  if (hpRolled != null) out.push(`| HP | ${hpRolled} (${hpFormula}) |`);
  if (attack) out.push(`| Attack | ${attack} |`);
  if (saves.length === 5 && saves.every((s) => s != null)) {
    out.push(`| Saves (D / R / H / B / S) | ${saves.join(" / ")} |`);
  }
  if (fm.armour) out.push(`| Armour | ${fm.armour} |`);
  if (fm.weapons) out.push(`| Weapons | ${fm.weapons} |`);
  out.push("");
  return { name, markdown: out.join("\n") };
}

// ---- Templater entry point ----
async function npc(tp) {
  const rng = makeRng();

  const kindred = await tp.system.suggester(KIND, KIND, false, "Select kindred");
  if (!kindred) return "";
  const cls = await tp.system.suggester(CLS, CLS, false, "Select class");
  if (!cls) return "";

  const kindredContent = await app.vault.adapter.read(`${KIND_DIR}/${kindred}.md`);
  const classContent = await app.vault.adapter.read(`${CLASS_DIR}/${cls}.md`);
  const tables = parseTables(kindredContent);

  let nameChoice = null;
  if (tables["names-male"] || tables["names-female"] || tables["names-unisex"]) {
    nameChoice = await tp.system.suggester(
      ["Male", "Female", "Unisex", "Random"],
      ["Male", "Female", "Unisex", "Random"],
      false, "Name / sex"
    );
  } else if (tables["names-rustic"] || tables["names-courtly"]) {
    nameChoice = await tp.system.suggester(
      ["Rustic", "Courtly", "Random"],
      ["Rustic", "Courtly", "Random"],
      false, "Name style"
    );
  }

  const { name, markdown } = generate({ kindred, kindredContent, cls, classContent, nameChoice, rng });

  // Auto-title the note with the NPC's name.
  if (name) {
    try { await tp.file.rename(name); } catch (e) { /* keep typed filename if rename fails */ }
  }
  return markdown;
}

module.exports = npc;
module.exports.generate = generate;
module.exports.parseTables = parseTables;
module.exports.parseFrontmatter = parseFrontmatter;
module.exports.parseAdvancement = parseAdvancement;
module.exports.rollTable = rollTable;
module.exports._makeRng = makeRng;
