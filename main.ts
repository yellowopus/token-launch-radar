/**
 * Radar board entrypoint.
 *
 * Builds a token radar board from a snapshot file, renders the board
 * artifacts, copies the static dashboard and screenshot assets, and
 * prints a compact summary to stdout.
 *
 * Run command:
 *   node main.ts --input <file-or-dir> [--output <dir>]
 *
 * Defaults:
 *   input  -> /input
 *   output -> MAKEFUN_OUTPUT_DIR, or /output
 */
import { boardIssue, buildBoard, dataScript, liveRows, parseSnapshot, MODEL_VERSION } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_INPUT = '/input';
const DEFAULT_OUTPUT = '/output';

/**
 * Read the process arguments into an input/output pair.
 */
function parseArgv(argv) {
  let input = DEFAULT_INPUT;
  let output = process.env.MAKEFUN_OUTPUT_DIR || DEFAULT_OUTPUT;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--input') {
      input = argv[index + 1] || input;
      index += 1;
    } else if (flag === '--output') {
      output = argv[index + 1] || output;
      index += 1;
    }
  }
  return { input, output };
}

/**
 * Convert a file-or-directory input into the concrete snapshot path.
 */
function snapshotPathFor(inputPath) {
  let path = inputPath;
  try {
    if (statSync(path).isDirectory()) {
      path = join(path, 'snapshot.json');
    }
  } catch {
    // Missing paths are surfaced by the loader below.
  }
  return path;
}

/**
 * Load and parse the snapshot, bailing out when it is absent.
 */
function loadSnapshot(inputPath) {
  const snapshotPath = snapshotPathFor(inputPath);
  if (!existsSync(snapshotPath)) {
    process.stderr.write('snapshot missing: ' + snapshotPath + '\n');
    process.exit(2);
  }
  return parseSnapshot(readFileSync(snapshotPath, 'utf8'));
}

/**
 * Pull the rows and sectors out of whatever shape the builder returns.
 */
function splitBoard(board) {
  if (Array.isArray(board)) {
    return { rows: board, sectors: [] };
  }
  if (board && Array.isArray(board.rows)) {
    return {
      rows: board.rows,
      sectors: Array.isArray(board.sectors) ? board.sectors : [],
    };
  }
  return { rows: [], sectors: [] };
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
 * Count the rows that are still in the early phase.
 */
function countEarly(rows) {
  return rows.filter((row) => row && (row.early === true || row.stage === 'early')).length;
}

/**
 * Compose the payload consumed by dataScript.
 */
function payloadFor(snapshot, board, live) {
  const { rows, sectors } = splitBoard(board);
  const watchlist = Array.isArray(snapshot.watchlist) ? snapshot.watchlist : (Array.isArray(snapshot.rows) ? snapshot.rows : []);
  return {
    as_of: snapshot.as_of ?? snapshot.asOf ?? '',
    source: snapshot.source ?? '',
    floor_usd: snapshot.floor_usd ?? snapshot.floorUsd ?? 0,
    model_version: MODEL_VERSION,
    watchlist_size: watchlist.length || rows.length,
    board_size: rows.length,
    early_size: countEarly(rows),
    global_multiple: snapshot.global_multiple ?? snapshot.globalMultiple ?? 0,
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
 * Copy the static assets into the output and enforce their requirements.
 */
function copyStaticAssets(outputDir) {
  const rootDir = process.cwd();
  copyTree(join(rootDir, 'dashboard'), join(outputDir, 'dashboard'));
  const screenshotCount = copyTree(join(rootDir, 'screenshots'), join(outputDir, 'screenshots'));
  if (!existsSync(join(outputDir, 'dashboard', 'index.html'))) {
    process.stderr.write('dashboard/index.html missing\n');
    process.exit(1);
  }
  if (screenshotCount < 3) {
    process.stderr.write('need at least 3 screenshots, found ' + screenshotCount + '\n');
    process.exit(1);
  }
}

/**
 * Write every generated artifact into the output directory.
 */
async function writeOutput(outputDir, snapshot, board, live) {
  mkdirSync(outputDir, { recursive: true });
  const { rows } = splitBoard(board);
  writeFileSync(join(outputDir, 'board.json'), JSON.stringify({ rows }) + '\n');
  const script = await dataScript(payloadFor(snapshot, board, live));
  writeFileSync(join(outputDir, 'data.js'), script);
  copyStaticAssets(outputDir);
  await buildDossier(outputDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
}

/**
 * Main orchestration.
 */
async function run() {
  const { input, output } = parseArgv(process.argv.slice(2));
  const snapshot = await loadSnapshot(input);
  const board = await buildBoard(snapshot);
  const issue = boardIssue(board);
  if (issue) {
    process.stderr.write('board issue: ' + JSON.stringify(issue) + '\n');
    process.exit(1);
  }
  const live = await liveRows(snapshot);
  await writeOutput(output, snapshot, board, live);
  const { rows, sectors } = splitBoard(board);
  process.stdout.write('radar: snapshot loaded (source=' + (snapshot.source ?? 'unknown') + ')\n');
  process.stdout.write('radar: board built (' + rows.length + ' rows, ' + countEarly(rows) + ' early, ' + sectors.length + ' sectors)\n');
  process.stdout.write('radar: wrote ' + join(output, 'board.json') + ', ' + join(output, 'data.js') + ', ' + join(output, 'dossier.json') + '\n');
}

run().catch((error) => {
  process.stderr.write(error && error.stack ? error.stack : String(error));
  process.stderr.write('\n');
  process.exit(1);
});
