const assert = require("node:assert");
const path = require("node:path");
const {
  normalizeShapes,
  findFences,
  diagramType,
  scrubPty,
  ptyCommand,
  backendOrder,
  hasFanIn,
  staticBackground,
  parseOscBackground,
  adaptForLight,
  flattenLineBreaks,
  artWidth,
  terminalWidth,
  glowWidth,
  fitToViewport,
  resizeWatcher,
} = require(path.join(__dirname, "..", "glowmaid"));

let pass = 0;
function eq(actual, expected, name) {
  assert.strictEqual(
    actual,
    expected,
    `${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
  );
  pass += 1;
}

// ---- normalizeShapes: shapes that renderers get wrong get degraded -------
eq(normalizeShapes("E[(Database)]"), "E(Database)", "cylinder");
eq(normalizeShapes("C([stadium])"), "C(stadium)", "stadium");
eq(normalizeShapes("H{{hexagon}}"), "H[hexagon]", "hexagon");
eq(normalizeShapes("I[/parallelogram/]"), "I[parallelogram]", "parallelogram");
eq(normalizeShapes("J[\\alt\\]"), "J[alt]", "parallelogram alt");
eq(normalizeShapes("K[/trap\\]"), "K[trap]", "trapezoid");
eq(normalizeShapes("L[\\trap/]"), "L[trap]", "trapezoid alt");
eq(normalizeShapes("F((circle))"), "F(circle)", "circle");
eq(normalizeShapes("M(((double)))"), "M(double)", "double circle");

// ---- normalizeShapes: shapes that already render fine stay untouched ----
eq(normalizeShapes("A[rect]"), "A[rect]", "rect kept");
eq(normalizeShapes("B(rounded)"), "B(rounded)", "rounded kept");
eq(
  normalizeShapes("D[[subroutine]]"),
  "D[subroutine]]".replace("]]", "]]") === "x" ? "" : "D[[subroutine]]",
  "subroutine kept",
);
eq(normalizeShapes("Z{decision}"), "Z{decision}", "decision kept");
eq(
  normalizeShapes('Q["quoted label"]'),
  'Q["quoted label"]',
  "quoted rect kept",
);

// ---- normalizeShapes: must not corrupt quoted or unclosed content -------
eq(
  normalizeShapes('A["see B[(x)] here"] --> C'),
  'A["see B[(x)] here"] --> C',
  "no rewrite inside quotes",
);
eq(normalizeShapes("E[(unclosed"), "E[(unclosed", "unclosed left alone");
eq(normalizeShapes("A --> B[(x)]"), "A --> B(x)", "edge then node");
eq(normalizeShapes("A --o B"), "A --o B", "circle edge untouched");
eq(normalizeShapes("A o--o B"), "A o--o B", "circle-circle edge untouched");
eq(normalizeShapes("A x--x B"), "A x--x B", "cross edge untouched");
eq(normalizeShapes("A -.-> B"), "A -.-> B", "dotted edge untouched");
eq(normalizeShapes("A ==> B"), "A ==> B", "thick edge untouched");
eq(
  normalizeShapes("A -->|yes| B[(x)]"),
  "A -->|yes| B(x)",
  "labelled edge then node",
);
eq(normalizeShapes("A-->B[(x)]"), "A-->B(x)", "tight edge then node");
eq(normalizeShapes("db1[(x)]"), "db1(x)", "id with digit");
eq(normalizeShapes("my_node[(x)]"), "my_node(x)", "id with underscore");
eq(
  normalizeShapes("E\n[(x)]"),
  "E\n[(x)]",
  "shape must follow id on same line",
);
eq(
  normalizeShapes("x--o[(y)]"),
  "x--o(y)",
  "circle edge without space (invalid mermaid, best effort)",
);
eq(normalizeShapes(""), "", "empty");
eq(
  normalizeShapes("graph TD\n  E[(db)] --> F"),
  "graph TD\n  E(db) --> F",
  "multiline",
);

// real-world graph
eq(
  normalizeShapes(
    "graph TD\n    A[User] --> B{Logged in?}\n    B --> C[Dashboard]\n    C --> E[(Database)]",
  ),
  "graph TD\n    A[User] --> B{Logged in?}\n    B --> C[Dashboard]\n    C --> E(Database)",
  "realistic graph",
);

// ---- findFences ---------------------------------------------------------
const bt = "```";
const tilde = "~~~";

let f = findFences(`${bt}mermaid\ngraph TD\n  A-->B\n${bt}\n`);
eq(f.length, 1, "one block");
eq(f[0].info, "mermaid", "info string");
eq(f[0].closed, true, "closed");
eq(f[0].body.join("|"), "graph TD|  A-->B", "body");

f = findFences(`${tilde}mermaid\ngraph TD\n${tilde}\n`);
eq(f[0].info, "mermaid", "tilde info");
eq(f[0].closed, true, "tilde closed");

f = findFences(`${bt}{.mermaid}\nabc\n${bt}\n`);
eq(f[0].info, "{.mermaid}", "attribute info");

f = findFences(`- item\n\n  ${bt}mermaid\n  graph TD\n  ${bt}\n`);
eq(f[0].indent, 2, "indented fence");
eq(f[0].body[0], "  graph TD", "indented body preserved raw");

f = findFences(
  `${bt}${bt}${bt}${bt}mermaid\n${bt}${bt}${bt}\n${bt}${bt}${bt}${bt}\n`,
);
eq(f.length, 1, "longer fence");
eq(f[0].body.join("|"), `${bt}${bt}${bt}`, "inner shorter fence is content");

f = findFences(`${bt}mermaid\ngraph TD\n`);
eq(f[0].closed, false, "unterminated");

f = findFences(`${bt}bash\necho hi\n${bt}\n`);
eq(f[0].info, "bash", "non-mermaid block still parsed");

// ---- diagramType --------------------------------------------------------
eq(diagramType("graph TD\n A-->B"), "graph", "graph");
eq(diagramType("flowchart LR\n A-->B"), "flowchart", "flowchart");
eq(diagramType("sequenceDiagram\n A->>B: hi"), "sequencediagram", "sequence");
eq(diagramType("stateDiagram-v2\n [*] --> A"), "statediagram-v2", "state v2");
eq(
  diagramType("%%{init: {'theme':'dark'}}%%\ngraph TD\n A"),
  "graph",
  "skips directives",
);
eq(
  diagramType("%% a comment\nerDiagram\n A ||--o{ B : x"),
  "erdiagram",
  "skips comments",
);
eq(diagramType("\n\n  \npie title X"), "pie", "leading blanks");

// ---- backendOrder ------------------------------------------------------
eq(
  backendOrder("sequencediagram", "auto").join(","),
  "merman,termaid",
  "sequence: merman first",
);
eq(
  backendOrder("graph", "auto").join(","),
  "termaid,merman",
  "simple graph: termaid first",
);
eq(backendOrder("graph", "termaid").join(","), "termaid", "forced termaid");
eq(
  backendOrder("sequencediagram", "merman").join(","),
  "merman",
  "forced merman",
);
eq(
  backendOrder("erdiagram", "auto").join(","),
  "termaid",
  "ER is termaid-only",
);

// ---- hasFanIn ----------------------------------------------------------
eq(
  hasFanIn("graph TD\n A[Start] --> B[Middle]\n B --> C[End]"),
  false,
  "linear chain",
);
eq(hasFanIn("graph TD\n A --> B\n A --> C"), false, "fan-out only");
eq(hasFanIn("graph TD\n A[Start] --> C[End]\n B[Other] --> C"), true, "fan-in");
eq(
  hasFanIn("graph TD\n A --> B\n A --> C\n B --> D\n C --> D"),
  true,
  "diamond",
);
eq(
  hasFanIn("graph TD\n A -->|yes| B{Check}\n B -->|x| C\n B -->|y| C"),
  true,
  "labelled edges",
);
eq(hasFanIn("graph LR\n A --o B\n C --o B"), true, "circle edges");
eq(
  hasFanIn("graph TD\n A[(db)] --> B\n C{{hex}} --> B"),
  true,
  "edges from shaped nodes",
);
eq(
  hasFanIn("graph TD\n A --> B --> D\n C --> D"),
  true,
  "chained edge then fan-in",
);

// ---- backendOrder honours fan-in ---------------------------------------
eq(
  backendOrder("graph", "auto", "graph TD\n A --> C\n B --> C").join(","),
  "merman,termaid",
  "fan-in graph: merman first",
);
eq(
  backendOrder("graph", "auto", "graph TD\n A --> B").join(","),
  "termaid,merman",
  "simple graph still termaid first",
);

// ---- scrubPty -----------------------------------------------------------
eq(
  scrubPty("^D\b\b\x1b[31mhi\x1b[0m\r\nbye\r\n"),
  "\x1b[31mhi\x1b[0m\nbye\n",
  "pty scrub",
);

// ---- ptyCommand ---------------------------------------------------------
const ptyArgs = (platform) =>
  JSON.stringify(ptyCommand("/bin/merman", ["-f", "/tmp/a b.mmd"], platform));
eq(
  ptyArgs("darwin"),
  JSON.stringify([
    "script",
    ["-q", "/dev/null", "/bin/merman", "-f", "/tmp/a b.mmd"],
  ]),
  "pty bsd script",
);
eq(
  ptyArgs("linux"),
  JSON.stringify([
    "script",
    ["-q", "-e", "-c", "'/bin/merman' '-f' '/tmp/a b.mmd'", "/dev/null"],
  ]),
  "pty util-linux script",
);
eq(
  ptyCommand("/x/it's", [], "linux")[1][3],
  "'/x/it'\\''s'",
  "pty quote single quote",
);
eq(ptyCommand("/bin/merman", [], "win32"), null, "pty unsupported platform");

// ---- staticBackground: glow style, env and COLORFGBG pick the background --
for (const [flags, env, want, name] of [
  [["-s", "light"], {}, "light", "style flag"],
  [["--style=dark"], {}, "dark", "style equals flag"],
  [["-s", "dracula"], {}, "dark", "dark named style"],
  [["-s", "notty"], {}, "none", "notty has no color"],
  [[], { GLAMOUR_STYLE: "light" }, "light", "GLAMOUR_STYLE"],
  [["-s", "dark"], { GLOWMAID_BG: "light" }, "light", "GLOWMAID_BG wins"],
  [[], { GLOWM_BG: "dark" }, "dark", "legacy GLOWM_BG"],
  [[], { COLORFGBG: "0;15" }, "light", "COLORFGBG light"],
  [[], { COLORFGBG: "15;default;0" }, "dark", "COLORFGBG dark"],
  [["-s", "auto"], {}, null, "auto asks terminal"],
  [["-s", "my.json"], { GLOWMAID_BG: "auto" }, null, "json style unknown"],
]) {
  eq(staticBackground(flags, env), want, `bg ${name}`);
}

// ---- parseOscBackground: OSC 11 reply to light/dark ----------------------
eq(parseOscBackground("\x1b]11;rgb:f0f0/eaea/d6d6\x1b\\"), "light", "osc light");
eq(parseOscBackground("\x1b]11;rgb:1e/1e/2e\x07"), "dark", "osc dark 8-bit");
eq(parseOscBackground("\x1b[?62;22c"), null, "osc no reply");

// ---- adaptForLight: light foregrounds become dark, rest stays ------------
eq(
  adaptForLight("\x1b[38;2;245;230;211mA\x1b[0m"),
  "\x1b[38;2;44;29;10mA\x1b[0m",
  "light label darkened",
);
eq(
  adaptForLight("\x1b[1;38;2;139;126;106m"),
  "\x1b[1;38;2;139;126;106m",
  "dark color kept",
);
eq(adaptForLight("\x1b[1;37m\x1b[97m"), "\x1b[1;30m\x1b[90m", "white to black");
eq(
  adaptForLight("\x1b[48;2;255;255;255;38;5;15m"),
  "\x1b[48;2;255;255;255;38;5;15m",
  "background and 256 colors kept",
);

// ---- flattenLineBreaks: <br/> becomes a space, so labels can wrap --------
eq(
  flattenLineBreaks('A["a<br/>b<br>c<BR />d"]'),
  'A["a b c d"]',
  "br variants flattened",
);
eq(flattenLineBreaks("A[<b>x</b>]"), "A[<b>x</b>]", "other tags kept");

// ---- artWidth: columns of the widest line, color and trailing space ignored
eq(artWidth("\x1b[31m┌──┐\x1b[0m  \n│ab│\n└──┘"), 4, "art width");
eq(artWidth(""), 0, "empty art width");

// ---- glowWidth: -w, then GLOW_WIDTH, then glow.yml; 0 means "ask the terminal"
const fs = require("node:fs");
const os = require("node:os");
const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "glowmaid-test-"));
const cfg = path.join(cfgDir, "glow.yml");
fs.writeFileSync(cfg, 'style: "auto"\nwidth: 70\n');
const noCfg = { XDG_CONFIG_HOME: cfgDir };
for (const [flags, env, want, name] of [
  [["-w", "60"], {}, 60, "glow -w"],
  [["--width=90", "--config", cfg], {}, 90, "glow --width= beats config"],
  [[], { GLOW_WIDTH: "100", XDG_CONFIG_HOME: cfgDir }, 100, "GLOW_WIDTH"],
  [["--config", cfg], {}, 70, "glow.yml width"],
  [["-w", "0", "--config", cfg], {}, null, "-w 0 asks the terminal"],
  [[], noCfg, null, "no config"],
]) {
  eq(glowWidth(flags, env, "linux"), want, `glow width ${name}`);
}

