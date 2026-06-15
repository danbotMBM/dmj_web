// Economy dashboard — a small, dependency-free charting engine (vanilla SVG)
// plus the view controllers that wire each section's data and controls together.
//
// Two reusable primitives do all the work:
//   • Chart   — line or stacked-area chart with axes, grid, hover crosshair and
//               a shared tooltip. Series are toggleable via a clickable legend.
//   • drawBars — grouped/snapshot bar chart.
// Everything reads from the JSON files under ./data and is theme-aware through
// the site's CSS variables.

const SVGNS = "http://www.w3.org/2000/svg";
const BASE = "data/";

// Fixed categorical palette — legible on light and dark backgrounds.
const PALETTE = [
  "#c2185b", "#2563eb", "#2ca02c", "#ff7f0e", "#9467bd",
  "#17a2b8", "#d62728", "#8c564b", "#e6b400", "#5c6b7a",
];
const COUNTRY_COLOR = { US: "#2563eb", UK: "#c2185b" };
const COUNTRY_NAME = { US: "United States", UK: "United Kingdom" };

// ---------------------------------------------------------------------------
// Small DOM / SVG helpers
// ---------------------------------------------------------------------------
function h(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) e.append(kid);
  return e;
}
function s(tag, attrs = {}, kids = []) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const kid of [].concat(kids)) e.append(kid);
  return e;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

// ---------------------------------------------------------------------------
// Value formatters
// ---------------------------------------------------------------------------
function abbrev(v) {
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(a >= 1e13 ? 0 : 1) + "T";
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(0) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(v));
}
const fmt = {
  // billions input -> "$1.2T" / "£450bn"
  bn: (sym) => (v) => (v == null ? "—" : sym + abbrev(v * 1e9)),
  // raw currency (USD) -> "$81k"
  usd: (v) => (v == null ? "—" : "$" + abbrev(v)),
  pct: (v) => (v == null ? "—" : v.toFixed(1) + "%"),
  pct0: (v) => (v == null ? "—" : Math.round(v) + "%"),
  year: (v) => String(v),
};

// ---------------------------------------------------------------------------
// Chart — line or stacked area with hover tooltip and a toggleable legend.
//
//   host       DOM element to render into
//   opts.xs    array of x values (years)
//   opts.series  [{ name, values:[..], color }]
//   opts.type  "line" | "area"
//   opts.mode  for area: "absolute" | "percent"
//   opts.yFormat fn(value) -> label   (axis + tooltip)
//   opts.legend  show clickable legend (default true)
// ---------------------------------------------------------------------------
class Chart {
  constructor(host, opts) {
    this.host = host;
    this.o = Object.assign({ type: "line", mode: "absolute", legend: true, height: 340 }, opts);
    this.hidden = new Set();
    this._build();
    this.render();
  }

  update(opts) {
    Object.assign(this.o, opts);
    this.hidden.clear();
    this.render();
  }

  _build() {
    clear(this.host);
    this.legendEl = h("div", { class: "chart-legend" });
    this.svgWrap = h("div");
    this.tooltip = h("div", { class: "chart-tooltip" });
    this.host.append(this.legendEl, this.svgWrap, this.tooltip);
  }

  _visibleSeries() {
    return this.o.series.filter((se) => !this.hidden.has(se.name));
  }

  render() {
    this._renderLegend();
    this._renderSvg();
  }

  _renderLegend() {
    clear(this.legendEl);
    if (!this.o.legend) return;
    this.o.series.forEach((se) => {
      const item = h("button", {
        class: "legend-item" + (this.hidden.has(se.name) ? " off" : ""),
        type: "button",
        onclick: () => {
          if (this.hidden.has(se.name)) this.hidden.delete(se.name);
          else if (this._visibleSeries().length > 1) this.hidden.add(se.name);
          this.render();
        },
      }, [
        h("span", { class: "swatch", style: `background:${se.color}` }),
        document.createTextNode(se.name),
      ]);
      this.legendEl.append(item);
    });
  }

