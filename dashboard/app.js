/* Vehicle Safety Signal Monitor
   Reads data/dashboard.json (written by scripts/export_dashboard.py) and draws
   every chart with D3. Colours come from CSS custom properties, so light and
   dark mode need no redraw. */

const state = { data: null, make: "ALL", selected: null, allSignals: false, outcome: "recall", recall: null };
const SIGNAL_ROWS = 25;
const fmt = d3.format(",");
const fmt1 = d3.format(",.1f");
const pct = d3.format(".0%");
const fmt2 = d3.format(".2f");
const parse = d3.utcParse("%Y-%m-%d");
const monthLabel = d3.utcFormat("%b %Y");
const dayLabel = d3.utcFormat("%d %b %Y");
const tip = document.getElementById("tooltip");

const titleCase = (s) => (s || "").toLowerCase().replace(/(^|[\s/-])\w/g, (m) => m.toUpperCase());
// brands written as acronyms stay upper-case
const ACRONYMS = new Set(["BMW", "GMC", "MINI", "SRT", "AM GENERAL"]);
const makeCase = (s) => (ACRONYMS.has(s) ? s : titleCase(s));
// model names keep short or alphanumeric parts upper-case: CR-V, F-150, RAV4, Model Y
const modelCase = (s) => (s || "").split(" ").map((w) => (w.length <= 2 || /[\d-]/.test(w) ? w : titleCase(w))).join(" ");
const keyOf = (s) => `${s.make}|${s.model}|${s.component_group}|${s.month}`;
const vehicle = (s) => `${makeCase(s.make)} ${modelCase(s.model)}`;
// complaint narratives and names are free text from the public: escape before inserting
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const recallUrl = (id) => `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(id)}`;
const investigationUrl = (id) => `https://www.nhtsa.gov/?nhtsaId=${encodeURIComponent(id)}`;
const outLink = (url, text) => `<a class="out" href="${url}" target="_blank" rel="noopener">${esc(text)}</a>`;
const OUTCOMES = {
  recall: { short: "a recall", long: "a recall on the same make, model and component" },
  recall_or_investigation: { short: "a recall or NHTSA investigation", long: "a recall or an NHTSA investigation on the same make, model and component" },
};
const byMake = (rows) => (state.make === "ALL" ? rows : rows.filter((r) => r.make === state.make));

/* ---------- tooltip ---------- */
function showTip(event, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const { innerWidth: w, innerHeight: h } = window;
  const r = tip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + r.width > w - 8) x = event.clientX - r.width - pad;
  if (y + r.height > h - 8) y = event.clientY - r.height - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
const hideTip = () => { tip.hidden = true; };

/* ---------- summary tiles ---------- */
function renderTiles() {
  const d = state.data;
  const complaints = d3.sum(byMake(d.monthly), (r) => r.complaints);
  const recalls = state.make === "ALL" ? d.meta.recalls
    : d3.sum(d.recall_counts.filter((r) => r.make === state.make), (r) => r.campaigns);
  const signals = byMake(d.signals);
  const followed = signals.filter((s) => s.days_to_recall != null);
  const lead = d3.median(followed, (s) => s.days_to_recall);
  // only signals with a full 365 days of data after them can count as "no recall"
  const closed = signals.filter((s) => s.followup_complete);
  const closedHit = closed.filter((s) => s.days_to_recall != null);
  const open = signals.length - closed.length;
  const tiles = [
    { label: "Complaint records", value: fmt(complaints), note: `${monthLabel(parse(d.meta.first_month))} to ${monthLabel(parse(d.meta.last_month))}` },
    { label: "Recall campaigns", value: fmt(recalls), note: "in the same window" },
    { label: "Signals flagged", value: fmt(signals.length), note: "model × component months" },
    closed.length
      ? { label: "Followed by a recall", value: `${Math.round((closedHit.length / closed.length) * 100)}%`, note: `${closedHit.length} of ${closed.length} with a full year to look${open ? `; ${open} still open` : ""}` }
      : { label: "Recalled so far", value: fmt(followed.length), note: `of ${signals.length} signals; none has a full year of follow-up yet` },
    { label: "Median signal lead time", value: lead != null ? `${Math.round(lead)} days` : "–", note: "end of signal month to recall report" },
  ];
  document.getElementById("tiles").innerHTML = tiles.map((t) =>
    `<div class="tile"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="note">${t.note}</div></div>`).join("");
}

/* ---------- shared line-chart frame ---------- */
function frame(el, height = 260) {
  el.innerHTML = "";
  const width = Math.max(320, el.clientWidth);
  const m = { top: 12, right: 16, bottom: 28, left: 48 };
  const svg = d3.select(el).append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
  return { svg, g, w: width - m.left - m.right, h: height - m.top - m.bottom };
}