// ---- terminalWidth: GLOWMAID_WIDTH, then glow width capped by terminal ---
const savedWidth = process.env.GLOWMAID_WIDTH;
delete process.env.GLOWMAID_WIDTH;
for (const [flags, columns, want, name] of [
  [[], "90", 90, "terminal"],
  [[], "200", 120, "terminal capped like glow"],
  [["-w", "60"], "90", 60, "glow -w"],
  [["-w", "150"], "90", 90, "glow -w capped by terminal"],
]) {
  eq(
    terminalWidth(flags, { ...noCfg, COLUMNS: columns }, "linux"),
    want,
    `width ${name}`,
  );
}
process.env.GLOWMAID_WIDTH = "130";
eq(terminalWidth(["-w", "60"], noCfg, "linux"), 130, "GLOWMAID_WIDTH wins");
if (savedWidth === undefined) delete process.env.GLOWMAID_WIDTH;
else process.env.GLOWMAID_WIDTH = savedWidth;
fs.rmSync(cfgDir, { recursive: true, force: true });

// ---- fitToViewport: too-wide art becomes source unless output can scroll -
const wide = { ok: true, type: "graph", out: "x", width: 120 };
const narrow = { ok: true, type: "graph", out: "y", width: 50 };
let fitted = fitToViewport([wide, narrow], 80, false);
eq(fitted[0].ok, false, "wide art dropped");
eq(fitted[0].reason, "too wide (120 > 80 cols), use -p to scroll", "wide note");
eq(fitted[1], narrow, "narrow art kept");
fitted = fitToViewport([wide], 80, true);
eq(fitted[0], wide, "wide art kept when output scrolls");