  _renderSvg() {
    clear(this.svgWrap);
    const series = this._visibleSeries();
    const { xs } = this.o;
    const W = 760, H = this.o.height;
    const M = { l: 52, r: 16, t: 14, b: 34 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;

    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const xScale = (x) => M.l + (xmax === xmin ? iw / 2 : ((x - xmin) / (xmax - xmin)) * iw);

    // y domain
    let ymin = 0, ymax = 1;
    const isArea = this.o.type === "area";
    const isPct = isArea && this.o.mode === "percent";
    if (isArea) {
      ymax = isPct ? 100 : 0;
      if (!isPct) {
        xs.forEach((_, i) => {
          let tot = 0;
          series.forEach((se) => { tot += se.values[i] || 0; });
          ymax = Math.max(ymax, tot);
        });
      }
    } else {
      ymin = Infinity; ymax = -Infinity;
      series.forEach((se) => se.values.forEach((v) => {
        if (v == null) return;
        ymin = Math.min(ymin, v); ymax = Math.max(ymax, v);
      }));
      if (!isFinite(ymin)) { ymin = 0; ymax = 1; }
      if (ymin > 0) ymin = 0;                 // anchor to zero when all positive
      const pad = (ymax - ymin) * 0.08 || 1;
      ymax += pad;
      if (ymin < 0) ymin -= pad;
    }
    if (!isPct) ymax = niceMax(ymax) === 0 ? ymax : (isArea ? niceMax(ymax) : ymax);
    const yScale = (v) => M.t + ih - ((v - ymin) / (ymax - ymin || 1)) * ih;

    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });

