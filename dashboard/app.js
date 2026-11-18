// The Launch Radar dashboard: it renders the ranked board, the live-token table, the filters and
// the per-protocol detail drawer straight from window.RADAR. main.ts writes that object into data.js,
// which index.html loads immediately before this file, so the page never touches the network.
(function () {
  'use strict';
  const DATA = window.RADAR;
  if (!DATA) return;
  // Everything the user can change between renders lives here; the URL seeds the initial values.
  const state = { q: '', category: 'all', sort: 'implied', dir: -1, tab: 'board', open: null };

  // DOM builder: class/text/html get special handling, on* binds listeners, and the remaining
  // arguments become children (arrays are flattened and strings become text nodes).
  function make(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key in attrs) {
        const value = attrs[key];
        if (value === null || value === undefined) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      }
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach((item) => { if (item) node.appendChild(item); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Formatting helpers shared by the board, the drawer and the footer.
  const missing = (n) => n === null || n === undefined || !isFinite(n);
  function money(n) {
    if (missing(n)) return 'n/a';
    const negative = n < 0;
    const amount = Math.abs(n);
    let text;
    if (amount >= 1e12) text = '$' + (amount / 1e12).toFixed(2) + 'T';
    else if (amount >= 1e9) text = '$' + (amount / 1e9).toFixed(2) + 'B';
    else if (amount >= 1e6) text = '$' + (amount / 1e6).toFixed(1) + 'M';
    else if (amount >= 1e3) text = '$' + Math.round(amount / 1e3) + 'K';
    else text = '$' + Math.round(amount);
    return negative ? '-' + text : text;
  }
  function percent(n) {
    if (missing(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yr';
    if (days >= 30) return Math.round(days / 30) + ' mo';
    return Math.max(0, Math.round(days)) + ' d';
  }
  const chainText = (row) => { const chains = row.chains || []; return chains.length === 0 ? 'unnamed chain' : chains.slice(0, 2).join(' · '); };
  const categoryOf = (row) => row.category || 'Other';

  // Pull the initial filters, sort, tab and open row from the address-bar query string.
  function readUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('open')) state.open = params.get('open');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  const searchText = (row) => [row.name, row.slug, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase();
  function visibleRows() {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((row) => {
      if (state.category !== 'all' && categoryOf(row) !== state.category) return false;
      if (!q) return true;
      return searchText(row).indexOf(q) !== -1;
    });
  }
  function sortValue(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d === null ? -Infinity : row.change_7d;
    if (key === 'age') return row.age_days === null ? Infinity : row.age_days;
    return row.implied_value_usd;
  }
  function ordered(rows) {
    const key = state.sort;
    return rows.slice().sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // A sortable column header; clicking toggles direction or switches the active sort key.
  function sortHeader(key, label) {
    const active = state.sort === key;
    return make('th', null,
      make('button', {
        'data-active': active ? 'true' : 'false',
        onclick: () => {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          render();
        },
      }, label, active ? make('span', { 'aria-hidden': 'true', text: state.dir < 0 ? '▾' : '▴' }) : null)
    );
  }
  function masthead() {
    return make('header', { class: 'mast' },
      make('div', { class: 'brand' },
        make('div', { class: 'radar-dot', 'aria-hidden': 'true' }),
        make('div', { class: 'brand-text' },
          make('span', { class: 'brand-name', text: 'Launch Radar' }),
          make('span', { class: 'brand-sub', text: 'pre-token protocols, ranked by implied value · model ' + DATA.model_version })
        )
      ),
      make('div', { class: 'stamp' },
        make('div', null, make('span', { text: 'Snapshot' }), make('b', { text: DATA.as_of })),
        make('div', null, make('span', { text: 'Universe' }), make('b', { text: DATA.rows.length + ' pre-token' })),
        make('div', null, make('span', { text: 'Source' }), make('b', { text: 'DefiLlama · sealed' }))
      )
    );
  }
  const kpi = (value, label) => make('div', { class: 'kpi' }, make('b', { text: String(value) }), make('span', { text: label }));
  function hero() {
    return make('section', { class: 'hero' },
      make('div', null,
        make('h1', null, DATA.watchlist_size + ' watchlist protocols, ', make('em', { text: DATA.rows.length + ' ranked' })),
        make('p', { class: 'lede' },
          'The watchlist is every tracked protocol at or above ', make('b', { text: money(DATA.floor_usd) }),
          ' of TVL that still records no token — the floor, not the ceiling. This board also ranks ',
          make('b', { text: DATA.early_size + ' earlier candidates' }),
          ' below that line, because a launch nobody has noticed is the radar\'s reason to exist. Implied value is a model\'s estimate of what each protocol\'s token would be worth if its record stayed as it is: ',
          make('b', { text: 'TVL × sector multiple × growth × maturity' }),
          ', measured from the snapshot itself. It is a claim to judge, not a promise.'
        )
      ),
      make('div', { class: 'kpis' },
        kpi(DATA.rows.length, 'Rows ranked'),
        kpi(DATA.watchlist_size, 'Watchlist covered'),
        kpi(DATA.early_size, 'Early, below floor'),
        kpi(DATA.live.length, 'Live tokens set aside')
      )
    );
  }

  function searchInput() {
    const input = make('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain…', value: state.q, 'aria-label': 'Search the board' });
    input.addEventListener('input', () => { state.q = input.value; render(); });
    return input;
  }
  function categorySelect() {
    const categories = Array.from(new Set(DATA.rows.map(categoryOf))).sort();
    const select = make('select', { id: 'category', 'aria-label': 'Filter by category' },
      make('option', { value: 'all', text: 'All categories' }),
      categories.map((name) => make('option', { value: name, text: name, selected: name === state.category ? 'selected' : null }))
    );
    select.addEventListener('change', () => { state.category = select.value; render(); });
    return select;
  }
  function sortSelect() {
    const choices = [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Age with no token'], ['name', 'Name']];
    const select = make('select', { id: 'sort', 'aria-label': 'Sort by' },
      choices.map(([value, label]) => make('option', { value, text: label, selected: value === state.sort ? 'selected' : null }))
    );
    select.addEventListener('change', () => { state.sort = select.value; state.dir = select.value === 'name' ? 1 : -1; render(); });
    return select;
  }
  function controls() {
    const field = (label, forId, control) => make('div', { class: 'field' }, make('label', { for: forId, text: label }), control);
    return make('div', { class: 'controls' },
      field('Search', 'q', searchInput()),
      field('Category', 'category', categorySelect()),
      field('Sort', 'sort', sortSelect()),
      make('div', { class: 'field' }, make('span', { class: 'lab', text: 'View' }),
        make('div', { class: 'seg' },
          make('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', onclick: () => { state.tab = 'board'; render(); }, text: 'Pre-token' }),
          make('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', onclick: () => { state.tab = 'live'; render(); }, text: 'Live tokens' })
        )
      ),
      make('div', { class: 'grow' }),
      make('span', { class: 'tally' },
        state.tab === 'board'
          ? [make('b', { text: String(visibleRows().length) }), ' of ' + DATA.rows.length + ' shown']
          : [make('b', { text: String(DATA.live.length) }), ' live protocols']
      ),
      make('button', { class: 'reset', type: 'button', text: 'Reset', onclick: () => { state.q = ''; state.category = 'all'; state.sort = 'implied'; state.dir = -1; render(); } })
    );
  }

  function boardTable() {
    const rows = ordered(visibleRows());
    if (rows.length === 0) {
      return make('div', { class: 'board' }, make('div', { class: 'empty' },
        make('h3', { text: 'Nothing on the radar for that filter' }),
        make('p', { text: 'Clear the search or pick another category.' }),
        make('button', { class: 'reset', type: 'button', text: 'Clear filters', onclick: () => { state.q = ''; state.category = 'all'; render(); } })
      ));
    }
    const peak = rows[0].implied_value_usd || 1;
    const tbody = make('tbody');
    rows.forEach((row) => {
      const growth = row.change_7d === null ? 'n/a' : percent(row.change_7d);
      const growthClass = row.change_7d === null || !isFinite(row.change_7d) ? '' : row.change_7d >= 0 ? 'up' : 'down';
      tbody.appendChild(make('tr', {
        'data-open': state.open === row.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDrawer(row.slug),
        onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDrawer(row.slug); } },
      },
        make('td', { class: 'rank' }, make('b', { text: '#' + row.rank })),
        make('td', null, make('div', { class: 'who' },
          make('b', { text: row.name }),
          make('span', { class: 'meta' }, categoryOf(row), make('span', { class: 'sep', text: '·' }), chainText(row))
        )),
        make('td', { class: 'n', text: money(row.tvl_usd) }),
        make('td', { class: 'n ' + growthClass, text: growth }),
        make('td', { class: 'n', text: ageText(row.age_days) }),
        make('td', null, make('div', { class: 'val' },
          make('div', { class: 'gauge', 'aria-hidden': 'true' }, make('i', { style: 'width:' + Math.max(3, Math.round((row.implied_value_usd / peak) * 100)) + '%' })),
          make('span', { class: 'n', text: money(row.implied_value_usd) })
        )),
        make('td', null, make('span', { class: 'chip ' + (row.on_watchlist ? 'wl' : 'early'), text: row.on_watchlist ? 'watchlist' : 'early radar' }))
      ));
    });
    return make('div', { class: 'board' }, make('div', { class: 'scroll' },
      make('table', null,
        make('caption', { class: 'meta', style: 'text-align:left;padding:var(--s3)', text: 'Pre-token protocols, strongest implied value first. Select a row for the equation and the farm plan.' }),
        make('thead', null, make('tr', null,
          sortHeader('implied', 'Rank'),
          sortHeader('name', 'Protocol'),
          sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'),
          sortHeader('age', 'No token for'),
          sortHeader('implied', 'Implied value'),
          make('th', { text: 'Status' })
        )),
        tbody
      )
    ));
  }

  function liveTable() {
    const tbody = make('tbody');
    DATA.live.forEach((row) => {
      const changeClass = row.change_7d !== null && row.change_7d >= 0 ? 'up' : 'down';
      tbody.appendChild(make('tr', null,
        make('td', null, make('span', { class: 'chip live', text: 'trading' })),
        make('td', null, make('div', { class: 'who' },
          make('b', { text: row.name }),
          make('span', { class: 'meta' }, (row.symbol || '—') + ' · ' + categoryOf(row) + ' · ' + chainText(row))
        )),
        make('td', { class: 'n', text: money(row.tvl_usd) }),
        make('td', { class: 'n ' + changeClass, text: percent(row.change_7d) }),
        make('td', { class: 'n', text: money(row.mcap_usd) }),
        make('td', { class: 'n', text: row.mcap_usd && row.tvl_usd ? (row.mcap_usd / row.tvl_usd).toFixed(2) + '×' : 'n/a' })
      ));
    });
    return make('div', { class: 'board' }, make('div', { class: 'scroll' },
      make('table', null,
        make('caption', { class: 'meta', style: 'text-align:left;padding:var(--s3)', text: 'These protocols already trade, so their market cap is a fact, not a model — and it is where every sector multiple comes from.' }),
        make('thead', null, make('tr', null,
          make('th', { text: 'Status' }),
          make('th', { text: 'Protocol' }),
          make('th', { text: 'TVL' }),
          make('th', { text: '7d' }),
          make('th', { text: 'Market cap' }),
          make('th', { text: 'MC / TVL' })
        )),
        tbody
      )
    ));
  }

  function methodPanel() {
    const sectors = DATA.sectors.filter((sector) => sector.samples > 0);
    return make('section', { class: 'panel' },
      make('h2', { text: 'How implied value is computed' }),
      make('p', null, 'Every row is scored by one function of the snapshot\'s own figures. No protocol name is special-cased, and nothing on the board is hand-picked. The page and the board.json carry the same arithmetic.'),
      make('div', { class: 'formula' },
        'implied = round( tvl × ', make('b', { text: 'sectorMultiple' }), ' × ', make('b', { text: 'growthMult' }), ' × ', make('b', { text: 'maturityMult' }), ' )\n\n',
        'sectorMultiple = median( mcap ÷ tvl ) of this category\'s protocols that already trade\n',
        '                 shrunk toward the whole market\'s median (' + DATA.global_multiple.toFixed(4) + ') while the sample is small;\n',
        '                 a category with no precedent borrows the market median\n\n',
        'growthMult   = 1 + clamp(change_7d, -60, +120) ÷ 100 × ' + DATA.growth_weight.toFixed(2) + '\n',
        'maturityMult = ' + DATA.maturity_floor.toFixed(2) + ' + min(age_days, ' + DATA.maturity_days + ') ÷ ' + DATA.maturity_days + ' × ' + DATA.maturity_range.toFixed(2),
        '   (age unknown: ' + Math.round(365) + ' days)\n\n',
        'age_days     = days from listed_at to the snapshot day: how long the protocol has run with no token'
      ),
      make('p', { text: 'Sector multiples in force — measured means the category has token-bearing precedents in this snapshot; borrowed means it uses the market median.' }),
      make('div', { class: 'sector-grid' }, sectors.map((sector) =>
        make('div', { class: 'sector' + (sector.measured ? '' : ' borrowed') },
          make('span', { text: sector.category + (sector.measured ? '' : ' (borrowed)') }),
          make('b', { text: sector.multiple.toFixed(4) + '×' })
        )
      )),
      make('p', { text: 'Reading it: TVL is the money already at work; the sector multiple says what that money\'s tokens sell for in this category today; growth weighs the last week; maturity discounts a launch that has not happened yet, but rewards a protocol that has waited longer. A young protocol with fast-growing TVL in a high-multiple category lands near the top; an old, shrinking one in a low-multiple category sinks.' }),
      make('ul', { class: 'notes' },
        make('li', null, 'The watchlist is the floor, never the ceiling: ', make('b', { text: String(DATA.early_size) }), ' ranked rows sit below ', make('b', { text: money(DATA.floor_usd) }), ' of TVL.'),
        make('li', null, 'The live-token tab shows the protocols the multiples are measured from.'),
        make('li', null, 'Every farm plan carries the action, what it costs and how long it takes.'),
        make('li', null, 'Implied value is an estimate, never a price and never a promise.')
      )
    );
  }

  const drawerRoot = document.getElementById('drawer-root');
  const findRow = (slug) => DATA.rows.filter((row) => row.slug === slug)[0];
  const eqRow = (label, value) => make('div', null, make('span', { text: label }), make('b', { text: value }));
  const fact = (label, value) => make('div', { class: 'fact' }, make('span', { text: label }), make('b', { text: value }));
  function closeDrawer() {
    state.open = null;
    render();
  }
  function openDrawer(slug) {
    if (!findRow(slug)) return;
    state.open = slug;
    render();
    const body = document.querySelector('.drawer-body');
    if (body) body.scrollTop = 0;
  }
  function drawer() {
    const row = findRow(state.open);
    if (!row) return null;
    const sector = DATA.sectors.filter((entry) => entry.category === categoryOf(row))[0];
    const equation = make('div', { class: 'eq' },
      eqRow('TVL at snapshot', money(row.tvl_usd)),
      eqRow('Sector multiple' + (sector && !sector.measured ? ' (borrowed)' : ''), row.sector_multiple.toFixed(4) + '×'),
      eqRow('Growth multiplier', row.growth_multiplier.toFixed(4) + '×'),
      eqRow('Maturity multiplier', row.maturity_multiplier.toFixed(4) + '×')
    );
    equation.appendChild(make('div', { class: 'total' }, make('span', { text: 'Implied value' }), make('b', { text: money(row.implied_value_usd) })));
    const plan = make('ol', { class: 'plan' });
    row.farm_steps.forEach((step) => {
      const at = step.indexOf(' Cost: ');
      plan.appendChild(make('li', null, make('b', { text: at >= 0 ? step.slice(0, at) : step }), make('span', { class: 'cost', text: at >= 0 ? step.slice(at + 1) : '' })));
    });
    const chains = row.chains && row.chains.length ? row.chains.join(', ') : 'unnamed chain';
    return [
      make('div', { class: 'backdrop', onclick: closeDrawer }),
      make('aside', { class: 'drawer', role: 'dialog', 'aria-label': row.name },
        make('div', { class: 'drawer-head' },
          make('div', { class: 'row' },
            make('div', null,
              make('div', { class: 'eyebrow', text: 'Rank #' + row.rank + ' of ' + DATA.rows.length + (row.on_watchlist ? ' · watchlist' : ' · early radar') }),
              make('h2', { text: row.name }),
              make('div', { class: 'sub', text: categoryOf(row) + ' · ' + chains + (row.listed_at ? ' · tracked since ' + row.listed_at : ' · tracking start unknown') })
            ),
            make('button', { class: 'x', type: 'button', 'aria-label': 'Close', text: '×', onclick: closeDrawer })
          )
        ),
        make('div', { class: 'drawer-body' },
          make('section', { class: 'block' },
            make('h3', { text: 'The implied-value equation' }),
            equation,
            make('p', { class: 'meta', text: 'Same arithmetic as the board: one function of the snapshot\'s figures. ' + (sector && sector.measured ? 'The ' + sector.category + ' multiple is measured from ' + sector.samples + ' trading precedents in this snapshot.' : 'This category has too few trading precedents in the snapshot, so the multiple is the whole market\'s median of ' + DATA.global_multiple.toFixed(4) + '.') })
          ),
          make('section', { class: 'block' },
            make('h3', { text: 'At a glance' }),
            make('div', { class: 'facts' },
              fact('TVL', money(row.tvl_usd)),
              fact('7d change', percent(row.change_7d)),
              fact('No token for', ageText(row.age_days)),
              fact('Watchlist', row.on_watchlist ? 'on the list' : 'below floor'),
              fact('Implied value', money(row.implied_value_usd)),
              fact('Status', 'records no token')
            )
          ),
          make('section', { class: 'block' },
            make('h3', { text: 'How to farm it' }),
            plan
          ),
          make('p', { class: 'meta', text: 'Farm plans assume you want the airdrop, not the yield: positions stay small, activity repeats weekly, and every step names what it costs and how long it takes. Nothing here is financial advice.' })
        )
      )
    ];
  }

  function footer() {
    return make('footer', null,
      make('span', null, make('b', { text: 'Launch Radar' }), ' · ' + DATA.rows.length + ' protocols ranked · ' + DATA.watchlist_size + ' watchlist slugs covered · snapshot ' + DATA.as_of),
      make('span', null, 'Data: DefiLlama protocol index, fetched once and sealed. Implied values are estimates.')
    );
  }
  function render() {
    const app = document.getElementById('app');
    if (!app) return;
    app.textContent = '';
    app.appendChild(masthead());
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
    const nodes = drawer();
    if (nodes) nodes.forEach((node) => drawerRoot.appendChild(node));
    app.setAttribute('aria-busy', 'false');
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) closeDrawer();
  });

  readUrl();
  render();
})();
