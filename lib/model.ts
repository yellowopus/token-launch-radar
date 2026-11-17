// lib/model.ts — the radar's valuation engine.
//
// Everything the board shows is derived from the sealed snapshot: no protocol name is special-cased and
// no implied value is hand-written. The sector multiple is measured from the snapshot itself — the
// median market-cap-to-TVL ratio of the protocols in the same category that already trade — so the
// board's claim about what a launch would be worth is an argument built out of the same file it reads.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** A row of the ranked board, as board.json carries it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  sector_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A protocol whose token already trades: shown beside the board, never ranked by the model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** How one category's multiple was measured, so the page can show its work. */
export interface SectorStat {
  category: string;
  multiple: number;
  samples: number;
  measured: boolean;
}

/** Everything dashboard/data.js needs, written by main.ts. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  global_multiple: number;
  growth_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  sectors: SectorStat[];
  rows: BoardRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'sector-median-v1';

/** Constants of the valuation, named in the dashboard's method panel. */
export const MODEL = {
  growthWeight: 0.35,
  growthFloor: -60,
  growthCap: 120,
  maturityFloor: 0.55,
  maturityRange: 0.45,
  maturityDays: 1095,
  unknownAgeDays: 365,
  minSamplesForOwnMultiple: 3,
  fullTrustSamples: 8,
  fallbackMultiple: 0.2049,
};

const DAY_MS = 86_400_000;
const MAX_IMPLIED = 100_000_000_000_000;

/** Categories that are not a protocol waiting on its own token: bridges, staking and exchange products. */
const PRODUCT_CATEGORIES = new Set([
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Canonical Bridge',
  'Bridge',
  'Cross Chain Bridge',
  'CEX',
  'Stablecoin Wrapper',
  'Anchor BTC',
  'Decentralized BTC',
]);

/** DefiLlama's version marker: a name ending in a release is a pool of another protocol, not a launch. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Whole days from the day DefiLlama began tracking the protocol to the snapshot's day. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** A protocol whose record names no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/** Whether a pre-token protocol is a candidate for its own launch rather than a product of one that trades. */
export function isCandidate(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !PRODUCT_CATEGORIES.has(p.category ?? '') && !VERSIONED_NAME.test(p.name);
}

/**
 * The sector multiple: for every category, the median mcap/TVL of its protocols that already trade,
 * shrunk toward the whole market's median while the sample is small. A category with no precedent in
 * the snapshot falls back to the market median, and the page labels it measured or borrowed.
 */
export function sectorMultiples(protocols: SnapshotProtocol[]): {
  global: number;
  byCategory: Map<string, { multiple: number; samples: number; measured: boolean }>;
} {
  const ratios: number[] = [];
  const groups = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.tvl_usd <= 0 || p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    ratios.push(ratio);
    const key = p.category ?? 'Other';
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [ratio]);
    else bucket.push(ratio);
  }
  const global = ratios.length >= 5 ? median(ratios) : MODEL.fallbackMultiple;
  const byCategory = new Map<string, { multiple: number; samples: number; measured: boolean }>();
  for (const [category, values] of groups) {
    const samples = values.length;
    if (samples < MODEL.minSamplesForOwnMultiple) continue;
    const trust = Math.min(1, samples / MODEL.fullTrustSamples);
    const measured = median(values);
    byCategory.set(category, { multiple: round4(trust * measured + (1 - trust) * global), samples, measured: true });
  }
  return { global: round4(global), byCategory };
}

/** The three multipliers behind one row's implied value. */
export function score(
  p: SnapshotProtocol,
  asOf: string,
  sector: { multiple: number; samples: number; measured: boolean },
): { implied: number; age: number | null; growthMultiplier: number; maturityMultiplier: number; sectorMultiple: number } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d) ?? 0;
  const growth = Math.min(MODEL.growthCap, Math.max(MODEL.growthFloor, rawGrowth));
  const growthMultiplier = 1 + (growth / 100) * MODEL.growthWeight;
  const ageForModel = age ?? MODEL.unknownAgeDays;
  const maturityMultiplier =
    MODEL.maturityFloor +
    (Math.min(Math.max(ageForModel, 0), MODEL.maturityDays) / MODEL.maturityDays) * MODEL.maturityRange;
  const raw = p.tvl_usd * sector.multiple * growthMultiplier * maturityMultiplier;
  const implied = Math.min(MAX_IMPLIED, Math.max(1, Math.round(Number.isFinite(raw) ? raw : 1)));
  return { implied, age, growthMultiplier: round4(growthMultiplier), maturityMultiplier: round4(maturityMultiplier), sectorMultiple: sector.multiple };
}