function axes(g, x, y, w, h) {
  g.append("g").attr("class", "y-grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(d3.format("~s")))
    .call((s) => s.select(".domain").remove())
    .call((s) => s.selectAll(".tick line").style("stroke", "var(--grid)"));
  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(w / 90))).tickFormat(d3.utcFormat("%b %y")).tickSizeOuter(0))
    .call((s) => s.select(".domain").style("stroke", "var(--axis)"))
    .call((s) => s.selectAll(".tick line").remove());
}

function crosshair(g, x, w, h, points, onMove) {
  const rule = g.append("line").attr("y1", 0).attr("y2", h)
    .style("stroke", "var(--axis)").style("stroke-width", 1).style("display", "none");
  const focus = g.append("circle").attr("r", 5)
    .style("fill", "var(--series-1)").style("stroke", "var(--surface)").style("stroke-width", 2).style("display", "none");
  const bisect = d3.bisector((p) => p.date).center;
  g.append("rect").attr("width", w).attr("height", h).style("fill", "transparent")
    .on("pointermove", (event) => {
      const [mx] = d3.pointer(event);
      const p = points[bisect(points, x.invert(mx))];
      if (!p) return;
      rule.attr("x1", x(p.date)).attr("x2", x(p.date)).style("display", null);
      focus.attr("cx", x(p.date)).attr("cy", p.y).style("display", null);
      showTip(event, onMove(p));
    })
    .on("pointerleave", () => { rule.style("display", "none"); focus.style("display", "none"); hideTip(); });
}

/* ---------- monthly trend ---------- */
function renderTrend() {
  const el = document.getElementById("trend-chart");
  const d = state.data;
  const months = d3.rollups(byMake(d.monthly), (v) => d3.sum(v, (r) => r.complaints), (r) => r.month)
    .map(([month, complaints]) => ({ month, date: parse(month), complaints }))
    .sort((a, b) => a.date - b.date);
  const sigByMonth = d3.group(byMake(d.signals), (s) => s.month);
  document.getElementById("trend-title").textContent =
    state.make === "ALL" ? "Monthly complaints, all makes" : `Monthly complaints, ${makeCase(state.make)}`;
  if (!months.length) { el.innerHTML = '<p class="empty">No complaints for this selection.</p>'; return; }

  const { g, w, h } = frame(el, 280);
  const x = d3.scaleUtc().domain(d3.extent(months, (p) => p.date)).range([0, w]);
  const y = d3.scaleLinear().domain([0, d3.max(months, (p) => p.complaints)]).nice().range([h, 0]);
  axes(g, x, y, w, h);

  g.append("path").datum(months)
    .attr("d", d3.area().x((p) => x(p.date)).y0(h).y1((p) => y(p.complaints)).curve(d3.curveMonotoneX))
    .style("fill", "var(--series-1-wash)");
  g.append("path").datum(months)
    .attr("d", d3.line().x((p) => x(p.date)).y((p) => y(p.complaints)).curve(d3.curveMonotoneX))
    .style("fill", "none").style("stroke", "var(--series-1)").style("stroke-width", 2)
    .style("stroke-linejoin", "round").style("stroke-linecap", "round");

  // across all makes nearly every month has some signal, so markers only
  // carry information once a single make is selected
  const showMarks = state.make !== "ALL";
  document.getElementById("trend-key").hidden = !showMarks;
  const flagged = showMarks ? months.filter((p) => sigByMonth.has(p.month)) : [];
  g.selectAll(".sig").data(flagged).join("circle").attr("class", "sig")
    .attr("cx", (p) => x(p.date)).attr("cy", (p) => y(p.complaints)).attr("r", 5)
    .style("fill", "var(--critical)").style("stroke", "var(--surface)").style("stroke-width", 2);

  const last = months[months.length - 1];
  g.append("text").attr("x", x(last.date)).attr("y", y(last.complaints) - 10).attr("text-anchor", "end")
    .style("fill", "var(--text-secondary)").style("font-weight", 600).text(fmt(last.complaints));

  const points = months.map((p) => ({ ...p, y: y(p.complaints) }));
  crosshair(g, x, w, h, points, (p) => {
    const sigs = sigByMonth.get(p.month) || [];
    const list = sigs.slice().sort((a, b) => b.z_score - a.z_score).slice(0, 4).map((s) => `<div class="t-row">▲ ${esc(vehicle(s))} · ${esc(titleCase(s.component_group))}</div>`).join("");
    const more = sigs.length > 4 ? `<div class="t-row">+${sigs.length - 4} more</div>` : "";
    const head = sigs.length ? `<div class="t-row">${fmt(sigs.length)} signals, strongest:</div>` : "";
    return `<div class="t-title">${monthLabel(p.date)}</div><div>${fmt(p.complaints)} complaint records</div>${head}${list}${more}`;
  });

  document.getElementById("trend-table").innerHTML = `<table class="data"><thead><tr><th>Month</th><th class="num">Complaint records</th><th class="num">Signals</th></tr></thead><tbody>${
    months.map((p) => `<tr><td>${monthLabel(p.date)}</td><td class="num">${fmt(p.complaints)}</td><td class="num">${(sigByMonth.get(p.month) || []).length}</td></tr>`).join("")}</tbody></table>`;
}