    // grid + y axis
    const grid = s("g", { class: "chart-grid" });
    const yax = s("g", { class: "chart-axis" });
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = ymin + ((ymax - ymin) * i) / ticks;
      const y = yScale(v);
      grid.append(s("line", { x1: M.l, x2: M.l + iw, y1: y, y2: y }));
      yax.append(s("text", { x: M.l - 7, y: y + 3, "text-anchor": "end" }, [String(this.o.yFormat(v))]));
    }
    svg.append(grid, yax);

    // zero line if domain crosses zero
    if (ymin < 0 && ymax > 0) {
      svg.append(s("line", { class: "chart-zeroline", x1: M.l, x2: M.l + iw, y1: yScale(0), y2: yScale(0) }));
    }

    // x axis labels
    const xax = s("g", { class: "chart-axis" });
    xax.append(s("line", { x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }));
    const span = xmax - xmin;
    const step = span <= 8 ? 1 : span <= 16 ? 2 : span <= 30 ? 5 : 10;
    let firstTick = Math.ceil(xmin / step) * step;
    const xtSet = new Set();
    for (let x = firstTick; x <= xmax; x += step) xtSet.add(x);
    xtSet.add(xmin); xtSet.add(xmax);
    [...xtSet].sort((a, b) => a - b).forEach((x) => {
      const px = xScale(x);
      xax.append(s("text", { x: px, y: M.t + ih + 16, "text-anchor": "middle" }, [this.o.xFormat ? this.o.xFormat(x) : String(x)]));
    });
    svg.append(xax);

    // --- areas (stacked) ---
    if (isArea) {
      // compute cumulative baselines
      const totals = xs.map((_, i) => {
        let t = 0; series.forEach((se) => { t += se.values[i] || 0; }); return t || 1;
      });
      let baseline = xs.map(() => 0);
      series.forEach((se) => {
        const top = [];
        const bot = [];
        xs.forEach((x, i) => {
          let val = se.values[i] || 0;
          if (isPct) val = (val / totals[i]) * 100;
          const b = baseline[i];
          bot.push([xScale(x), yScale(b)]);
          top.push([xScale(x), yScale(b + val)]);
          baseline[i] = b + val;
        });
        const pts = top.concat(bot.reverse());
        const d = "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L") + "Z";
        svg.append(s("path", { d, fill: se.color, "fill-opacity": 0.82, stroke: se.color, "stroke-width": 0.5 }));
      });
    } else {
      // --- lines ---
      series.forEach((se) => {
        let d = "", pen = false;
        se.values.forEach((v, i) => {
          if (v == null) { pen = false; return; }
          const cmd = pen ? "L" : "M";
          d += `${cmd}${xScale(xs[i]).toFixed(1)},${yScale(v).toFixed(1)}`;
          pen = true;
        });
        if (d) svg.append(s("path", { class: "series-line", d, stroke: se.color }));
        // dots only when few points
        if (xs.length <= 12) {
          se.values.forEach((v, i) => {
            if (v == null) return;
            svg.append(s("circle", { class: "series-dot", cx: xScale(xs[i]), cy: yScale(v), r: 3.2, fill: se.color }));
          });
        }
      });
    }

    // --- hover layer ---
    const guide = s("line", { class: "hover-guide", x1: 0, x2: 0, y1: M.t, y2: M.t + ih, style: "opacity:0" });
    const hoverDots = s("g");
    svg.append(guide, hoverDots);
    const overlay = s("rect", { x: M.l, y: M.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" });
    svg.append(overlay);

    const nearestIndex = (px) => {
      let best = 0, bd = Infinity;
      xs.forEach((x, i) => { const d = Math.abs(xScale(x) - px); if (d < bd) { bd = d; best = i; } });
      return best;
    };

    const onMove = (evt) => {
      const rect = svg.getBoundingClientRect();
      const px = ((evt.clientX - rect.left) / rect.width) * W;
      const i = nearestIndex(px);
      const gx = xScale(xs[i]);
      guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.setAttribute("style", "opacity:1");
      clear(hoverDots);

      const rows = [];
      let stackBase = 0;
      const totalAt = isArea ? series.reduce((t, se) => t + (se.values[i] || 0), 0) || 1 : 0;
      series.forEach((se) => {
        const raw = se.values[i];
        if (raw == null) return;
        let plotV = raw, label = this.o.yFormat(raw);
        if (isArea && isPct) { plotV = (raw / totalAt) * 100; label = fmt.pct(plotV); }
        // dot position
        let cy;
        if (isArea) {
          const v = isPct ? (raw / totalAt) * 100 : raw;
          cy = yScale(stackBase + v); stackBase += v;
        } else {
          cy = yScale(raw);
          hoverDots.append(s("circle", { cx: gx, cy, r: 4, fill: se.color, stroke: "var(--bgColor-default,#fff)", "stroke-width": 1.5 }));
        }
        rows.push({ name: se.name, color: se.color, label });
      });

      // tooltip content
      clear(this.tooltip);
      this.tooltip.append(h("div", { class: "tt-x" }, [this.o.xFormat ? this.o.xFormat(xs[i]) : String(xs[i])]));
      rows.forEach((r) => {
        this.tooltip.append(h("div", { class: "tt-row" }, [
          h("span", { class: "tt-name" }, [h("span", { class: "tt-dot", style: `background:${r.color}` }), document.createTextNode(r.name)]),
          h("span", { class: "tt-val" }, [r.label]),
        ]));
      });
      if (isArea) {
        const tot = isPct ? "100%" : this.o.yFormat(totalAt);
        this.tooltip.append(h("div", { class: "tt-row", style: "margin-top:.3rem;border-top:1px solid var(--borderColor-muted,#e4e8ec);padding-top:.25rem" }, [
          h("span", { class: "tt-name" }, ["Total"]), h("span", { class: "tt-val" }, [tot]),
        ]));
      }

      // position tooltip (clamp within card)
      this.tooltip.classList.add("show");
      const hostRect = this.host.getBoundingClientRect();
      const relX = ((gx - M.l) / iw) * (hostRect.width - M.l - M.r) + M.l;
      let left = relX + 14;
      const ttW = this.tooltip.offsetWidth;
      if (left + ttW > hostRect.width - 6) left = relX - ttW - 14;
      this.tooltip.style.left = Math.max(6, left) + "px";
      this.tooltip.style.top = 18 + "px";
    };

    overlay.addEventListener("mousemove", onMove);
    overlay.addEventListener("mouseleave", () => {
      guide.setAttribute("style", "opacity:0");
      clear(hoverDots);
      this.tooltip.classList.remove("show");
    });

    this.svgWrap.append(svg);
  }
}