// ---- resizeWatcher: write the file only when the text changes ------------
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glowmaid-test-"));
  const file = path.join(dir, "doc.md");
  fs.writeFileSync(file, "v1");
  const writes = () => fs.statSync(file).mtimeMs;

  let next = "v1";
  let renders = 0;
  const watcher = resizeWatcher(
    async () => {
      renders += 1;
      if (next === "boom") throw new Error("render failed");
      return next;
    },
    file,
    "v1",
    0,
  );

  const before = writes();
  await watcher.update();
  eq(fs.readFileSync(file, "utf8"), "v1", "same text kept");
  eq(writes(), before, "same text not written");

  next = "v2";
  await watcher.update();
  eq(fs.readFileSync(file, "utf8"), "v2", "changed text written");

  next = "boom";
  await watcher.update();
  eq(fs.readFileSync(file, "utf8"), "v2", "failed render keeps file");

  next = "v3";
  renders = 0;
  const first = watcher.update();
  watcher.update();
  watcher.update();
  await first;
  eq(renders, 2, "resizes during a render collapse into one more render");
  eq(fs.readFileSync(file, "utf8"), "v3", "latest text written");

  watcher.stop();
  next = "v4";
  await watcher.update();
  eq(fs.readFileSync(file, "utf8"), "v3", "stopped watcher does not write");
  eq(fs.readdirSync(dir).join(","), "doc.md", "no temp file left");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
