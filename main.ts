/**
 * radar — deterministic build of the token launch radar from a sealed snapshot.
 *
 * The work is arranged as a small pipeline of named steps. Each step reads the
 * snapshot or the artifacts written by earlier steps; none of them touch a clock,
 * the network, or randomness, so the same snapshot always yields the same bytes.
 *
 *   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
 */
import {
  MODEL_VERSION,
  boardIssue,
  buildBoard,
  dataScript,
  liveRows,
  parseSnapshot,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const DEFAULT_INPUT = '/input';
const DEFAULT_OUTPUT = '/output';
const TEXT_MAX_BYTES = 65536;
const DOSSIER_SCREENSHOTS = { max: 4, max_bytes: 524288 };
const DOSSIER_DASHBOARD = { max_files: 400, max_bytes: 4194304 };

/** Read `--flag value` and `--flag=value` pairs, falling back to the environment. */
function argumentsFrom(argv) {
  const valueFor = (flag, fallback) => {
    const inline = argv.find((arg) => arg.startsWith('--' + flag + '='));
    if (inline !== undefined) {
      return inline.slice(flag.length + 3);
    }
    const position = argv.indexOf('--' + flag);
    return position >= 0 && position + 1 < argv.length ? argv[position + 1] : fallback;
  };
  return {
    input: valueFor('input', DEFAULT_INPUT),
    output: valueFor('output', process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUTPUT),
  };
}

/** A `.json` input is used as-is; anything else is a directory holding snapshot.json. */
function snapshotPathFor(inputPath) {
  return inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
}

/** Locate, read, and parse the snapshot; a missing file stops the build. */
function readSnapshot(inputPath) {
  const snapshotPath = snapshotPathFor(inputPath);
  if (!existsSync(snapshotPath)) {
    process.stderr.write('radar: no snapshot at ' + snapshotPath + '; pass --input <snapshot.json|dir>\n');
    process.exit(2);
  }
  return parseSnapshot(readFileSync(snapshotPath, 'utf8'));
}

/** Recursively copy a directory, skipping dotfiles, and report how many files moved. */
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
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyTree(source, target);
    } else if (entry.isFile()) {
      copyFileSync(source, target);
      copied += 1;
    }
  }
  return copied;
}

/** Rows the model surfaced that are not already on the house watchlist. */
function earlyCount(rows, watchlist) {
  const listed = new Set(watchlist);
  return rows.filter((row) => !listed.has(row.slug)).length;
}

/** Assemble the dataset `dataScript` writes into `window.RADAR`. */
function dashboardPayload(snapshot, rows, sectors, globalMultiple, live) {
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: earlyCount(rows, snapshot.watchlist),
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

/** Copy `dashboard/` and `screenshots/` into the output, failing when either is incomplete. */
function copyDashboardAssets(outputDir) {
  const rootDir = process.cwd();
  const dashboardFiles = copyTree(join(rootDir, 'dashboard'), join(outputDir, 'dashboard'));
  const screenshotCount = copyTree(join(rootDir, 'screenshots'), join(outputDir, 'screenshots'));
  if (!existsSync(join(outputDir, 'dashboard', 'index.html'))) {
    process.stderr.write('radar: dashboard/index.html is missing from this repository\n');
    process.exit(1);
  }
  if (screenshotCount < 3) {
    process.stderr.write('radar: screenshots/ holds ' + screenshotCount + ' image(s); the gate wants 3: board, detail, filtered\n');
    process.exit(1);
  }
  return { dashboardFiles, screenshotCount };
}

/** Writes every artifact for one output directory: board.json, data.js, static trees, dossier.json. */
function artifactsWriter(outputDir) {
  mkdirSync(outputDir, { recursive: true });
  return {
    writeBoard(board) {
      writeFileSync(join(outputDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
    },
    writeData(payload) {
      writeFileSync(join(outputDir, 'data.js'), dataScript(payload));
    },
    writeStaticAssets() {
      return copyDashboardAssets(outputDir);
    },
    writeDossier() {
      writeFileSync(
        join(outputDir, 'dossier.json'),
        buildDossier(outputDir, {
          text_max_bytes: TEXT_MAX_BYTES,
          screenshots: DOSSIER_SCREENSHOTS,
          dashboard: DOSSIER_DASHBOARD,
        }),
      );
    },
  };
}

/** A short, deterministic report of the build. */
function reportFor(snapshot, board, sectors, globalMultiple, live, assets, outputDir) {
  return [
    'radar: ' + MODEL_VERSION + ' scored ' + snapshot.protocols.length + ' protocols, ' + board.length + ' rows ranked (' + snapshot.watchlist.length + ' watchlisted)',
    'radar: ' + sectors.length + ' sectors, ' + live.length + ' live rows, global multiple ' + globalMultiple.toFixed(4),
    'radar: wrote board.json, data.js, dashboard/ (' + assets.dashboardFiles + ' files), screenshots/ (' + assets.screenshotCount + ') and dossier.json in ' + outputDir,
  ].join('\n') + '\n';
}

/** The named build steps, run in order. Each step mutates the shared context. */
const PIPELINE = [
  {
    name: 'load snapshot',
    apply(context) {
      context.snapshot = readSnapshot(context.input);
    },
  },
  {
    name: 'score board',
    apply(context) {
      const scored = buildBoard(context.snapshot);
      context.board = scored.board;
      context.sectors = scored.sectors;
      context.globalMultiple = scored.global;
    },
  },
  {
    name: 'check board gate',
    apply(context) {
      const issue = boardIssue(context.board, context.snapshot);
      if (issue !== null) {
        process.stderr.write('radar: the board would be refused by the gate: ' + issue + '\n');
        process.exit(1);
      }
    },
  },
  {
    name: 'compute live rows',
    apply(context) {
      context.live = liveRows(context.snapshot);
    },
  },
  {
    name: 'write artifacts',
    apply(context) {
      const payload = dashboardPayload(
        context.snapshot,
        context.board,
        context.sectors,
        context.globalMultiple,
        context.live,
      );
      const writer = artifactsWriter(context.output);
      writer.writeBoard(context.board);
      writer.writeData(payload);
      context.assets = writer.writeStaticAssets();
      writer.writeDossier();
    },
  },
  {
    name: 'report',
    apply(context) {
      process.stdout.write(
        reportFor(
          context.snapshot,
          context.board,
          context.sectors,
          context.globalMultiple,
          context.live,
          context.assets,
          context.output,
        ),
      );
    },
  },
];

/** Run every named step against a fresh context built from argv and the environment. */
function run() {
  const context = argumentsFrom(process.argv.slice(2));
  for (const step of PIPELINE) {
    step.apply(context);
  }
}

run();