// ---------------------------------------------------------------------------
// Grouped / snapshot bar chart
//   host, { labels:[..], series:[{name,values,color}], valueFormat, height }
// ---------------------------------------------------------------------------
function drawBars(host, opts) {
  clear(host);
  const { labels, series } = opts;
  const valueFormat = opts.valueFormat || fmt.pct;
  const W = 760, H = opts.height || 320;
  const M = { l: 46, r: 14, t: 14, b: 46 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  let ymax = 0;
  series.forEach((se) => se.values.forEach((v) => { if (v != null) ymax = Math.max(ymax, v); }));
  ymax = niceMax(ymax * 1.05);
  const yScale = (v) => M.t + ih - (v / (ymax || 1)) * ih;

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  const grid = s("g", { class: "chart-grid" });
  const yax = s("g", { class: "chart-axis" });
  for (let i = 0; i <= 5; i++) {
    const v = (ymax * i) / 5, y = yScale(v);
    grid.append(s("line", { x1: M.l, x2: M.l + iw, y1: y, y2: y }));
    yax.append(s("text", { x: M.l - 7, y: y + 3, "text-anchor": "end" }, [valueFormat(v)]));
  }
  svg.append(grid, yax);

  const groupW = iw / labels.length;
  const n = series.length;
  const barW = Math.min(54, (groupW * 0.7) / n);
  const xax = s("g", { class: "chart-axis" });
  xax.append(s("line", { x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }));

  labels.forEach((lab, gi) => {
    const cx = M.l + groupW * gi + groupW / 2;
    const start = cx - (barW * n) / 2;
    series.forEach((se, si) => {
      const v = se.values[gi];
      if (v == null) return;
      const x = start + si * barW;
      const y = yScale(v);
      svg.append(s("rect", { x: x + 1, y, width: barW - 2, height: M.t + ih - y, fill: se.color, rx: 2 }));
      svg.append(s("text", { x: x + barW / 2, y: y - 4, "text-anchor": "middle", class: "chart-axis" }, [valueFormat(v)]));
    });
    // wrap long labels onto two lines
    const words = String(lab).split(" ");
    const line1 = words.length > 2 ? words.slice(0, 2).join(" ") : lab;
    const line2 = words.length > 2 ? words.slice(2).join(" ") : "";
    const t = s("text", { x: cx, y: M.t + ih + 16, "text-anchor": "middle", class: "chart-axis" }, [line1]);
    xax.append(t);
    if (line2) xax.append(s("text", { x: cx, y: M.t + ih + 30, "text-anchor": "middle", class: "chart-axis" }, [line2]));
  });
  svg.append(xax);

  if (n > 1) {
    const legend = h("div", { class: "chart-legend" });
    series.forEach((se) => legend.append(h("span", { class: "legend-item" }, [
      h("span", { class: "swatch", style: `background:${se.color}` }), document.createTextNode(se.name)])));
    host.append(legend);
  }
  host.append(svg);
}

// ---------------------------------------------------------------------------
// Control builders
// ---------------------------------------------------------------------------
function segmented(label, options, active, onChange) {
  const seg = h("div", { class: "segmented" });
  const buttons = [];
  options.forEach((opt) => {
    const btn = h("button", { type: "button", class: opt.value === active ? "active" : "" }, [opt.label]);
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(opt.value);
    });
    buttons.push(btn);
    seg.append(btn);
  });
  return h("div", { class: "control-group" }, [h("span", { class: "control-label" }, [label]), seg]);
}

function sourceLine(meta) {
  const srcs = (meta && meta.sources) || [];
  const wrap = h("div", { class: "chart-source" });
  const links = srcs.map((sr, i) => {
    const a = h("a", { href: sr.url, target: "_blank", rel: "noopener" }, [sr.label]);
    return i < srcs.length - 1 ? h("span", {}, [a, document.createTextNode(" · ")]) : a;
  });
  wrap.append(document.createTextNode("Source: "), ...links);
  return wrap;
}