/* ---------- top components ---------- */
function renderComponents() {
  const el = document.getElementById("component-chart");
  const rows = d3.rollups(byMake(state.data.components), (v) => d3.sum(v, (r) => r.complaints), (r) => r.component_group)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 10);
  if (!rows.length) { el.innerHTML = '<p class="empty">No complaints in the last 12 months.</p>'; return; }
  el.innerHTML = "";
  const width = Math.max(320, el.clientWidth);
  const band = 28;
  // size the label column to the longest label, capped so bars keep room
  const probe = d3.select(el).append("svg").append("text").style("font-size", "12px");
  const longest = d3.max(rows, (r) => probe.text(titleCase(r.name)).node().getComputedTextLength());
  probe.node().parentNode.remove();
  const maxLabel = width * 0.48;
  const m = { top: 4, right: 56, bottom: 4, left: Math.min(longest + 14, maxLabel) };
  const height = rows.length * band + m.top + m.bottom;
  const w = width - m.left - m.right;
  const svg = d3.select(el).append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
  const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.value)]).range([0, w]);
  const y = d3.scaleBand().domain(rows.map((r) => r.name)).range([0, rows.length * band]);
  const barH = Math.min(18, y.bandwidth() - 6);
  const r = 4;
  // square at the baseline, 4px rounded data-end
  const barPath = (len, top) => {
    const L = Math.max(len, r);
    return `M0,${top}H${L - r}Q${L},${top} ${L},${top + r}V${top + barH - r}Q${L},${top + barH} ${L - r},${top + barH}H0Z`;
  };
  const rowsG = g.selectAll(".row").data(rows).join("g").attr("class", "row")
    .attr("transform", (d) => `translate(0,${y(d.name)})`);
  rowsG.append("text").attr("x", -10).attr("y", y.bandwidth() / 2).attr("dy", "0.35em").attr("text-anchor", "end")
    .style("fill", "var(--text-secondary)").text((d) => titleCase(d.name))
    .each(function () { // truncate with an ellipsis if a label still doesn't fit
      const t = d3.select(this); let txt = t.text();
      while (this.getComputedTextLength() > m.left - 14 && txt.length > 4) { txt = txt.slice(0, -1); t.text(`${txt.trimEnd()}…`); }
    });
  rowsG.append("path").attr("d", (d) => barPath(x(d.value), (y.bandwidth() - barH) / 2)).style("fill", "var(--series-1)");
  rowsG.append("text").attr("x", (d) => x(d.value) + 6).attr("y", y.bandwidth() / 2).attr("dy", "0.35em")
    .style("fill", "var(--text-secondary)").text((d) => fmt(d.value));
  rowsG.append("rect").attr("x", -m.left).attr("width", width).attr("height", y.bandwidth()).style("fill", "transparent")
    .on("pointermove", (event, d) => showTip(event, `<div class="t-title">${esc(titleCase(d.name))}</div><div>${fmt(d.value)} complaint records, last 12 months</div>`))
    .on("pointerleave", hideTip);
}

/* ---------- signal detail ---------- */
function renderDetail() {
  const el = document.getElementById("detail-chart");
  const s = state.selected;
  const title = document.getElementById("detail-title");
  if (!s) { title.textContent = "Signal detail"; el.innerHTML = '<p class="empty">No signals for this selection.</p>'; renderFacts(); return; }
  title.textContent = `${vehicle(s)} · ${titleCase(s.component_group)}`;
  renderFacts();
  const ser = state.data.series.find((r) => r.make === s.make && r.model === s.model && r.component_group === s.component_group);
  const start = parse(ser.start);
  const pts = ser.complaints.map((complaints, i) => ({
    date: d3.utcMonth.offset(start, i), complaints, baseline_mean: ser.baseline[i], is_signal: ser.signal.includes(i) }));
  const { g, w, h } = frame(el, 260);
  const x = d3.scaleUtc().domain(d3.extent(pts, (p) => p.date)).range([0, w]);
  const y = d3.scaleLinear().domain([0, 1.1 * d3.max(pts, (p) => Math.max(p.complaints, p.baseline_mean || 0))]).nice().range([h, 0]);
  axes(g, x, y, w, h);
  const base = pts.filter((p) => p.baseline_mean != null);
  g.append("path").datum(base)
    .attr("d", d3.line().x((p) => x(p.date)).y((p) => y(p.baseline_mean)))
    .style("fill", "none").style("stroke", "var(--baseline)").style("stroke-width", 2).style("stroke-dasharray", "4 4");
  g.append("path").datum(pts)
    .attr("d", d3.line().x((p) => x(p.date)).y((p) => y(p.complaints)))
    .style("fill", "none").style("stroke", "var(--series-1)").style("stroke-width", 2)
    .style("stroke-linejoin", "round").style("stroke-linecap", "round");
  g.selectAll(".sig").data(pts.filter((p) => p.is_signal)).join("circle").attr("class", "sig")
    .attr("cx", (p) => x(p.date)).attr("cy", (p) => y(p.complaints)).attr("r", 5)
    .style("fill", "var(--critical)").style("stroke", "var(--surface)").style("stroke-width", 2);
  if (s.next_recall_date) {
    const rx = x(parse(s.next_recall_date));
    if (rx >= 0 && rx <= w) {
      g.append("line").attr("x1", rx).attr("x2", rx).attr("y1", 0).attr("y2", h)
        .style("stroke", "var(--text-muted)").style("stroke-width", 1);
      // label sits at the foot of the rule, on whichever side has room
      const right = rx + 130 < w;
      g.append("text").attr("x", right ? rx + 6 : rx - 6).attr("y", h - 8).attr("text-anchor", right ? "start" : "end")
        .style("fill", "var(--text-secondary)").text(`Recall ${dayLabel(parse(s.next_recall_date))}`);
    }
  }
  crosshair(g, x, w, h, pts.map((p) => ({ ...p, y: y(p.complaints) })), (p) =>
    `<div class="t-title">${monthLabel(p.date)}${p.is_signal ? " · ▲ signal" : ""}</div>
     <div>${fmt(p.complaints)} complaints</div>
     <div class="t-row">Baseline ${p.baseline_mean != null ? fmt1(p.baseline_mean) : "–"}${p.baseline_mean ? ` · ${fmt1(p.complaints / p.baseline_mean)}×` : ""}</div>`);
}