/** How much one position needs, scaled to the protocol's own size. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 25_000_000) return 75;
  return 50;
}

/** The qualifying window: a young protocol needs more weeks of activity to look committed. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's own first move, in the words a farmer can follow. */
function openPosition(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager'))
    return `Allocate $${capital} of USDC into one ${n} vault on ${chain}, read its curator mandate and fee first, and keep the shares.`;
  if (c.includes('rwa') || c.includes('treasury') || c.includes('private credit'))
    return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain}, confirm the issuer and redemption terms, and hold it.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow a small amount against it to leave two positions on record.`;
  if (c.includes('dex') || c.includes('farm') || c.includes('yield'))
    return `Provide $${capital} of liquidity to ${n}'s deepest pool on ${chain} and keep the LP position open.`;
  if (c.includes('perp') || c.includes('derivative') || c.includes('basis'))
    return `Deposit $${capital} of USDC as margin on ${n} and keep one small hedge open for a week.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${n} and hold one position in a market that resolves within the month.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active through the term.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset ${n} issues on ${chain} and hold it in the same wallet.`;
  if (c.includes('chain'))
    return `Bridge $${capital} of USDC onto ${n}, use one app on it, and keep the balance there for the season.`;
  if (c.includes('payment') || c.includes('card'))
    return `Move $${capital} through ${n} on ${chain} and keep a small recurring balance on the account.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open past the next snapshot.`;
}

/**
 * The farm plan: five to eight steps, each with the action, what it costs and how long it takes. It is
 * derived from the protocol's own record — category, chains, TVL and age — never from a name list.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, onWatchlist: boolean): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdWindow(age);
  const gas = capital >= 150 ? 9 : 4;
  const holdLabel = hold >= 60 ? 'two months' : hold >= 45 ? 'six weeks' : 'a month';
  const steps = [
    `Create a dedicated wallet for farm capital: fresh keys, seed phrase offline, separate from savings. Cost: under $2 of gas to fund. Time: 10 minutes.`,
    openPosition(p, capital, chain) + ` Cost: $${capital} capital plus ~$${gas} gas. Time: 20 minutes.`,
    `Make one qualifying action a week — deposit, borrow, swap or vote — so the address reads as an active user, not a one-off transfer. Cost: ~$2 of gas weekly. Time: 10 minutes weekly.`,
    `Hold the position for ${hold} days: activity across two snapshot windows reads better than one, and most points programmes count activity over ${holdLabel}. Cost: the $${capital} stays committed for ${hold} days. Time: ${hold} days.`,
    onWatchlist
      ? `Watch ${p.name}'s own channels for a launch announcement; if a token or points programme opens, claim only from the protocol's site — never a DM link. Cost: free to watch; never pay to claim. Time: 10 minutes weekly.`
      : `Before adding capital, confirm ${p.name} still records no token: smaller protocols move faster, so re-check its TVL and announcements monthly. Cost: free. Time: 15 minutes monthly.`,
    `Log the wallet, dates, amounts and transaction hashes in one file so the position can be repeated, scaled or unwound without guesswork. Cost: free. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s.length < 20 ? `${s} Keep the receipt.` : s));
}

/** Rows ranked by implied value; the watchlist is the floor of the board, never its ceiling. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; sectors: SectorStat[]; global: number } {
  const sector = sectorMultiples(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (watchlist.has(p.slug) || isCandidate(p)) chosen.set(p.slug, p);
  }
  const sectors: SectorStat[] = [];
  const rows = [...chosen.values()].map((p) => {
    const key = p.category ?? 'Other';
    const stat = sector.byCategory.get(key) ?? { multiple: sector.global, samples: 0, measured: false };
    const scored = score(p, snapshot.as_of, stat);
    sectors.push({ category: key, multiple: stat.multiple, samples: stat.samples, measured: stat.measured });
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: scored.age,
      implied_value_usd: scored.implied,
      sector_multiple: scored.sectorMultiple,
      growth_multiplier: scored.growthMultiplier,
      maturity_multiplier: scored.maturityMultiplier,
      on_watchlist: watchlist.has(p.slug),
      farm_steps: farmPlan(p, scored.age, watchlist.has(p.slug)),
    };
  });
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  const board = rows.map((row, i) => ({ rank: i + 1, ...row }));
  const unique = new Map<string, SectorStat>();
  for (const s of sectors) if (!unique.has(s.category)) unique.set(s.category, s);
  return {
    board,
    sectors: [...unique.values()].sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1)),
    global: sector.global,
  };
}

/** The protocols that already trade, for the page's live tab. */
export function liveRows(snapshot: Snapshot, limit = 30): LiveRow[] {
  return snapshot.protocols
    .filter((p) => (p.gecko_id !== null || p.symbol !== null) && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** Why the board the gate would refuse, or null when it passes every rule the scorer applies. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows and needs 100`;
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  }
  const values = new Set(board.map((r) => r.implied_value_usd));
  if (board.length >= 2 && values.size === 1) return `all ${board.length} rows share one implied value`;
  for (const row of board) {
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug} has a farm step of ${len} characters`;
    }
  }
  if (board.length > 0 && board[0]!.rank !== 1) return 'the first row is rank ' + board[0]!.rank;
  return null;
}