function mountSection(id, { title, sub }) {
  const host = document.getElementById(id);
  if (!host) return null;
  const controls = h("div", { class: "econ-controls" });
  const chartHost = h("div", {});
  const card = h("div", { class: "chart-card" }, [
    title ? h("div", { class: "chart-title" }, [title]) : "",
    sub ? h("div", { class: "chart-sub" }, [sub]) : "",
    controls, chartHost,
  ]);
  host.append(card);
  return { host, controls, chartHost, card };
}

// ===========================================================================
// View controllers
// ===========================================================================
async function loadJSON(name) {
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error("Failed to load " + name);
  return r.json();
}

// 1 — Economic growth (GDP)
function viewGrowth(gdp) {
  const m = mountSection("view-growth", { title: "Output: GDP, per capita & real growth", sub: "United States vs United Kingdom" });
  if (!m) return;
  const metrics = {
    realpc: { label: "Real GDP / capita", key: "realGDPpc", long: true, yf: (v) => "$" + abbrev(v), info: "Real GDP per capita back to 1900, constant 2011 international dollars, PPP (Maddison Project)." },
    realgdp: { label: "Real GDP", key: "realGDP", long: true, yf: (v) => "$" + abbrev(v), info: "Real GDP back to 1900, constant 2011 international dollars (Maddison Project)." },
    nominal: { label: "Nominal GDP", key: "nominalGDP", yf: (v) => "$" + abbrev(v), info: "Nominal GDP in current US dollars since 1990 (World Bank)." },
    percap: { label: "Nominal / capita", key: "gdpPerCapita", yf: fmt.usd, info: "Nominal GDP divided by population, in current US dollars (World Bank)." },
    growth: { label: "Real growth %", key: "realGrowthPct", yf: fmt.pct, info: "Inflation-adjusted annual change in GDP." },
  };
  let active = "realpc";
  const chartHost = h("div", {});
  let chart;
  const draw = () => {
    const mm = metrics[active];
    const xs = mm.long ? gdp.yearsLong : gdp.years;
    const series = ["US", "UK"].map((c) => ({
      name: COUNTRY_NAME[c], color: COUNTRY_COLOR[c], values: gdp[mm.key][c],
    }));
    const opts = { xs, series, type: "line", yFormat: mm.yf };
    if (chart) chart.update(opts); else chart = new Chart(chartHost, opts);
    sub.textContent = mm.info;
  };
  const sub = m.card.querySelector(".chart-sub");
  m.controls.append(segmented("Metric", Object.entries(metrics).map(([v, o]) => ({ value: v, label: o.label })), active, (v) => { active = v; draw(); }));
  m.chartHost.append(chartHost);
  m.card.append(sourceLine(gdp.meta));
  draw();
}

