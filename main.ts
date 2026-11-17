// main.ts — the radar entrypoint.
//
// Reads the sealed snapshot, scores every candidate protocol with lib/model.ts, validates the board
// against the gate rules, then writes board.json, the page data.js, dashboard/, screenshots/ and
// finally dossier.json. No network, no clock, no randomness: two runs on the same snapshot write the
// same bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardIssue, buildBoard, dataScript, liveRows, parseSnapshot, MODEL_VERSION } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

/** --name <value> out of the arguments, or the fallback; --name=value works too. */
function parseArgs(argv: string[]): { input: string; output: string } {
  const value = (name: string, fallback: string): string => {
    const withEquals = argv.find((a) => a.startsWith("--" + name + "="));
    if (withEquals !== undefined) return withEquals.slice(name.length + 3);
    const at = argv.indexOf("--" + name);
    return at >= 0 && at + 1 < argv.length ? argv[at + 1]! : fallback;
  };
  return {
    input: value("input", "/input"),
    output: value("output", process.env.MAKEFUN_OUTPUT_DIR ?? "/output"),
  };
}

/** The snapshot file and the output directory, resolved from the parsed arguments. */
function resolvePaths(args: { input: string; output: string }): { inputFile: string; out: string } {
  return {
    inputFile: args.input.endsWith(".json") ? args.input : join(args.input, "snapshot.json"),
    out: args.output,
  };
}

/** Copy the regular files of one directory into the target directory, skipping dot-names; returns what was copied. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith(".")) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The whole run: parse, resolve, score, validate, write. Exits 0 on success, 1 on a refused board or
 *  missing assets, 2 on a missing snapshot. */
function run(): void {
  const { inputFile, out } = resolvePaths(parseArgs(process.argv));

  if (!existsSync(inputFile)) {
    process.stderr.write("radar: no snapshot at " + inputFile + "; pass --input <snapshot.json|dir>\n");
    process.exit(2);
  }

  const snapshot = parseSnapshot(readFileSync(inputFile, "utf8"));
  const { board, sectors, global } = buildBoard(snapshot);
  const live = liveRows(snapshot);

  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write("radar: the board would be refused by the gate: " + issue + "\n");
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "board.json"), JSON.stringify({ rows: board }) + "\n");

  const data = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    global_multiple: global,
    growth_weight: 0.35,
    maturity_floor: 0.55,
    maturity_range: 0.45,
    maturity_days: 1095,
    sectors,
    rows: board,
    live,
  };
  writeFileSync(join(out, "data.js"), dataScript(data));

  const dashFiles = copyFiles(join(here, "dashboard"), join(out, "dashboard"));
  if (!dashFiles.includes("index.html")) {
    process.stderr.write("radar: dashboard/index.html is missing from this repository\n");
    process.exit(1);
  }
  const shots = copyFiles(join(here, "screenshots"), join(out, "screenshots"));
  if (shots.length < 3) {
    process.stderr.write("radar: screenshots/ holds " + shots.length + " image(s); the gate wants 3: board, detail, filtered\n");
    process.exit(1);
  }

  writeFileSync(
    join(out, "dossier.json"),
    buildDossier(out, {
      text_max_bytes: 65_536,
      screenshots: { max: 4, max_bytes: 524_288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );

  process.stdout.write(
    "radar: " + MODEL_VERSION + " scored " + snapshot.protocols.length + " protocols, " + board.length + " rows ranked (" + snapshot.watchlist.length + " watchlisted)\\n" +
    "radar: " + sectors.length + " sectors, " + live.length + " live rows, global multiple " + global.toFixed(4) + "\\n" +
    "radar: wrote board.json, data.js, dashboard/ (" + dashFiles.length + " files), screenshots/ (" + shots.length + ") and dossier.json in " + out + "\\n",
  );
}

run();
