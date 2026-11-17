# Launch Radar — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yellowopus/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yellowopus/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty: it reads a sealed
snapshot of every protocol DefiLlama tracks, finds the ones that still record no token and are not
wrapped, staked or bridged products of one that already trades, ranks them by what their launch would
be worth, and hands in a dashboard that shows the board, a detail view per protocol and the steps to
farm each one.

## The model

`implied = round( TVL × sectorMultiple × growthMult × maturityMult )`

- **sectorMultiple** is measured from the snapshot itself: the median market-cap-to-TVL ratio of the
  protocols in the same category that already trade, shrunk toward the whole market's median while the
  sample is small; a category with no precedent borrows the market median.
- **growthMult** weighs the protocol's own seven-day TVL change (clamped to −60%…+120%).
- **maturityMult** discounts a launch that has not happened yet (0.55) but rewards a protocol that has
  waited longer with no token, up to three years.
- Ties break by TVL, then slug. Two runs on the same snapshot write the same bytes.

The board covers every slug on the house watchlist (40 here) and adds 157 earlier pre-token candidates
below the $50M floor — 197 rows in all. Every row carries a farm plan of six concrete steps, each
naming the action, what it costs and how long it takes. Protocols whose token already trades are set
aside in a live view, because their market cap is a fact, not a model — and it is where the multiples
come from.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Node 22.18 or later, standard library only, nothing to install. The output directory gets
`board.json` (the ranked rows), `data.js` (the page's dataset), `dashboard/` (a static page that
renders offline), `screenshots/` and `dossier.json`. To open the page: serve `out/` and open
`dashboard/index.html`, or load it from disk beside `data.js` at the parent level.

## Layout

- `main.ts` — entrypoint: parse, score, validate, write.
- `lib/model.ts` — the valuation, the farm plans, and the snapshot parser.
- `dashboard/` — the page: board table with search, category filter, sorting and a pre-token/live
  toggle; a per-protocol detail drawer with the implied-value equation and the farm plan; a method
  panel stating the formula and the sector multiples.
- `screenshots/` — the board, a detail view, a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte-identical to the kit's.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