// 2 — Government spending vs revenue
function viewSpending(fiscal) {
  const m = mountSection("view-spending", { title: "Government spending vs revenue", sub: "" });
  if (!m) return;
  let country = "US", view = "abs";
  const chartHost = h("div", {});
  let chart;
  const capt = h("div", { class: "chart-caption" });
  const draw = () => {
    const d = fiscal[country];
    if (view === "gdpLong") {
      const L = fiscal.long;
      const series = [
        { name: "Government spending", color: "#d62728", values: L.spendPctGDP[country] },
        { name: "Tax revenue", color: "#2ca02c", values: L.taxRevPctGDP[country] },
      ];
      const opts = { xs: L.years, series, type: "line", yFormat: fmt.pct };
      if (chart) chart.update(opts); else chart = new Chart(chartHost, opts);
      capt.textContent = `${COUNTRY_NAME[country]} since 1900: government spending and tax revenue as a share of GDP. Both ratchet up through the World Wars and never fully return — the state was ~10% of GDP in 1900 and is ~35-45% today. (Spending here is central/general government; basis differs slightly from the modern official series above.)`;
      return;
    }
    const abs = view === "abs";
    const sym = d.symbol;
    const series = [
      { name: "Spending (outlays)", color: "#d62728", values: abs ? d.outlays : d.outlaysPctGDP },
      { name: "Revenue (receipts)", color: "#2ca02c", values: abs ? d.receipts : d.receiptsPctGDP },
    ];
    const yf = abs ? fmt.bn(sym) : fmt.pct;
    const opts = { xs: d.years, series, type: "line", yFormat: yf };
    if (chart) chart.update(opts); else chart = new Chart(chartHost, opts);
    // deficit caption (latest year)
    const li = d.years.length - 1;
    const defAbs = d.outlays[li] - d.receipts[li];
    const word = defAbs > 0 ? "deficit" : "surplus";
    capt.textContent = `${COUNTRY_NAME[country]}, latest year (${d.years[li]}): spending ${sym}${abbrev(d.outlays[li] * 1e9)}, revenue ${sym}${abbrev(d.receipts[li] * 1e9)} — a ${sym}${abbrev(Math.abs(defAbs) * 1e9)} ${word}. Gap between the lines = the annual ${word}.`;
  };
  m.controls.append(
    segmented("Country", [{ value: "US", label: "United States" }, { value: "UK", label: "United Kingdom" }], country, (v) => { country = v; draw(); }),
    segmented("View", [{ value: "abs", label: "Amount" }, { value: "gdp", label: "% of GDP" }, { value: "gdpLong", label: "% of GDP · since 1900" }], view, (v) => { view = v; draw(); }),
  );
  m.chartHost.append(chartHost, capt);
  m.card.append(sourceLine({ sources: fiscal.meta.sources.concat(fiscal.long.sources) }));
  draw();
}

// 3 — Where revenue comes from (composition)
function viewRevenueSources(fiscal, taxSources) {
  const m = mountSection("view-revenue-sources", { title: "Where government revenue comes from", sub: "Tax revenue by source" });
  if (!m) return;
  let country = "US", mode = "absolute";
  const chartHost = h("div", {});
  let chart;
  const draw = () => {
    let years, bySource, sym;
    if (country === "US") { years = fiscal.US.years; bySource = fiscal.US.bySource; sym = "$"; }
    else { years = taxSources.UK.years; bySource = taxSources.UK.bySource; sym = "£"; }
    const series = Object.entries(bySource).map(([name, values], i) => ({ name, values, color: PALETTE[i % PALETTE.length] }));
    const opts = { xs: years, series, type: "area", mode, yFormat: mode === "percent" ? fmt.pct0 : fmt.bn(sym) };
    if (chart) chart.update(opts); else chart = new Chart(chartHost, opts);
  };
  m.controls.append(
    segmented("Country", [{ value: "US", label: "United States" }, { value: "UK", label: "United Kingdom" }], country, (v) => { country = v; draw(); }),
    segmented("View", [{ value: "absolute", label: "Amount" }, { value: "percent", label: "Share %" }], mode, (v) => { mode = v; draw(); }),
  );
  m.chartHost.append(chartHost);
  m.card.append(sourceLine({ sources: fiscal.meta.sources.concat(taxSources.meta.sources) }));
  draw();
}