/* ---------- backtest ---------- */
function renderBacktest() {
  const el = document.getElementById("backtest-chart");
  const all = (state.data.backtest || []).filter((r) => r.outcome === state.outcome);
  const rows = all.filter((r) => r.slice === "all");
  const label = OUTCOMES[state.outcome];
  document.getElementById("outcome-text").textContent = label.long;
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.outcome === state.outcome)));
  const callout = document.getElementById("backtest-callout");
  renderOutOfSample(all);
  if (!rows.length || !rows[0].eligible_months) {
    el.innerHTML = '<p class="empty">No months with a full year of follow-up yet.</p>';
    callout.textContent = "";
    return;
  }
  const base = rows[0].base_rate;
  const cur = rows.find((r) => r.is_current);
  if (cur && cur.signals) {
    callout.innerHTML = `At the current setting (z ≥ ${cur.min_z}, ≥ ${cur.ratio}× baseline), <strong>${pct(cur.hit_rate)}</strong> of
      ${fmt(cur.signals)} signals were followed by ${label.short}, against <strong>${pct(base)}</strong> of all
      ${fmt(cur.eligible_months)} eligible months: <strong>${fmt2(cur.lift)}× the base rate</strong>, with a median
      ${Math.round(cur.median_days_to_outcome)} days from the end of the signal month.`;
  }

  const ratios = [...new Set(rows.map((r) => r.ratio))].sort(d3.ascending);
  const color = (r) => `var(--series-${ratios.indexOf(r) + 1})`;
  const lines = ratios.map((ratio) => ({ ratio, pts: rows.filter((r) => r.ratio === ratio && r.signals > 0).sort((a, b) => a.min_z - b.min_z) }));

  el.innerHTML = "";
  const width = Math.max(320, el.clientWidth);
  const height = 260;
  const m = { top: 14, right: 64, bottom: 34, left: 48 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const svg = d3.select(el).append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
  const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.min_z)).range([0, w]);
  const y = d3.scaleLinear().domain([0, Math.max(base, d3.max(rows, (r) => r.hit_rate || 0)) * 1.1]).nice().range([h, 0]);

  g.append("g").call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(pct))
    .call((s) => s.select(".domain").remove())
    .call((s) => s.selectAll(".tick line").style("stroke", "var(--grid)"));
  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickValues([...new Set(rows.map((r) => r.min_z))]).tickFormat((v) => (w < 420 ? `${v}` : `z ≥ ${v}`)).tickSizeOuter(0))
    .call((s) => s.select(".domain").style("stroke", "var(--axis)"))
    .call((s) => s.selectAll(".tick line").remove());

  // base rate reference
  g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(base)).attr("y2", y(base))
    .style("stroke", "var(--baseline)").style("stroke-width", 2).style("stroke-dasharray", "4 4");

  const line = d3.line().x((p) => x(p.min_z)).y((p) => y(p.hit_rate));
  lines.forEach(({ ratio, pts }) => {
    g.append("path").datum(pts).attr("d", line)
      .style("fill", "none").style("stroke", color(ratio)).style("stroke-width", 2)
      .style("stroke-linejoin", "round").style("stroke-linecap", "round");
    g.selectAll(null).data(pts).join("circle")
      .attr("cx", (p) => x(p.min_z)).attr("cy", (p) => y(p.hit_rate)).attr("r", 4)
      .style("fill", color(ratio)).style("stroke", "var(--surface)").style("stroke-width", 2);
  });
  // direct labels at the line ends, nudged apart so they never overlap
  // the base-rate label joins the same pass, so no two labels overlap
  const ends = lines.filter((l) => l.pts.length)
    .map((l) => ({ label: `≥ ${l.ratio}×`, ty: y(l.pts[l.pts.length - 1].hit_rate) }))
    .concat([{ label: `base ${pct(base)}`, ty: y(base) }])
    .sort((a, b) => a.ty - b.ty);
  for (let i = 1; i < ends.length; i++) ends[i].ty = Math.max(ends[i].ty, ends[i - 1].ty + 14);
  ends.forEach((e) => g.append("text").attr("x", w + 8).attr("y", e.ty).attr("dy", "0.35em")
    .style("fill", "var(--text-secondary)").text(e.label));

  // the current setting gets a ring
  if (cur && cur.signals) {
    g.append("circle").attr("cx", x(cur.min_z)).attr("cy", y(cur.hit_rate)).attr("r", 9)
      .style("fill", "none").style("stroke", "var(--text-primary)").style("stroke-width", 1.5);
    g.append("text").attr("x", x(cur.min_z)).attr("y", y(cur.hit_rate) - 14).attr("text-anchor", "middle")
      .style("fill", "var(--text-primary)").style("font-weight", 600).text("current");
  }

  // hover: nearest point anywhere in the plot
  const pts = lines.flatMap((l) => l.pts.map((p) => ({ ...p, px: x(p.min_z), py: y(p.hit_rate) })));
  const focus = g.append("circle").attr("r", 6).style("fill", "none").style("stroke", "var(--text-primary)").style("stroke-width", 2).style("display", "none");
  g.append("rect").attr("width", w).attr("height", h).style("fill", "transparent")
    .on("pointermove", (event) => {
      const [mx, my] = d3.pointer(event);
      const p = d3.least(pts, (q) => (q.px - mx) ** 2 + (q.py - my) ** 2);
      if (!p) return;
      focus.attr("cx", p.px).attr("cy", p.py).style("display", null);
      showTip(event, `<div class="t-title">z ≥ ${p.min_z}, ≥ ${p.ratio}× baseline${p.is_current ? " · current" : ""}</div>
        <div>${pct(p.hit_rate)} followed by ${label.short} (${fmt(p.hits)} of ${fmt(p.signals)})</div>
        <div class="t-row">${fmt2(p.lift)}× the base rate · median ${p.median_days_to_outcome != null ? Math.round(p.median_days_to_outcome) : "–"} days</div>`);
    })
    .on("pointerleave", () => { focus.style("display", "none"); hideTip(); });

  const liftIn = (r, slice) => {
    const m = all.find((q) => q.slice === slice && q.min_z === r.min_z && q.ratio === r.ratio);
    return m && m.lift != null ? `${fmt2(m.lift)}×` : "–";
  };
  document.getElementById("backtest-table").innerHTML = `<table class="data"><thead><tr><th class="num">z-score ≥</th><th class="num">× baseline ≥</th><th class="num">Signals</th><th class="num">Followed</th><th class="num">Lift</th><th class="num">Lift 2020–22</th><th class="num">Lift 2023–25</th><th class="num">Median days</th></tr></thead><tbody>${
    rows.map((r) => `<tr class="${r.is_current ? "selected" : ""}"><td class="num">${r.min_z}</td><td class="num">${r.ratio}×</td><td class="num">${fmt(r.signals)}</td><td class="num">${r.signals ? pct(r.hit_rate) : "–"}</td><td class="num">${r.lift != null ? `${fmt2(r.lift)}×` : "–"}</td><td class="num">${liftIn(r, "2020-2022")}</td><td class="num">${liftIn(r, "2023-2025")}</td><td class="num">${r.median_days_to_outcome != null ? Math.round(r.median_days_to_outcome) : "–"}</td></tr>`).join("")
  }<tr><td colspan="2">Every eligible month</td><td class="num">${fmt(rows[0].eligible_months)}</td><td class="num">${pct(base)}</td><td class="num">1.00×</td><td></td><td></td><td></td></tr></tbody></table>`;
}

