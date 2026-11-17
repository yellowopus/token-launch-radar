// Launch Radar's page. It renders the ranked board, a detail drawer per protocol, a filter and the
// model's method panel from window.RADAR, which main.ts writes as data.js beside this directory.
// No network: every byte it shows is already on disk.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = { q: '', category: 'all', sort: 'implied', dir: -1, tab: 'board', open: null };

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === null || v === undefined) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var neg = n < 0;
    var a = Math.abs(n);
    var s;
    if (a >= 1e12) s = '$' + (a / 1e12).toFixed(2) + 'T';
    else if (a >= 1e9) s = '$' + (a / 1e9).toFixed(2) + 'B';
    else if (a >= 1e6) s = '$' + (a / 1e6).toFixed(1) + 'M';
    else if (a >= 1e3) s = '$' + Math.round(a / 1e3) + 'K';
    else s = '$' + Math.round(a);
    return neg ? '-' + s : s;
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yr';
    if (days >= 30) return Math.round(days / 30) + ' mo';
    return Math.max(0, Math.round(days)) + ' d';
  }

  function chainLabel(row) {
    var chains = row.chains || [];
    if (chains.length === 0) return 'unnamed chain';
    return chains.slice(0, 2).join(' · ');
  }

  function readSearch() {
    var params = new URLSearchParams(window.location.search);
    var q = params.get('q');
    if (q) state.q = q;
    var category = params.get('category');
    if (category) state.category = category;
    var open = params.get('open');
    if (open) state.open = open;
    var sort = params.get('sort');
    if (sort) state.sort = sort;
    var tab = params.get('tab');
    if (tab === 'live') state.tab = 'live';
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortBtn(key, label) {
    return el('th', null,
      el('button', {
        'data-active': state.sort === key ? 'true' : 'false',
        onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); },
      }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? '▾' : '▴' }) : null)
    );
  }

  function mast() {
    return el('header', { class: 'mast' },
      el('div', { class: 'brand' },
        el('div', { class: 'radar-dot', 'aria-hidden': 'true' }),
        el('div', { class: 'brand-text' },
          el('span', { class: 'brand-name', text: 'Launch Radar' }),
          el('span', { class: 'brand-sub', text: 'pre-token protocols, ranked by implied value · model ' + DATA.model_version })
        )
      ),
      el('div', { class: 'stamp' },
        el('div', null, el('span', { text: 'Snapshot' }), el('b', { text: DATA.as_of })),
        el('div', null, el('span', { text: 'Universe' }), el('b', { text: DATA.rows.length + ' pre-token' })),
        el('div', null, el('span', { text: 'Source' }), el('b', { text: 'DefiLlama · sealed' }))
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', null, DATA.watchlist_size + ' watchlist protocols, ', el('em', { text: DATA.rows.length + ' ranked' })),
        el('p', { class: 'lede' },
          'The watchlist is every tracked protocol at or above ', el('b', { text: fmtUsd(DATA.floor_usd) }),
          ' of TVL that still records no token — the floor, not the ceiling. This board also ranks ',
          el('b', { text: DATA.early_size + ' earlier candidates' }),
          ' below that line, because a launch nobody has noticed is the radar\'s reason to exist. Implied value is a model\'s estimate of what each protocol\'s token would be worth if its record stayed as it is: ',
          el('b', { text: 'TVL × sector multiple × growth × maturity' }),
          ', measured from the snapshot itself. It is a claim to judge, not a promise.'
        )
      ),
      el('div', { class: 'kpis' },
        kpi(DATA.rows.length, 'Rows ranked'),
        kpi(DATA.watchlist_size, 'Watchlist covered'),
        kpi(DATA.early_size, 'Early, below floor'),
        kpi(DATA.live.length, 'Live tokens set aside')
      )
    );
  }

  function kpi(value, label) {
    return el('div', { class: 'kpi' }, el('b', { text: String(value) }), el('span', { text: label }));
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain…', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; render(); });
    var sortSelect = el('select', { id: 'sort', 'aria-label': 'Sort by' },
      el('option', { value: 'implied', text: 'Implied value', selected: state.sort === 'implied' ? 'selected' : null }),
      el('option', { value: 'tvl', text: 'TVL', selected: state.sort === 'tvl' ? 'selected' : null }),
      el('option', { value: 'growth', text: '7d growth', selected: state.sort === 'growth' ? 'selected' : null }),
      el('option', { value: 'age', text: 'Age with no token', selected: state.sort === 'age' ? 'selected' : null }),
      el('option', { value: 'name', text: 'Name', selected: state.sort === 'name' ? 'selected' : null })
    );
    sortSelect.addEventListener('change', function () { state.sort = sortSelect.value; state.dir = sortSelect.value === 'name' ? 1 : -1; render(); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sortSelect),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }),
        el('div', { class: 'seg' },
          el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', onclick: function () { state.tab = 'board'; render(); }, text: 'Pre-token' }),
          el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', onclick: function () { state.tab = 'live'; render(); }, text: 'Live tokens' })
        )
      ),
      el('div', { class: 'grow' }),
      el('span', { class: 'tally' }, state.tab === 'board' ? el('b', { text: String(filtered().length) }) : el('b', { text: String(DATA.live.length) }),
        state.tab === 'board' ? ' of ' + DATA.rows.length + ' shown' : ' live protocols'),
      el('button', { class: 'reset', type: 'button', text: 'Reset', onclick: function () { state.q = ''; state.category = 'all'; state.sort = 'implied'; state.dir = -1; render(); } })
    );
  }

  function boardTable() {
    var list = sorted(filtered());
    if (list.length === 0) {
      return el('div', { class: 'board' }, el('div', { class: 'empty' },
        el('h3', { text: 'Nothing on the radar for that filter' }),
        el('p', { text: 'Clear the search or pick another category.' }),
        el('button', { class: 'reset', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var cls = r.change_7d === null || !isFinite(r.change_7d) ? '' : r.change_7d >= 0 ? 'up' : 'down';
      tbody.appendChild(el('tr', {
        'data-open': state.open === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDrawer(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r.slug); } }
      },
        el('td', { class: 'rank' }, el('b', { text: '#' + r.rank })),
        el('td', null, el('div', { class: 'who' },
          el('b', { text: r.name }),
          el('span', { class: 'meta' }, r.category || 'Other', el('span', { class: 'sep', text: '·' }), chainLabel(r))
        )),
        el('td', { class: 'n', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'n ' + cls, text: growth }),
        el('td', { class: 'n', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'val' },
          el('div', { class: 'gauge', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'n', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'chip ' + (r.on_watchlist ? 'wl' : 'early'), text: r.on_watchlist ? 'watchlist' : 'early radar' }))
      ));
    });
    return el('div', { class: 'board' }, el('div', { class: 'scroll' },
      el('table', null,
        el('caption', { class: 'meta', style: 'text-align:left;padding:var(--s3)', text: 'Pre-token protocols, strongest implied value first. Select a row for the equation and the farm plan.' }),
        el('thead', null, el('tr', null,
          sortBtn('implied', 'Rank'),
          sortBtn('name', 'Protocol'),
          sortBtn('tvl', 'TVL'),
          sortBtn('growth', '7d'),
          sortBtn('age', 'No token for'),
          sortBtn('implied', 'Implied value'),
          el('th', { text: 'Status' })
        )),
        tbody
      )
    ));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'chip live', text: 'trading' })),
        el('td', null, el('div', { class: 'who' },
          el('b', { text: r.name }),
          el('span', { class: 'meta' }, (r.symbol || '—') + ' · ' + (r.category || 'Other') + ' · ' + chainLabel(r))
        )),
        el('td', { class: 'n', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'n ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'n', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'n', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : 'n/a' })
      ));
    });
    return el('div', { class: 'board' }, el('div', { class: 'scroll' },
      el('table', null,
        el('caption', { class: 'meta', style: 'text-align:left;padding:var(--s3)', text: 'These protocols already trade, so their market cap is a fact, not a model — and it is where every sector multiple comes from.' }),
        el('thead', null, el('tr', null,
          el('th', { text: 'Status' }),
          el('th', { text: 'Protocol' }),
          el('th', { text: 'TVL' }),
          el('th', { text: '7d' }),
          el('th', { text: 'Market cap' }),
          el('th', { text: 'MC / TVL' })
        )),
        tbody
      )
    ));
  }

  function methodPanel() {
    var sectors = DATA.sectors.filter(function (s) { return s.samples > 0; });
    return el('section', { class: 'panel' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', null, 'Every row is scored by one function of the snapshot\'s own figures. No protocol name is special-cased, and nothing on the board is hand-picked. The page and the board.json carry the same arithmetic.'),
      el('div', { class: 'formula' },
        'implied = round( tvl × ', el('b', { text: 'sectorMultiple' }), ' × ', el('b', { text: 'growthMult' }), ' × ', el('b', { text: 'maturityMult' }), ' )\n\n',
        'sectorMultiple = median( mcap ÷ tvl ) of this category\'s protocols that already trade\n',
        '                 shrunk toward the whole market\'s median (' + DATA.global_multiple.toFixed(4) + ') while the sample is small;\n',
        '                 a category with no precedent borrows the market median\n\n',
        'growthMult   = 1 + clamp(change_7d, -60, +120) ÷ 100 × ' + DATA.growth_weight.toFixed(2) + '\n',
        'maturityMult = ' + DATA.maturity_floor.toFixed(2) + ' + min(age_days, ' + DATA.maturity_days + ') ÷ ' + DATA.maturity_days + ' × ' + DATA.maturity_range.toFixed(2),
        '   (age unknown: ' + Math.round(365) + ' days)\n\n',
        'age_days     = days from listed_at to the snapshot day: how long the protocol has run with no token'
      ),
      el('p', { text: 'Sector multiples in force — measured means the category has token-bearing precedents in this snapshot; borrowed means it uses the market median.' }),
      el('div', { class: 'sector-grid' }, sectors.map(function (s) {
        return el('div', { class: 'sector' + (s.measured ? '' : ' borrowed') },
          el('span', { text: s.category + (s.measured ? '' : ' (borrowed)') }),
          el('b', { text: s.multiple.toFixed(4) + '×' })
        );
      })),
      el('p', { text: 'Reading it: TVL is the money already at work; the sector multiple says what that money\'s tokens sell for in this category today; growth weighs the last week; maturity discounts a launch that has not happened yet, but rewards a protocol that has waited longer. A young protocol with fast-growing TVL in a high-multiple category lands near the top; an old, shrinking one in a low-multiple category sinks.' }),
      el('ul', { class: 'notes' },
        el('li', null, 'The watchlist is the floor, never the ceiling: ', el('b', { text: String(DATA.early_size) }), ' ranked rows sit below ', el('b', { text: fmtUsd(DATA.floor_usd) }), ' of TVL.'),
        el('li', null, 'The live-token tab shows the protocols the multiples are measured from.'),
        el('li', null, 'Every farm plan carries the action, what it costs and how long it takes.'),
        el('li', null, 'Implied value is an estimate, never a price and never a promise.')
      )
    );
  }

  var drawerRoot = document.getElementById('drawer-root');

  function closeDrawer() {
    state.open = null;
    render();
  }

  function openDrawer(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.open = slug;
    render();
    var body = document.querySelector('.drawer-body');
    if (body) body.scrollTop = 0;
  }

  function drawer() {
    var row = DATA.rows.filter(function (r) { return r.slug === state.open; })[0];
    if (!row) return null;
    var sector = DATA.sectors.filter(function (s) { return s.category === (row.category || 'Other'); })[0];
    var eq = el('div', { class: 'eq' },
      eqRow('TVL at snapshot', fmtUsd(row.tvl_usd)),
      eqRow('Sector multiple' + (sector && !sector.measured ? ' (borrowed)' : ''), row.sector_multiple.toFixed(4) + '×'),
      eqRow('Growth multiplier', row.growth_multiplier.toFixed(4) + '×'),
      eqRow('Maturity multiplier', row.maturity_multiplier.toFixed(4) + '×')
    );
    eq.appendChild(el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })));
    var plan = el('ol', { class: 'plan' });
    row.farm_steps.forEach(function (step) {
      var at = step.indexOf(' Cost: ');
      var action = at >= 0 ? step.slice(0, at) : step;
      var tail = at >= 0 ? step.slice(at + 1) : '';
      plan.appendChild(el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail })));
    });
    return [
      el('div', { class: 'backdrop', onclick: closeDrawer }),
      el('aside', { class: 'drawer', role: 'dialog', 'aria-label': row.name },
        el('div', { class: 'drawer-head' },
          el('div', { class: 'row' },
            el('div', null,
              el('div', { class: 'eyebrow', text: 'Rank #' + row.rank + ' of ' + DATA.rows.length + (row.on_watchlist ? ' · watchlist' : ' · early radar') }),
              el('h2', { text: row.name }),
              el('div', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'unnamed chain') + (row.listed_at ? ' · tracked since ' + row.listed_at : ' · tracking start unknown') })
            ),
            el('button', { class: 'x', type: 'button', 'aria-label': 'Close', text: '×', onclick: closeDrawer })
          )
        ),
        el('div', { class: 'drawer-body' },
          el('section', { class: 'block' },
            el('h3', { text: 'The implied-value equation' }),
            eq,
            el('p', { class: 'meta', text: 'Same arithmetic as the board: one function of the snapshot\'s figures. ' + (sector && sector.measured ? 'The ' + sector.category + ' multiple is measured from ' + sector.samples + ' trading precedents in this snapshot.' : 'This category has too few trading precedents in the snapshot, so the multiple is the whole market\'s median of ' + DATA.global_multiple.toFixed(4) + '.') })
          ),
          el('section', { class: 'block' },
            el('h3', { text: 'At a glance' }),
            el('div', { class: 'facts' },
              fact('TVL', fmtUsd(row.tvl_usd)),
              fact('7d change', fmtPct(row.change_7d)),
              fact('No token for', fmtAge(row.age_days)),
              fact('Watchlist', row.on_watchlist ? 'on the list' : 'below floor'),
              fact('Implied value', fmtUsd(row.implied_value_usd)),
              fact('Status', 'records no token')
            )
          ),
          el('section', { class: 'block' },
            el('h3', { text: 'How to farm it' }),
            plan
          ),
          el('p', { class: 'meta', text: 'Farm plans assume you want the airdrop, not the yield: positions stay small, activity repeats weekly, and every step names what it costs and how long it takes. Nothing here is financial advice.' })
        )
      )
    ];
  }

  function eqRow(label, value) {
    return el('div', null, el('span', { text: label }), el('b', { text: value }));
  }

  function fact(label, value) {
    return el('div', { class: 'fact' }, el('span', { text: label }), el('b', { text: value }));
  }

  function footer() {
    return el('footer', null,
      el('span', null, el('b', { text: 'Launch Radar' }), ' · ' + DATA.rows.length + ' protocols ranked · ' + DATA.watchlist_size + ' watchlist slugs covered · snapshot ' + DATA.as_of),
      el('span', null, 'Data: DefiLlama protocol index, fetched once and sealed. Implied values are estimates.')
    );
  }

  function render() {
    var app = document.getElementById('app');
    if (!app) return;
    app.textContent = '';
    app.appendChild(mast());
    app.appendChild(hero());
    app.appendChild(controls());
    if (state.tab === 'board') {
      app.appendChild(boardTable());
      app.appendChild(methodPanel());
    } else {
      app.appendChild(liveTable());
    }
    app.appendChild(footer());
    drawerRoot.textContent = '';
    var d = drawer();
    if (d) d.forEach(function (n) { drawerRoot.appendChild(n); });
    app.setAttribute('aria-busy', 'false');
  }

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.open) closeDrawer();
  });

  readSearch();
  render();
})();