// 4 — Who pays income tax (by percentile)
function viewIncomeTax(td) {
  const m = mountSection("view-income-tax", { title: "Who pays income tax", sub: "Share of income tax paid by top income groups" });
  if (!m) return;
  let country = "US";
  const barsHost = h("div", {});
  const rateHost = h("div", {});
  const rateTitle = h("div", { class: "chart-title", style: "margin-top:1rem" }, []);
  const draw = () => {
    if (country === "US") {
      const d = td.usIncomeTaxShare;
      drawBars(barsHost, {
        labels: d.groups, valueFormat: fmt.pct0,
        series: [{ name: "Share of federal income tax", color: "#c2185b", values: d.sharePct }],
      });
      rateTitle.textContent = "Average effective federal tax rate by income group (CBO)";
      const r = td.usEffectiveRate;
      drawBars(rateHost, { labels: r.groups, valueFormat: fmt.pct0, series: [{ name: "All federal taxes", color: "#2563eb", values: r.ratePct }] });
    } else {
      const d = td.ukIncomeTaxShare;
      drawBars(barsHost, {
        labels: d.groups, valueFormat: fmt.pct0,
        series: [{ name: "Share of income tax", color: "#c2185b", values: d.sharePct }],
      });
      rateTitle.textContent = "Share of total income tax paid by the top 1% over time";
      const ts = td.top1ShareSeries.UK;
      new Chart(rateHost, { xs: ts.years, series: [{ name: "UK top 1% share", color: "#c2185b", values: ts.sharePct }], type: "line", yFormat: fmt.pct, legend: false });
    }
  };
  m.controls.append(segmented("Country", [{ value: "US", label: "United States" }, { value: "UK", label: "United Kingdom" }], country, (v) => { clear(rateHost); country = v; draw(); }));
  m.chartHost.append(barsHost, rateTitle, rateHost);

  // Century-long top marginal income-tax rate (US vs UK), rendered once.
  const mr = td.topMarginalRate;
  const mrTitle = h("div", { class: "chart-title", style: "margin-top:1.25rem" }, ["Top marginal income tax rate since 1900 (US vs UK)"]);
  const mrHost = h("div", {});
  new Chart(mrHost, {
    xs: mr.years,
    series: [
      { name: "United States", color: COUNTRY_COLOR.US, values: mr.US },
      { name: "United Kingdom", color: COUNTRY_COLOR.UK, values: mr.UK },
    ],
    type: "line", yFormat: fmt.pct0,
  });
  const mrNote = h("div", { class: "chart-caption" }, ["Statutory top rate on the highest incomes — over 90% in both countries during and after WWII, cut sharply in the 1980s."]);
  m.chartHost.append(mrTitle, mrHost, mrNote);

  m.card.append(sourceLine({ sources: td.meta.sources.concat([mr.source]) }));
  draw();
}

// 5 — Wealth distribution by class
function viewWealth(wealth) {
  const m = mountSection("view-wealth", { title: "Wealth distribution by class", sub: "Share of total household wealth held by each group" });
  if (!m) return;
  let country = "US", view = "recent";
  const chartHost = h("div", {});
  const note = h("div", { class: "chart-caption" });
  let chart;
  const draw = () => {
    if (view === "long") {
      const lr = wealth.longRun;
      const d = lr[country];
      const series = [
        { name: "Top 10% share", color: "#9467bd", values: d.top10 },
        { name: "Top 1% share", color: "#c2185b", values: d.top1 },
      ];
      chart = new Chart(chartHost, { xs: lr.years, series, type: "line", yFormat: fmt.pct0 });
      note.textContent = `${COUNTRY_NAME[country]} (World Inequality Database): the U-shaped century of wealth concentration — very high before WWI, falling to a mid-century low, then rising again since ~1980. Net personal wealth basis, so levels differ from the recent DFA/ONS measures.`;
      return;
    }
    const d = wealth[country];
    const classes = Object.entries(d.classes);
    const series = classes.map(([name, values], i) => ({ name, values, color: PALETTE[i % PALETTE.length] }));
    chart = new Chart(chartHost, { xs: d.years, series, type: "area", mode: "absolute", yFormat: fmt.pct0,
      xFormat: (x) => (country === "UK" ? `${x - 2}-${String(x).slice(2)}` : String(x)) });
    if (country === "US") {
      note.textContent = `US (Federal Reserve DFA): the top 1% held ${wealth.aggregates.US_top1_2024}% of all wealth in 2024 while the bottom 50% held ${wealth.aggregates.US_bottom50_2024}%.`;
    } else {
      note.textContent = `UK (ONS Wealth & Assets Survey, 2020-22): total household wealth was £${wealth.aggregates.UK_total_wealth_gbp_trillion}tn; the wealthiest 10% held 41% and the least wealthy 50% held 9%. Note: ONS totals include pensions and property, so measured UK concentration is lower than the US DFA figures.`;
    }
  };
  // a fresh Chart is built each draw (mode changes the chart type), so clear first
  const redraw = () => { clear(chartHost); chart = null; draw(); };
  m.controls.append(
    segmented("Country", [{ value: "US", label: "United States" }, { value: "UK", label: "United Kingdom" }], country, (v) => { country = v; redraw(); }),
    segmented("View", [{ value: "recent", label: "Class shares (recent)" }, { value: "long", label: "Top 1% & 10% · since 1913" }], view, (v) => { view = v; redraw(); }),
  );
  m.chartHost.append(chartHost, note);
  m.card.append(sourceLine({ sources: wealth.meta.sources.concat([wealth.longRun.source]) }));
  draw();
}