// Tune on the early years, test on the later ones: the honest check on the
// thresholds, since picking the best row of a table flatters it.
function renderOutOfSample(all) {
  const el = document.getElementById("backtest-oos");
  const train = all.filter((r) => r.slice === "2020-2022" && r.signals >= 30 && r.lift != null);
  const best = d3.greatest(train, (r) => r.lift);
  const test = best && all.find((r) => r.slice === "2023-2025" && r.min_z === best.min_z && r.ratio === best.ratio);
  if (!best || !test || test.lift == null) { el.textContent = ""; return; }
  const cur = (slice) => all.find((r) => r.slice === slice && r.is_current);
  const c1 = cur("2020-2022"), c2 = cur("2023-2025");
  el.innerHTML = `<strong>Out-of-sample check.</strong> The thresholds that scored best on 2020–22 signals
    (z ≥ ${best.min_z}, ≥ ${best.ratio}×: ${fmt2(best.lift)}×) scored <strong>${fmt2(test.lift)}×</strong> on 2023–25.
    ${c1 && c2 && c1.lift != null && c2.lift != null ? `The default setting scored ${fmt2(c1.lift)}× and ${fmt2(c2.lift)}×.` : ""}`;
}

/* ---------- sortable tables ---------- */
function table(el, columns, rows, { onSelect, selectedKey, rowKey, limit } = {}) {
  let sort = el._sort || null;
  const draw = () => {
    let data = rows.slice();
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      data.sort((a, b) => d3[sort.dir](col.sortValue ? col.sortValue(a) : a[col.key], col.sortValue ? col.sortValue(b) : b[col.key]));
    }
    if (limit) data = data.slice(0, limit);
    el.classList.toggle("clickable", !!onSelect);
    el.innerHTML = `<thead><tr>${columns.map((c) =>
      `<th data-key="${c.key}" class="${c.num ? "num" : ""}" ${sort && sort.key === c.key ? `aria-sort="${sort.dir}"` : ""}>${c.label}</th>`).join("")}</tr></thead>
      <tbody>${data.map((r, i) => `<tr data-i="${i}" class="${rowKey && rowKey(r) === selectedKey ? "selected" : ""}">${columns.map((c) =>
        `<td class="${c.num ? "num" : ""}">${c.render ? c.render(r) : esc(r[c.key] ?? "–")}</td>`).join("")}</tr>`).join("")}</tbody>`;
    if (!data.length) el.innerHTML += `<tbody><tr><td colspan="${columns.length}" class="empty">Nothing to show for this selection.</td></tr></tbody>`;
    el.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const key = th.dataset.key;
      sort = { key, dir: sort && sort.key === key && sort.dir === "descending" ? "ascending" : "descending" };
      el._sort = sort;
      draw();
    }));
    if (onSelect) el.querySelectorAll("tbody tr[data-i]").forEach((tr) =>
      tr.addEventListener("click", () => onSelect(data[+tr.dataset.i])));
  };
  draw();
}

