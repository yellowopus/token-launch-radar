# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yellowopus/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yellowopus/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the make.fun "Build the best token launch radar" bounty. It scans a sealed
snapshot of every protocol DefiLlama tracks and surfaces the ones that still have no token. Wrapped,
staked, and bridged products of an already-trading protocol are excluded, so a derivative pool is never
confused with a fresh launch. Each remaining candidate is ranked by the value its launch would unlock,
using a sector multiple measured from the snapshot itself rather than written by hand. The delivered
dashboard shows the full ranked board, a per-protocol detail view with the implied-value equation, and
the concrete steps to farm each candidate. Two runs over the same snapshot write the same bytes, so the
submission is reproducible end to end.

## The model

`implied = round( TVL × sectorMultiple × growthMult × maturityMult )`

- **sectorMultiple** is measured from the snapshot: the median market-cap-to-TVL ratio of protocols in
  the same category that already trade, pulled back toward the whole-market median while the sample is
  small; a category with no precedent borrows the market median.
- **growthMult** weights the protocol's own seven-day TVL change, clamped to −60%…+120%.
- **maturityMult** discounts a launch that has not happened yet (0.55) and rewards a protocol that has
  waited longer with no token, up to three years.
- Ties break by TVL, then slug. Two runs on the same snapshot write the same bytes.

The board covers every slug on the house watchlist (40 here) and adds 157 earlier pre-token candidates
below the $50M floor — 197 rows in all. Every row carries a farm plan of six concrete steps, each
naming the action, its cost, and how long it takes. Protocols whose token already trades are set aside
in a live view, because their market cap is a fact rather than a model — and it is where the multiples
come from.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Requires Node 22.18 or later, standard library only, nothing to install. Each run writes these files into
the output directory:

- `board.json` — the ranked board rows.
- `data.js` — the dataset for the page, written beside the page so it needs no network.
- `dashboard/` — a static page that renders offline.
- `screenshots/` — the board, a detail view, and a filtered view.
- `dossier.json` — the make.fun submission dossier.

To open the page: serve `out/` and open `dashboard/index.html`, or load it from disk beside `data.js`
at the parent level.

## Layout

- `main.ts` — entrypoint: parse, score, validate, write.
- `lib/model.ts` — the valuation, the farm plans, and the snapshot parser.
- `dashboard/` — the page: board table with search, category filter, sorting, and a pre-token/live
  toggle; a per-protocol detail drawer with the implied-value equation and the farm plan; a method
  panel stating the formula and the sector multiples.
- `screenshots/` — the board, a detail view, and a filtered view.
- `vendor/makefun-board.ts` — the make.fun dossier library, byte-identical to the kit.

## Board coverage

The snapshot spans 758 protocols tracked by DefiLlama, and the radar isolates the pre-token
candidates. It keeps all 40 watchlisted slugs and lowers the floor to rank 197 rows in total. The
remaining token-bearing protocols stay in the live view, where their market caps feed the sector
multiples.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
