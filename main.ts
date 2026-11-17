/**
 * radar — entrypoint for the token launch radar.
 *
 * Reads the sealed DefiLlama snapshot, scores every pre-token protocol with lib/model.ts,
 * checks the board against the gate's rules, then writes the artifacts: board.json, the
 * page's data.js, a copy of dashboard/ and screenshots/, and dossier.json. Deterministic:
 * no clock, no network, no randomness, so a second run over the same snapshot writes the
 * same bytes.
 *
 *   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
 */
import { boardIssue, buildBoard, dataScript, liveRows, parseSnapshot, MODEL_VERSION } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_INPUT = '/input';
const DEFAULT_OUTPUT = '/output';

/**
 * Pull --name value / --name=value pairs out of argv, with fallbacks to the environment
 * and the protocol defaults.
 */
function parseArgv(argv) {
  const value = (flag, fallback) => {
    const inline = argv.find((a) => a.startsWith('--' + flag + '='));
    if (inline !== undefined) return inline.slice(flag.length + 3);
    const at = argv.indexOf('--' + flag);
    return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
  };
  return {
    input: value('input', DEFAULT_INPUT),
    output: value('output', process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUTPUT),
  };
}

/**
 * The snapshot file to read: a path ending in .json is used as-is, anything else is a
 * directory holding snapshot.json.
 */
function snapshotPathFor(inputPath) {
  let path = inputPath;
  if (!path.endsWith('.json')) {
    path = join(path, 'snapshot.json');
  }
  return path;
}

/**
 * Load and parse the snapshot, exiting with status 2 when it is absent.
 */
function loadSnapshot(inputPath) {
  const snapshotPath = snapshotPathFor(inputPath);
  if (!existsSync(snapshotPath)) {
    process.stderr.write('radar: no snapshot at ' + snapshotPath + '; pass --input <snapshot.json|dir>\n');
    process.exit(2);
  }
  return parseSnapshot(readFileSync(snapshotPath, 'utf8'));
}

/**
 * Copy a directory tree while skipping dotfiles, returning the file count.
 */
function copyTree(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) {
    return 0;
  }
  mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const from = join(sourceDir, entry.name);
    const to = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyTree(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      copied += 1;
    }
  }
  return copied;
}

/**
 * Count rows outside the house watchlist: candidates the model found on its own.
 */
function countEarly(rows, watchlist) {
  const listed = new Set(watchlist);
  return rows.filter((row) => !listed.has(row.slug)).length;
}

/**
 * Assemble the dataset the dashboard page reads out of window.RADAR.
 */
function payloadFor(snapshot, rows, sectors, globalMultiple, live) {
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: countEarly(rows, snapshot.watchlist),
    global_multiple: globalMultiple,
    growth_weight: 0.35,
    maturity_floor: 0.55,
    maturity_range: 0.45,
    maturity_days: 1095,
    sectors,
    rows,
    live,
  };
}

/**
 * Copy the static assets into the output and enforce their requirements: the page and
 * the three gate screenshots must all be present.
 */
function copyStaticAssets(outputDir) {
  const rootDir = process.cwd();
  const dashFiles = copyTree(join(rootDir, 'dashboard'), join(outputDir, 'dashboard'));
  const screenshotCount = copyTree(join(rootDir, 'screenshots'), join(outputDir, 'screenshots'));
  if (!existsSync(join(outputDir, 'dashboard', 'index.html'))) {
    process.stderr.write('radar: dashboard/index.html is missing from this repository\n');
    process.exit(1);
  }
  if (screenshotCount < 3) {
    process.stderr.write('radar: screenshots/ holds ' + screenshotCount + ' image(s); the gate wants 3: board, detail, filtered\n');
    process.exit(1);
  }
  return { dashFiles, screenshotCount };
}

/**
 * Write every generated artifact into the output directory.
 */
function writeOutput(outputDir, snapshot, board, sectors, globalMultiple, live) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(outputDir, 'data.js'), dataScript(payloadFor(snapshot, board, sectors, globalMultiple, live)));
  const { dashFiles, screenshotCount } = copyStaticAssets(outputDir);
  writeFileSync(
    join(outputDir, 'dossier.json'),
    buildDossier(outputDir, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 524288 },
      dashboard: { max_files: 400, max_bytes: 4194304 },
    }),
  );
  return { dashFiles, screenshotCount };
}

/**
 * Main orchestration: parse, score, validate, write, report.
 */
function run() {
  const { input, output } = parseArgv(process.argv.slice(2));
  const snapshot = loadSnapshot(input);
  const { board, sectors, global: globalMultiple } = buildBoard(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write('radar: the board would be refused by the gate: ' + issue + '\n');
    process.exit(1);
  }
  const live = liveRows(snapshot);
  const { dashFiles, screenshotCount } = writeOutput(output, snapshot, board, sectors, globalMultiple, live);
  process.stdout.write(
    'radar: ' + MODEL_VERSION + ' scored ' + snapshot.protocols.length + ' protocols, ' + board.length + ' rows ranked (' + snapshot.watchlist.length + ' watchlisted)\n' +
    'radar: ' + sectors.length + ' sectors, ' + live.length + ' live rows, global multiple ' + globalMultiple.toFixed(4) + '\n' +
    'radar: wrote board.json, data.js, dashboard/ (' + dashFiles + ' files), screenshots/ (' + screenshotCount + ') and dossier.json in ' + output + '\n',
  );
}

run();