function renderSignals() {
  const rows = byMake(state.data.signals);
  table(document.getElementById("signals-table"), [
    { key: "month", label: "Month", render: (r) => monthLabel(parse(r.month)) },
    { key: "make", label: "Make", render: (r) => esc(makeCase(r.make)) },
    { key: "model", label: "Model", render: (r) => esc(modelCase(r.model)) },
    { key: "component_group", label: "Component", render: (r) => esc(titleCase(r.component_group)) },
    { key: "complaints", label: "Complaints", num: true, render: (r) => fmt(r.complaints) },
    { key: "baseline_mean", label: "Baseline", num: true, render: (r) => fmt1(r.baseline_mean) },
    { key: "ratio_to_baseline", label: "× baseline", num: true, render: (r) => `${fmt1(r.ratio_to_baseline)}×` },
    { key: "z_score", label: "z-score", num: true, render: (r) => fmt1(r.z_score) },
    { key: "days_to_recall", label: "Recall within 365 days", sortValue: (r) => r.days_to_recall ?? (r.followup_complete ? -2 : -1),
      render: (r) => r.days_to_recall != null
        ? `<span class="pill yes">✓ ${r.days_to_recall} days later</span> ${outLink(recallUrl(r.next_recall_campaign), r.next_recall_campaign)}`
        : r.followup_complete ? '<span class="pill no">None</span>' : '<span class="pill no">None yet (window open)</span>' },
    { key: "days_to_investigation", label: "NHTSA investigation", sortValue: (r) => r.days_to_investigation ?? 9999,
      render: (r) => r.next_investigation_number
        ? `${outLink(investigationUrl(r.next_investigation_number), r.next_investigation_number)} <span class="pill no">${r.days_to_investigation <= 0 ? "same month" : `${r.days_to_investigation} days later`}</span>`
        : '<span class="pill no">–</span>' },
  ], rows, {
    limit: state.allSignals ? null : SIGNAL_ROWS,
    rowKey: keyOf, selectedKey: state.selected && keyOf(state.selected),
    onSelect: (r) => { state.selected = r; renderDetail(); renderSignals(); saveView(); },
  });
  const more = document.getElementById("signals-more");
  more.hidden = rows.length <= SIGNAL_ROWS;
  more.textContent = state.allSignals ? "Show fewer" : `Show all ${fmt(rows.length)} signals`;
}

function renderRecalls() {
  table(document.getElementById("recalls-table"), [
    { key: "campaign_number", label: "Campaign", render: (r) => outLink(recallUrl(r.campaign_number), r.campaign_number) },
    { key: "make", label: "Make", render: (r) => esc(makeCase(r.make)) },
    { key: "model", label: "Model", render: (r) => esc(modelCase(r.model)) },
    { key: "component_group", label: "Component", render: (r) => esc(titleCase(r.component_group)) },
    { key: "report_received_date", label: "Report received", render: (r) => r.report_received_date ? dayLabel(parse(r.report_received_date)) : "–" },
    { key: "potentially_affected", label: "Vehicles affected", num: true, render: (r) => r.potentially_affected != null ? fmt(r.potentially_affected) : "–" },
    { key: "complaints_180d_before_recall", label: "Complaints, 180 days before", num: true, render: (r) => fmt(r.complaints_180d_before_recall) },
  ], byMake(state.data.recalls), {
    limit: 20,
    rowKey: (r) => r.campaign_number, selectedKey: state.recall,
    onSelect: (r) => { state.recall = r.campaign_number; renderRecalls(); showRecall(r.campaign_number); },
  });
}