// 6 — Government balance sheet (debt + net worth)
function viewBalance(fiscal) {
  const m = mountSection("view-balance", { title: "Government balance sheet", sub: "Debt as a share of GDP — the running tally of past deficits" });
  if (!m) return;
  const chartHost = h("div", {});
  const D = fiscal.debtLong;
  const series = ["US", "UK"].map((c) => ({ name: `${COUNTRY_NAME[c]} debt`, color: COUNTRY_COLOR[c], values: D[c] }));
  new Chart(chartHost, { xs: D.years, series, type: "line", yFormat: fmt.pct0 });
  const note = h("div", { class: "chart-caption" }, [
    "A century of public debt as a share of GDP. The UK's debt peaked near 250% of GDP after the Second World War and fell for decades; both countries climbed back toward ~100% after 2008 and 2020. US is federal debt held by the public; UK is general-government / public-sector net debt — pre-2000 points are benchmark estimates. The UK's public sector net worth was about −£709bn in March 2024.",
  ]);
  m.chartHost.append(chartHost, note);
  m.card.append(sourceLine({ sources: fiscal.meta.sources.concat(D.sources) }));
}

// Headline stat cards
function headlineStats(gdp, fiscal, wealth) {
  const host = document.getElementById("headline-stats");
  if (!host) return;
  const yi = gdp.years.indexOf(2024);
  const usG = gdp.nominalGDP.US[yi], ukG = gdp.nominalGDP.UK[yi];
  const li = fiscal.UK.years.length - 1;
  const cards = [
    { label: "US GDP (2024)", value: "$" + abbrev(usG), sub: `$${abbrev(gdp.gdpPerCapita.US[yi])} per person` },
    { label: "UK GDP (2024)", value: "$" + abbrev(ukG), sub: `$${abbrev(gdp.gdpPerCapita.UK[yi])} per person` },
    { label: "US federal debt", value: fiscal.US.debtPctGDP[li] + "%", sub: "of GDP, held by public" },
    { label: "UK public debt", value: fiscal.UK.debtPctGDP[li] + "%", sub: "of GDP, net debt" },
    { label: "US top-1% wealth", value: wealth.aggregates.US_top1_2024 + "%", sub: "vs " + wealth.aggregates.US_bottom50_2024 + "% for bottom 50%" },
    { label: "US top-1% income tax", value: "40.4%", sub: "of federal income tax (2022)" },
  ];
  cards.forEach((c) => host.append(h("div", { class: "econ-stat" }, [
    h("div", { class: "s-label" }, [c.label]),
    h("div", { class: "s-value" }, [c.value]),
    h("div", { class: "s-sub" }, [c.sub]),
  ])));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  try {
    const [gdp, fiscal, taxSources, taxDist, wealth] = await Promise.all([
      loadJSON("gdp.json"), loadJSON("fiscal.json"), loadJSON("tax_sources.json"),
      loadJSON("tax_distribution.json"), loadJSON("wealth.json"),
    ]);
    headlineStats(gdp, fiscal, wealth);
    viewGrowth(gdp);
    viewSpending(fiscal);
    viewRevenueSources(fiscal, taxSources);
    viewIncomeTax(taxDist);
    viewWealth(wealth);
    viewBalance(fiscal);
  } catch (e) {
    const el = document.getElementById("headline-stats");
    if (el) el.textContent = "Could not load economic data: " + e.message;
    console.error(e);
  }
}

main();