/** data.js: the page's whole dataset, written beside it so the page needs no network. */
export function dataScript(data: RadarData): string {
  return `window.RADAR=${JSON.stringify(data)};\n`;
}

/** A compact, human-readable label for a value that failed validation. */
const describe = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'string' ? `string ${JSON.stringify(value.slice(0, 40))}` : typeof value;
};

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`snapshot.json is not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('snapshot.json must be a JSON object, not an array or scalar');
  }
  const o = raw as Record<string, unknown>;
  const asOf = o.as_of;
  const source = o.source;
  const floorUsd = o.floor_usd;
  const protocolEntries = o.protocols;
  const watchlistEntries = o.watchlist;

  if (typeof asOf !== 'string' || !Number.isFinite(Date.parse(`${asOf}T00:00:00Z`))) {
    throw new Error(`snapshot.json field "as_of" must be a YYYY-MM-DD date; got ${describe(asOf)}`);
  }
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error(`snapshot.json field "source" must be a non-empty string; got ${describe(source)}`);
  }
  if (typeof floorUsd !== 'number' || !Number.isFinite(floorUsd) || floorUsd < 0) {
    throw new Error(`snapshot.json field "floor_usd" must be a finite non-negative number; got ${describe(floorUsd)}`);
  }
  if (!Array.isArray(protocolEntries)) {
    throw new Error(`snapshot.json field "protocols" must be an array; got ${describe(protocolEntries)}`);
  }
  if (!Array.isArray(watchlistEntries)) {
    throw new Error(`snapshot.json field "watchlist" must be an array; got ${describe(watchlistEntries)}`);
  }

  const protocols = protocolEntries.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`snapshot.json protocols[${i}] must be an object; got ${describe(entry)}`);
    }
    const p = entry as Record<string, unknown>;
    const slug = p.slug;
    const name = p.name;
    const tvl = p.tvl_usd;
    const rawChains = p.chains;
    if (typeof slug !== 'string' || slug.length === 0) {
      throw new Error(`snapshot.json protocols[${i}].slug must be a non-empty string; got ${describe(slug)}`);
    }
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`snapshot.json protocols[${i}].name must be a non-empty string; got ${describe(name)}`);
    }
    if (typeof tvl !== 'number' || !Number.isFinite(tvl)) {
      throw new Error(`snapshot.json protocols[${i}].tvl_usd must be a finite number; got ${describe(tvl)}`);
    }
    if (rawChains !== undefined && rawChains !== null && !Array.isArray(rawChains)) {
      throw new Error(`snapshot.json protocols[${i}].chains must be an array of strings; got ${describe(rawChains)}`);
    }
    const chains = (Array.isArray(rawChains) ? rawChains : []).map((chain, j) => {
      if (typeof chain !== 'string' || chain.length === 0) {
        throw new Error(`snapshot.json protocols[${i}].chains[${j}] must be a non-empty string; got ${describe(chain)}`);
      }
      return chain;
    });
    const category = typeof p.category === 'string' ? p.category : null;
    const gecko = typeof p.gecko_id === 'string' && p.gecko_id !== '-' ? p.gecko_id : null;
    const symbol = typeof p.symbol === 'string' && p.symbol !== '-' ? p.symbol : null;
    return {
      slug,
      name,
      category,
      chains,
      tvl_usd: tvl,
      change_7d: finite(p.change_7d),
      mcap_usd: finite(p.mcap_usd),
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: gecko,
      symbol,
    } satisfies SnapshotProtocol;
  });

  const slugCounts = new Map<string, number>();
  for (const p of protocols) slugCounts.set(p.slug, (slugCounts.get(p.slug) ?? 0) + 1);
  const duplicateSlugs = [...slugCounts].filter(([, count]) => count > 1).map(([slug]) => slug);
  if (duplicateSlugs.length > 0) {
    throw new Error(`snapshot.json protocols has duplicate slug(s): ${duplicateSlugs.slice(0, 5).join(', ')}`);
  }

  const watchlist = watchlistEntries.map((entry, i) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`snapshot.json watchlist[${i}] must be a non-empty string; got ${describe(entry)}`);
    }
    return entry;
  });
  const knownSlugs = new Set(protocols.map((p) => p.slug));
  const missingSlugs = watchlist.filter((slug) => !knownSlugs.has(slug));
  if (missingSlugs.length > 0) {
    throw new Error(`snapshot.json watchlist names ${missingSlugs.length} slug(s) absent from protocols: ${missingSlugs.slice(0, 5).join(', ')}`);
  }

  return { as_of: asOf, source, floor_usd: floorUsd, protocols, watchlist };
}

/** Assert the board obeys every invariant the scorer guarantees, throwing the first issue found. */
export function assertBoardInvariants(board: BoardRow[], snapshot: Snapshot): void {
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(issue);
}