// Recall text comes live from NHTSA's public API, so the dashboard stays small
// and always shows NHTSA's current wording.
const recallCache = new Map();
function showRecall(id) {
  const panel = document.getElementById("recall-panel");
  panel.hidden = false;
  panel.innerHTML = `<h3>${esc(id)}</h3><p class="sub">Loading from NHTSA…</p>`;
  if (!recallCache.has(id)) {
    recallCache.set(id, fetch(`https://api.nhtsa.gov/recalls/campaignNumber?campaignNumber=${encodeURIComponent(id)}`)
      .then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); }));
  }
  recallCache.get(id).then((json) => {
    if (state.recall !== id) return;
    const rs = json.results || [];
    if (!rs.length) throw new Error("no record");
    const r = rs[0];
    const models = [...new Set(rs.map((x) => `${makeCase((x.Make || "").toUpperCase())} ${modelCase((x.Model || "").toUpperCase())}`))];
    const years = d3.extent(rs, (x) => +x.ModelYear || null);
    // the API writes dates as DD/MM/YYYY
    const received = d3.utcParse("%d/%m/%Y")(r.ReportReceivedDate);
    const flags = [r.parkIt && "Park it: don't drive", r.parkOutSide && "Park outside", r.overTheAirUpdate && "Fixed over the air"].filter(Boolean);
    panel.innerHTML = `<h3>${esc(id)} · ${esc(r.Component)}</h3>
      <div class="sub">${esc(r.Manufacturer)} · report received ${received ? dayLabel(received) : esc(r.ReportReceivedDate)} · ${fmt(+r.PotentialNumberofUnitsAffected || 0)} vehicles ·
        ${outLink(recallUrl(id), "Open on NHTSA")}</div>
      ${flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("")}
      <dl>
        <dt>Vehicles</dt><dd>${esc(models.slice(0, 6).join(", "))}${models.length > 6 ? ` and ${models.length - 6} more` : ""}${years[0] ? ` (${years[0] === years[1] ? years[0] : `${years[0]}–${years[1]}`})` : ""}</dd>
        <dt>Defect</dt><dd>${esc(r.Summary)}</dd>
        <dt>Consequence</dt><dd>${esc(r.Consequence)}</dd>
        <dt>Remedy</dt><dd>${esc(r.Remedy)}</dd>
      </dl>`;
  }).catch(() => {
    if (state.recall !== id) return;
    recallCache.delete(id);
    panel.innerHTML = `<h3>${esc(id)}</h3><p class="sub">Couldn't load the details from NHTSA's API. ${outLink(recallUrl(id), "Open the recall on NHTSA")}</p>`;
  });
}

/* ---------- what owners describe (loaded on first use) ---------- */
let signalText = null;
const loadSignalText = () => (signalText ??= fetch("data/signal_text.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

function renderFacts() {
  const el = document.getElementById("detail-facts");
  const s = state.selected;
  if (!s) { el.innerHTML = ""; return; }
  const outcomes = [
    s.next_recall_campaign
      ? `Recall ${outLink(recallUrl(s.next_recall_campaign), s.next_recall_campaign)}, ${s.days_to_recall} days after the month ended`
      : s.followup_complete ? "No recall on this model and component within a year" : "No recall yet; the year isn't over",
    s.next_investigation_number
      ? `NHTSA investigation ${outLink(investigationUrl(s.next_investigation_number), s.next_investigation_number)}, ${s.days_to_investigation <= 0 ? "opened the same month" : `opened ${s.days_to_investigation} days later`}`
      : s.followup_complete ? "No NHTSA investigation of this model and component within a year" : "No NHTSA investigation yet",
  ];
  el.innerHTML = `<div class="outcomes">${outcomes.map((o) => `<span>${o}</span>`).join("")}</div><h3>What owners describe</h3><p>Loading…</p>`;
  const key = keyOf(s);
  loadSignalText().then((all) => {
    if (!state.selected || keyOf(state.selected) !== key) return;
    const t = all[key];
    const body = !t ? "<p>No narratives exported for this signal.</p>" : `
      <div class="chips">${t.phrases.map(([p, n]) => `<span class="chip">${esc(p)}<b>${fmt(n)}</b></span>`).join("") || "<span>No phrase repeats.</span>"}</div>
      ${t.years.length ? `<p>Most complaints are about model years ${t.years.map(([y, n]) => `${esc(y)} (${fmt(n)})`).join(", ")}.</p>` : ""}
      ${t.examples.map((x) => `<p class="quote">${esc(x)}</p>`).join("")}`;
    el.innerHTML = `<div class="outcomes">${outcomes.map((o) => `<span>${o}</span>`).join("")}</div>
      <h3>What owners describe <span class="sub">(phrases counted once per complaint)</span></h3>${body}`;
  });
}

/* ---------- CSV and shareable links ---------- */
function downloadSignals() {
  const cols = ["month", "make", "model", "component_group", "complaints", "baseline_mean", "ratio_to_baseline", "z_score",
    "next_recall_campaign", "next_recall_date", "days_to_recall", "next_investigation_number", "next_investigation_date", "followup_complete"];
  const cell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(","), ...byMake(state.data.signals).map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `signals-${state.make === "ALL" ? "all-makes" : state.make.toLowerCase().replace(/\W+/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// The view lives in the URL hash, so a link reopens the same make and signal.
function saveView() {
  const p = new URLSearchParams();
  if (state.make !== "ALL") p.set("make", state.make);
  if (state.selected) p.set("signal", keyOf(state.selected));
  if (state.outcome !== "recall") p.set("outcome", state.outcome);
  history.replaceState(null, "", `${location.pathname}${location.search}${p.toString() ? `#${p}` : ""}`);
}

function loadView() {
  const p = new URLSearchParams(location.hash.slice(1));
  const make = p.get("make");
  if (make && state.data.monthly.some((r) => r.make === make)) state.make = make;
  if (OUTCOMES[p.get("outcome")]) state.outcome = p.get("outcome");
  const sig = p.get("signal");
  state.selected = (sig && state.data.signals.find((s) => keyOf(s) === sig)) || null;
}

/* ---------- wiring ---------- */
function renderAll() {
  const signals = byMake(state.data.signals);
  // default to the strongest signal (highest z-score) for the current filter
  if (!state.selected || (state.make !== "ALL" && state.selected.make !== state.make))
    state.selected = signals.length ? signals.reduce((a, b) => (b.z_score > a.z_score ? b : a)) : null;
  document.getElementById("filter-hint").textContent =
    state.make === "ALL" ? "Showing every make. Pick one to focus the charts and tables." : `Showing ${makeCase(state.make)} only.`;
  renderTiles(); renderTrend(); renderComponents(); renderDetail(); renderBacktest(); renderSignals(); renderRecalls();
}

function init(data) {
  state.data = data;
  const { meta } = data;
  const badge = document.getElementById("data-badge");
  const sample = meta.data_label !== "NHTSA";
  badge.textContent = sample ? "Sample data" : "NHTSA data";
  badge.classList.toggle("sample", sample);
  document.getElementById("sample-notice").hidden = !sample;
  document.getElementById("data-range").textContent =
    `${monthLabel(parse(meta.first_month))} to ${monthLabel(parse(meta.last_month))}`;
  document.getElementById("generated").textContent = `Data refreshed ${meta.generated_at.replace("T", " ").slice(0, 16)} UTC.`
    + (meta.last_received ? ` Complaints received through ${dayLabel(parse(meta.last_received))}; the month in progress is left out.` : "");

  // makes by complaint volume, so the ones people look for are at the top
  const select = document.getElementById("make-filter");
  d3.rollups(data.monthly, (v) => d3.sum(v, (r) => r.complaints), (r) => r.make)
    .sort((a, b) => b[1] - a[1] || d3.ascending(a[0], b[0]))
    .forEach(([mk, n]) => {
      const o = document.createElement("option");
      o.value = mk; o.textContent = `${makeCase(mk)} (${fmt(n)})`;
      select.appendChild(o);
    });
  document.getElementById("signals-more").addEventListener("click", () => {
    state.allSignals = !state.allSignals; renderSignals();
  });
  select.addEventListener("change", () => { state.make = select.value; state.selected = null; state.allSignals = false; renderAll(); saveView(); });
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    state.outcome = b.dataset.outcome; renderBacktest(); saveView();
  }));
  document.getElementById("signals-csv").addEventListener("click", downloadSignals);
  document.getElementById("copy-link").addEventListener("click", (e) => {
    saveView();
    navigator.clipboard?.writeText(location.href).then(() => {
      e.target.textContent = "Link copied";
      setTimeout(() => { e.target.textContent = "Copy link to this view"; }, 1500);
    });
  });
  loadView();
  select.value = state.make;

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
  });

  let t;
  new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { renderTrend(); renderComponents(); renderDetail(); renderBacktest(); }, 120); })
    .observe(document.querySelector(".grid"));
  renderAll();
}

fetch("data/dashboard.json")
  .then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
  .then(init)
  .catch((err) => {
    document.getElementById("data-badge").textContent = "No data";
    document.getElementById("tiles").innerHTML =
      `<p class="empty">Couldn't load data/dashboard.json (${err.message}). Run scripts/export_dashboard.py, then serve this folder with <code>python -m http.server</code>.</p>`;
  });
