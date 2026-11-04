// Thyroid labs vs. methimazole dose (raw / normalized / overlay views), ported from jpolizzi/dose_response_prototype.ipynb.
// Colors and reference ranges match the notebook.

const BLUE = "#2a78d6", ORANGE = "#eb6834";
const SURFACE = "#fcfcfb", INK = "#0b0b0b", INK2 = "#52514e", MUTED = "#a3a29c";
const REF_GREEN = "#39FF14";
const STATUS_COLORS = {
  hyperthyroid: "#e34948",
  subclinical_hyper: "#eda100",
  euthyroid: "#1baf7a",
  subclinical_hypo: "#6250d6",
  hypothyroid: "#2a78d6",
};
// Kaggle diagnosis groups for the lookalikes strip (same hues as the matching statuses).
const LOOKALIKE_GROUPS = ["hyper", "normal", "hypo"];
const LOOKALIKE_COLORS = { hyper: "#e34948", normal: "#1baf7a", hypo: "#2a78d6" };

// UCSD lab reference ranges.
const REF = { TSH: [0.27, 4.2], FT4: [0.93, 1.7], T3: [0.8, 2.0] };
const LABS = ["TSH", "FT4", "T3"];
const LAB_COLORS = { TSH: BLUE, FT4: ORANGE, T3: INK2 };
const LAB_NAMES = { TSH: "TSH", FT4: "Free T4", T3: "Total T3" };
const UNITS = { TSH: "mIU/L", FT4: "ng/dL", T3: "total, ng/mL" };
const HOVER_UNITS = { TSH: "mIU/L", FT4: "ng/dL", T3: "ng/mL" };

const parseDate = d3.utcParse("%Y-%m-%d");
const DAY = 24 * 60 * 60 * 1000;

// The journal is optional: without it the chart still works, the panel just has nothing to show.
Promise.all([
  d3.json("../data/processed/personal.json"),
  d3.json("../data/journal.json").catch(() => ({})),
  d3.csv("../data/processed/all_labs.csv"),
  d3.json("../data/processed/lookalikes.json"),
]).then(([raw, journal, allLabs, lookalikes]) => draw(raw, journal, allLabs, lookalikes));

function normalize(lab, v) {
  let [lo, hi] = REF[lab];
  if (lab === "TSH") [v, lo, hi] = [Math.log10(v), Math.log10(lo), Math.log10(hi)];
  return (v - lo) / (hi - lo);
}

function draw(raw, journalEntries, allLabs, lookalikeData) {
  const draws = raw.draws.map(d => ({ ...d, date: parseDate(d.date) }));
  // journal.json maps a date (YYYY-MM-DD) to that day's entry.
  const journal = Object.entries(journalEntries)
    .map(([date, entry]) => ({ date: parseDate(date), entry })).filter(d => d.date && d.entry);
  const labs = raw.labs.map(d => ({ ...d, date: parseDate(d.date) }));
  const status = raw.status_spans.map(d => ({ ...d, start: parseDate(d.start), end: d.end && parseDate(d.end) }));
  const known = raw.dose_spans
    .filter(d => d.dose_mg !== null)
    .map(d => ({ ...d, start: parseDate(d.start), end: parseDate(d.end) }));

  // Lookalikes (pnidadavolu/lookalikes_prototype.ipynb): for each draw with TSH and T3, the share of
  // the closest Kaggle patients diagnosed hyper, normal or hypo, held until the next such draw.
  const K = lookalikeData.k;
  const lookalikes = lookalikeData.draws.map((d, i, all) => ({
    ...d, start: parseDate(d.date), end: all[i + 1] ? parseDate(all[i + 1].date) : null,
  }));
  const series = Object.fromEntries(LABS.map(lab => [
    lab, labs.filter(d => d.lab === lab).sort((a, b) => a.date - b.date),
  ]));

  const xMin = new Date(d3.min(draws, d => d.date) - 20 * DAY);
  const xEnd = new Date(+d3.max(draws, d => d.date) + 45 * DAY);

  // View state, kept across re-renders: the current view, the clicked marker's date,
  // the draw whose journal entry is open, and the zoomed time range (null shows everything).
  let mode = "raw", pinned = null, opened = null, zoom = null;

  // Journal panel: the entry written closest to a draw, within 3 days of it.
  const fmtLong = d3.utcFormat("%B %d, %Y");
  const entryFor = d => {
    const near = journal.filter(j => Math.abs(j.date - d.date) <= 3 * DAY);
    return near.length ? near[d3.minIndex(near, j => Math.abs(j.date - d.date))] : null;
  };
  const journalPanel = d3.select("#journal");
  const journalHint = "Click a data point to read the journal entry from that time.";
  const fillPanel = d => {
    journalPanel.html("");
    if (!d) return journalPanel.append("p").attr("class", "journal-hint").text(journalHint);
    const e = entryFor(d);
    const dose = d.dose_mg === null ? "dose n/a" : `${d3.format("~g")(d.dose_mg)} mg/day`;
    journalPanel.append("h3").text(fmtLong(d.date));
    journalPanel.append("p").attr("class", "journal-meta").text(`${dose} · ${d.status.replace("_", " ")}`);
    journalPanel.append("p").attr("class", e ? "journal-entry" : "journal-hint")
      .text(e ? e.entry : "No journal entry for this draw.");
  };
  // Fades the old entry out and the new one in (the fade itself is a CSS transition).
  let swap = null;
  const showJournal = d => {
    if (d === opened) return;
    opened = d;
    journalPanel.classed("faded", true);
    clearTimeout(swap);
    swap = setTimeout(() => { fillPanel(d); journalPanel.classed("faded", false); }, 200);
  };
  fillPanel(null);

  render();
  d3.selectAll("#dose-view button").on("click", function () { mode = this.value; render(); });
  // Reset clears the zoom, the marker and the journal panel but keeps the current view.
  d3.select("#dose-reset").on("click", () => { zoom = null; allZoom = null; pinned = null; showJournal(null); render(); });

  // Rebuilds the whole chart, since overlay has one lab panel instead of three.
  function render() {
    d3.selectAll("#dose-view button").classed("active", function () { return this.value === mode; });
    d3.select("#side").style("display", mode === "all" ? "none" : null);
    d3.select("#marker-group").style("display", mode === "all" ? null : "none");
    if (mode === "all") return renderAll();
    const overlay = mode === "overlay";
    const panelLabs = overlay ? [LABS] : LABS.map(lab => [lab]);

    // Layout: dose, lab panel(s), status strip (same height ratios as the notebook), lookalikes strip.
    const width = 1000;
    const margin = { top: 8, right: overlay ? 100 : 16, bottom: 70, left: 110 };
    const gap = 14;
    const ratios = [1.3, ...panelLabs.map(() => overlay ? 6.5 : 2), 0.45, 1.6];
    const unit = 62;
    const heights = ratios.map(r => r * unit);
    const last = heights.length - 1;
    // Extra room under the lab panels for the note about open circles and green bands.
    const noteH = 22;
    const tops = heights.map((_, i) => margin.top + d3.sum(heights.slice(0, i)) + gap * i + (i >= last - 1 ? noteH : 0));
    const height = tops[last] + heights[last] + margin.bottom;
    const innerW = width - margin.left - margin.right;

    const x = d3.scaleUtc().domain(zoom || [xMin, xEnd]).range([0, innerW]);

    d3.select("#dose-chart").html("");
    const svg = d3.select("#dose-chart").append("svg")
      .attr("viewBox", [0, 0, width, height])
      .attr("role", "img")
      .attr("aria-label", "Methimazole dose, TSH, Free T4, Total T3 and thyroid status over time");

    // Data marks are clipped to the plot area so zooming doesn't spill into the axes.
    svg.append("defs").append("clipPath").attr("id", "dose-clip")
      .append("rect").attr("y", -20).attr("width", innerW).attr("height", height);
    const clip = sel => sel.attr("clip-path", "url(#dose-clip)");

    const root = svg.append("g").attr("transform", `translate(${margin.left},0)`);
    const panel = i => root.append("g").attr("transform", `translate(0,${tops[i]})`);

    const panelLabel = (g, h, lines) => {
      const t = g.append("text").attr("class", "panel-label")
        .attr("text-anchor", "middle")
        .attr("transform", `translate(${-80},${h / 2}) rotate(-90)`);
      lines.forEach((line, i) => t.append("tspan")
        .attr("x", 0).attr("dy", i === 0 ? `${-(lines.length - 1) * 0.6}em` : "1.2em").text(line));
    };

    // Methimazole dose: step line with a light fill.
    {
      const g = panel(0), h = heights[0];
      const y = d3.scaleLinear().domain([0, 13]).range([h, 0]);
      const pts = known.map(d => [d.start, d.dose_mg]).concat([[known.at(-1).end, known.at(-1).dose_mg]]);
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(3).tickSize(-innerW).tickFormat(""));
      g.append("path").datum(pts).call(clip)
        .attr("fill", BLUE).attr("fill-opacity", 0.12)
        .attr("d", d3.area().curve(d3.curveStepAfter).x(d => x(d[0])).y0(h).y1(d => y(d[1])));
      g.append("path").datum(pts).call(clip)
        .attr("fill", "none").attr("stroke", BLUE).attr("stroke-width", 2)
        .attr("d", d3.line().curve(d3.curveStepAfter).x(d => x(d[0])).y(d => y(d[1])));
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(3));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
        .call(d3.axisBottom(x).tickFormat("").tickSizeOuter(0));
      panelLabel(g, h, ["Methimazole", "(mg/day)"]);
    }

    // Lab panels. Normalized and overlay put 0 at the bottom of the reference range and 1 at the top;
    // TSH is normalized on a log scale.
    // Every lab point's position in the chart, so a click can tell whether it landed on one.
    const points = [];
    panelLabs.forEach((group, i) => {
      const g = panel(i + 1), h = heights[i + 1];
      let y, yAxis, band, value, label;
      if (mode === "raw") {
        const lab = group[0], [lo, hi] = REF[lab];
        value = d => d.value;
        if (lab === "TSH") {
          y = d3.scaleLog().domain([0.006, 8]).range([h, 0]);
        } else {
          const ext = d3.extent([...series[lab].map(d => d.value), lo, hi]);
          const pad = (ext[1] - ext[0]) * 0.08;
          y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([h, 0]).nice();
        }
        yAxis = () => lab === "TSH"
          ? d3.axisLeft(y).tickValues([0.01, 0.1, 1, 4]).tickFormat(v => v === 0.01 ? "<0.01" : d3.format("~g")(v))
          : d3.axisLeft(y).ticks(4);
        band = [lo, hi];
        label = [LAB_NAMES[lab], `(${UNITS[lab]})`];
      } else {
        value = d => normalize(d.lab, d.value);
        y = d3.scaleLinear().domain([-1.5, 3.3]).range([h, 0]);
        yAxis = () => d3.axisLeft(y).tickValues([0, 1]).tickFormat(v => v === 0 ? "low limit" : "high limit");
        band = [0, 1];
        label = overlay ? ["position in reference range", "(0 = low limit, 1 = high limit)"]
          : group[0] === "TSH" ? ["TSH", "(log scale)"] : [LAB_NAMES[group[0]]];
      }

      g.append("rect")
        .attr("x", 0).attr("width", innerW)
        .attr("y", y(band[1])).attr("height", y(band[0]) - y(band[1]))
        .attr("fill", REF_GREEN).attr("fill-opacity", 0.3);
      g.append("g").attr("class", "grid").call(yAxis().tickSize(-innerW).tickFormat(""));
      group.forEach(lab => {
        const s = series[lab];
        g.append("path").datum(s).call(clip)
          .attr("fill", "none").attr("stroke", LAB_COLORS[lab]).attr("stroke-width", 2)
          .attr("d", d3.line().x(d => x(d.date)).y(d => y(value(d))));
        g.append("g").call(clip).selectAll("circle").data(s).join("circle")
          .attr("cx", d => x(d.date)).attr("cy", d => y(value(d))).attr("r", 4.5)
          .attr("fill", d => d.censored ? SURFACE : LAB_COLORS[lab])
          .attr("stroke", d => d.censored ? LAB_COLORS[lab] : SURFACE)
          .attr("stroke-width", 1.5);
        s.forEach(r => points.push({
          draw: draws.find(d => d.id === r.draw_id), cx: x(r.date), cy: tops[i + 1] + y(value(r)),
        }));
      });

      g.append("g").attr("class", "axis").call(yAxis());
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
        .call(d3.axisBottom(x).tickFormat("").tickSizeOuter(0));
      panelLabel(g, h, label);

      if (overlay) {
        const item = g.append("g").attr("class", "legend").attr("transform", `translate(${innerW + 16},10)`)
          .selectAll("g").data(LABS).join("g")
          .attr("transform", (_, j) => `translate(0,${j * 20})`);
        item.append("line").attr("x2", 18).attr("y1", 6).attr("y2", 6)
          .attr("stroke", lab => LAB_COLORS[lab]).attr("stroke-width", 2);
        item.append("text").attr("x", 24).attr("y", 6).attr("dy", "0.35em").text(lab => LAB_NAMES[lab]);
      }
    });

    root.append("text").attr("class", "chart-note").attr("y", tops[last - 1] - gap - 2)
      .text("Open circles are TSH results below the detection limit (<0.01). Green bands are the UCSD lab's reference ranges.");

    d3.select("#dose-title").text(`Thyroid labs vs. methimazole dose (${mode})`);

    // Status strip: each draw's classification held until the next draw.
    {
      const g = panel(last - 1), h = heights[last - 1];
      g.append("g").call(clip).selectAll("rect").data(status).join("rect")
        .attr("x", d => x(d.start))
        .attr("width", d => x(d.end || xEnd) - x(d.start))
        .attr("y", 0).attr("height", h)
        .attr("fill", d => STATUS_COLORS[d.status]).attr("fill-opacity", 0.75);
      g.append("text").attr("class", "panel-label")
        .attr("x", -8).attr("y", h / 2).attr("dy", "0.35em").attr("text-anchor", "end").text("My Status*");
    }

    // Lookalikes strip, right under the doctor's call: what the closest Kaggle patients were
    // diagnosed with, stacked hyper / normal / hypo (bottom to top, as in the notebook).
    {
      const g = panel(last), h = heights[last];
      const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);
      const segments = lookalikes.flatMap(d => {
        let below = 0;
        return LOOKALIKE_GROUPS.map(grp => {
          const s = { d, grp, y0: below, y1: below + d[grp] };
          below = s.y1;
          return s;
        }).filter(s => s.y1 > s.y0);
      });
      const cells = g.append("g").call(clip).selectAll("g").data(segments).join("g");
      cells.append("rect")
        .attr("x", s => x(s.d.start))
        .attr("width", s => x(s.d.end || xEnd) - x(s.d.start))
        .attr("y", s => y(s.y1)).attr("height", s => y(s.y0) - y(s.y1))
        .attr("fill", s => LOOKALIKE_COLORS[s.grp]).attr("fill-opacity", 0.75)
        .attr("stroke", SURFACE).attr("stroke-width", 1);
      // Percentages only where the segment has room for them.
      cells.filter(s => x(s.d.end || xEnd) - x(s.d.start) >= 30 && y(s.y0) - y(s.y1) >= 13)
        .append("text").attr("class", "strip-value")
        .attr("x", s => (x(s.d.start) + x(s.d.end || xEnd)) / 2).attr("y", s => y((s.y0 + s.y1) / 2))
        .attr("dy", "0.35em").attr("text-anchor", "middle")
        .text(s => d3.format(".0%")(s.y1 - s.y0));
      const label = g.append("text").attr("class", "panel-label").attr("text-anchor", "end")
        .attr("y", h / 2 - 14);
      ["Lookalikes**", `(${K} closest`, "Kaggle patients)"].forEach((line, i) => label.append("tspan")
        .attr("x", -8).attr("dy", i === 0 ? "0.35em" : "1.2em").text(line));

      // Quarterly ticks for the full timeline; finer ticks (with the day) when zoomed in.
      const span = (x.domain()[1] - x.domain()[0]) / DAY;
      const ticks = span > 540
        ? x.ticks(d3.utcMonth.every(3)).filter(d => [0, 3, 6, 9].includes(d.getUTCMonth()))
        : x.ticks(10);
      const xAxis = g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
        .call(d3.axisBottom(x).tickValues(ticks).tickFormat(d3.utcFormat(span > 120 ? "%b" : "%b %d")).tickSizeOuter(0));
      xAxis.selectAll(".tick text").append("tspan")
        .attr("x", 0).attr("dy", "1.2em").text(d => d3.utcFormat("%Y")(d));

      // One legend for both strips: the lookalikes' hyper / normal / hypo use the matching status colors.
      const keys = Object.keys(STATUS_COLORS);
      const itemW = 130;
      const legend = g.append("g").attr("class", "legend")
        .attr("transform", `translate(${(innerW - keys.length * itemW) / 2},${h + 46})`);
      const item = legend.selectAll("g").data(keys).join("g")
        .attr("transform", (_, i) => `translate(${i * itemW},0)`);
      item.append("rect").attr("width", 12).attr("height", 12).attr("rx", 2)
        .attr("fill", k => STATUS_COLORS[k]).attr("fill-opacity", 0.75);
      item.append("text").attr("x", 18).attr("y", 6).attr("dy", "0.35em").text(k => k.replace("_", " "));
    }

    // Hover: a vertical line through every panel at the cursor. Click to leave a marker there.
    const readout = d3.select("#dose-readout");
    const hint = "Hover to compare draws; click a data point to read the journal; drag to zoom";
    const fmtDate = d3.utcFormat("%b %d, %Y");
    const guide = (dash, width) => tops.map((t, i) => root.append("line")
      .attr("y1", t).attr("y2", t + heights[i])
      .attr("stroke", INK).attr("stroke-width", width).attr("stroke-opacity", 0.7)
      .attr("stroke-dasharray", dash)
      .attr("pointer-events", "none").style("visibility", "hidden"));
    const vlines = guide(null, 1);
    const markers = guide("4 3", 1.5);
    const nearestDraw = t => draws[d3.minIndex(draws, v => Math.abs(v.date - t))];
    // The draw whose data point is under the cursor (within a few pixels), if any.
    const drawAt = (px, py) => {
      const near = points.filter(p => p.cx >= 0 && p.cx <= innerW && Math.hypot(p.cx - px, p.cy - py) <= 8);
      return near.length ? near[d3.minIndex(near, p => Math.hypot(p.cx - px, p.cy - py))].draw : null;
    };

    const describe = d => {
      const vals = LABS.map(lab => {
        const r = series[lab].find(v => v.draw_id === d.id);
        if (!r) return `${LAB_NAMES[lab]} –`;
        return `${LAB_NAMES[lab]} ${r.censored ? "<0.01" : d3.format("~g")(r.value)} ${HOVER_UNITS[lab]}`;
      });
      const dose = d.dose_mg === null ? "n/a" : `${d3.format("~g")(d.dose_mg)} mg/day`;
      const look = lookalikes.find(l => +l.start === +d.date);
      const lookText = look
        ? LOOKALIKE_GROUPS.filter(grp => look[grp] > 0).map(grp => `${d3.format(".0%")(look[grp])} ${grp}`).join(", ")
        : "n/a (no T3 that day)";
      return `<strong>${fmtDate(d.date)}</strong> &nbsp; ${dose} &nbsp; ${d.status.replace("_", " ")}<br>${vals.join(" &nbsp; ")}`
        + `<br>${K} closest Kaggle patients: ${lookText}`;
    };

    const showPinned = () => {
      const onScreen = pinned && x(pinned) >= 0 && x(pinned) <= innerW;
      markers.forEach(l => l.attr("x1", x(pinned)).attr("x2", x(pinned))
        .style("visibility", onScreen ? "visible" : "hidden"));
      if (onScreen) readout.html(describe(nearestDraw(pinned)));
      else readout.text(hint);
      d3.select("#dose-reset").property("disabled", !zoom && !pinned);
    };
    showPinned();

    // Drag selection shown while zooming.
    const plotTop = margin.top, plotH = tops[last] + heights[last] - margin.top;
    const selection = root.append("rect")
      .attr("y", plotTop).attr("height", plotH)
      .attr("fill", INK).attr("fill-opacity", 0.08).attr("stroke", INK2).attr("stroke-opacity", 0.4)
      .attr("pointer-events", "none").style("visibility", "hidden");

    let current = null, dragStart = null;
    const pointerX = event => Math.max(0, Math.min(innerW, d3.pointer(event, root.node())[0]));
    root.append("rect")
      .attr("y", plotTop).attr("width", innerW).attr("height", plotH)
      .attr("fill", "transparent").style("cursor", "crosshair")
      .on("pointerdown", event => {
        dragStart = pointerX(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      })
      .on("pointermove", event => {
        // The line follows the cursor; the readout shows the nearest draw.
        const px = pointerX(event);
        vlines.forEach(l => l.attr("x1", px).attr("x2", px).style("visibility", "visible"));
        if (dragStart !== null && Math.abs(px - dragStart) > 5) {
          selection.attr("x", Math.min(px, dragStart)).attr("width", Math.abs(px - dragStart))
            .style("visibility", "visible");
        }
        const py = d3.pointer(event, root.node())[1];
        d3.select(event.currentTarget).style("cursor", drawAt(px, py) ? "pointer" : "crosshair");
        const d = nearestDraw(x.invert(px));
        if (d === current) return;
        current = d;
        readout.html(describe(d));
      })
      .on("pointerup", event => {
        if (dragStart === null) return;
        const px = pointerX(event), start = dragStart;
        dragStart = null;
        selection.style("visibility", "hidden");
        if (Math.abs(px - start) > 5) {
          // Dragged: zoom to the selected range (at least a week).
          let [a, b] = [x.invert(Math.min(px, start)), x.invert(Math.max(px, start))];
          if (b - a < 7 * DAY) b = new Date(+a + 7 * DAY);
          zoom = [a, b];
          render();
          return;
        }
        // Clicked: a data point pins its draw and opens its journal entry (clicking the pinned
        // draw again closes it). Anywhere else leaves a marker; clicking the marker removes it.
        const d = drawAt(px, d3.pointer(event, root.node())[1]);
        if (d) pinned = pinned && +pinned === +d.date ? null : d.date;
        else if (pinned && Math.abs(x(pinned) - px) < 6) pinned = null;
        else pinned = x.invert(px);
        showJournal(pinned && d ? d : null);
        showPinned();
        current = null;
      })
      .on("dblclick", () => { if (zoom) { zoom = null; render(); } })
      .on("pointerleave", () => {
        current = null;
        vlines.forEach(l => l.style("visibility", "hidden"));
        showPinned();
      });
  }

  // All biomarkers: one small chart per test on a shared time axis, in a fixed order
  // (thyroid first, then by group, then test).
  const bio = allLabs
    .map(d => ({
      date: parseDate(d.date), group: d.group, test: d.test, unit: d.unit, censor: d.censor,
      value: +d.value,
      lo: d.ref_low !== "" ? +d.ref_low : d.ref_high !== "" ? 0 : null,  // upper limit only: measured from zero
      hi: d.ref_high !== "" ? +d.ref_high : null,
    }));
  const tests = d3.groups(bio, d => d.test)
    .map(([test, rows]) => ({ test, group: rows[0].group, unit: rows[0].unit, rows: rows.sort((a, b) => a.date - b.date) }))
    .sort((a, b) => d3.ascending(a.group !== "Thyroid", b.group !== "Thyroid") || d3.ascending(a.group, b.group) || d3.ascending(a.test, b.test));
  const bioDates = [...new Set(bio.map(d => +d.date))].sort((a, b) => a - b).map(t => new Date(t));
  const onDose = known.filter(d => d.dose_mg > 0);
  // On a draw date, use the dose taken at that draw (as the other views do); spans start on the
  // day of the change, so a span lookup alone would report the next dose (or n/a after the last draw).
  const doseOn = t => {
    const draw = draws.find(d => +d.date === +t);
    if (draw) return draw.dose_mg;
    const span = known.find(d => d.start <= t && t < d.end);
    return span ? span.dose_mg : null;
  };
  const fmtValue = d => `${d.censor || ""}${d3.format("~g")(d.value)}`;

  // Group dropdown for the All Markers view (thyroid included, listed first).
  let group = "All";
  // All Markers has its own zoom: it covers 2017 on, while the other views start at the first thyroid draw.
  let allZoom = null;
  d3.select("#marker-group").selectAll("option")
    .data(["All", ...new Set(tests.map(t => t.group))]).join("option")
    .attr("value", d => d).text(d => d === "All" ? "All groups" : d);
  d3.select("#marker-group").on("change", function () { group = this.value; render(); });

  function renderAll() {
    // Any single group other than Thyroid gets TSH, Free T4 and T3 as its first row, for comparison.
    const thyroid = group === "All" || group === "Thyroid" ? []
      : ["TSH", "Free T4", "T3 Total"].map(name => tests.find(t => t.test === name)).filter(Boolean);
    const shown = [...thyroid, ...(group === "All" ? tests : tests.filter(t => t.group === group))];
    // Hover snaps to the dates this group was actually tested.
    const dates = [...new Set(shown.flatMap(t => t.rows.map(d => +d.date)))].sort((a, b) => a - b).map(t => new Date(t));
    d3.select("#dose-title").text(group === "All" ? "All biomarkers over time" : `${group} over time`);

    // A single group gets bigger charts, at most 4 across; "All groups" stays 5 across to fit everything.
    const width = 1300, cols = group === "All" ? 5 : 4, gapX = 22, gapY = 14, top = 30;
    const cellW = (width - gapX * (cols - 1)) / cols, cellH = group === "All" ? 118 : 150;
    const pad = { top: 20, right: 6, bottom: 18, left: 34 };
    const plotW = cellW - pad.left - pad.right, plotH = cellH - pad.top - pad.bottom;
    // The group's own charts start on a new row after the thyroid row.
    const slot = i => i < thyroid.length ? i : i + (thyroid.length ? cols - thyroid.length : 0);
    const rows = Math.floor(slot(shown.length - 1) / cols) + 1;
    const height = top + rows * cellH + (rows - 1) * gapY + 8;

    const x = d3.scaleUtc()
      .domain(allZoom || [d3.utcYear.floor(bioDates[0]), d3.utcYear.ceil(bioDates.at(-1))])
      .range([0, plotW]);
    const spanDays = (x.domain()[1] - x.domain()[0]) / DAY;
    const xAxis = allZoom
      ? d3.axisBottom(x).ticks(4).tickFormat(d3.utcFormat(spanDays > 730 ? "%Y" : spanDays > 120 ? "%b '%y" : "%b %d"))
      : d3.axisBottom(x).ticks(d3.utcYear.every(3)).tickFormat(d3.utcFormat("%Y"));

    d3.select("#dose-chart").html("");
    const svg = d3.select("#dose-chart").append("svg")
      .attr("viewBox", [-10, 0, width + 10, height])  // room on the left for the thyroid box outline
      .attr("role", "img")
      .attr("aria-label", "Every lab test over time, one small chart per test");
    // Every chart has the same plot size, so one clip path serves them all.
    svg.append("clipPath").attr("id", "all-clip").append("rect").attr("width", plotW).attr("height", plotH);

    // Key for the shading.
    const key = svg.append("g").attr("class", "legend").attr("transform", "translate(0,6)");
    key.append("rect").attr("width", 14).attr("height", 12).attr("fill", BLUE).attr("fill-opacity", 0.12);
    key.append("text").attr("x", 20).attr("y", 6).attr("dy", "0.35em").text("on methimazole");
    key.append("rect").attr("x", 130).attr("width", 14).attr("height", 12).attr("fill", REF_GREEN).attr("fill-opacity", 0.3);
    key.append("text").attr("x", 150).attr("y", 6).attr("dy", "0.35em").text("reference range");
    key.append("circle").attr("cx", 272).attr("cy", 6).attr("r", 4).attr("fill", SURFACE).attr("stroke", BLUE).attr("stroke-width", 1.5);
    key.append("text").attr("x", 282).attr("y", 6).attr("dy", "0.35em").text("reported as a limit (e.g. >60)");

    // Outlined box around the thyroid comparison row, labelled in the empty space beside it.
    if (thyroid.length) {
      const rowW = thyroid.length * cellW + (thyroid.length - 1) * gapX;
      svg.append("rect").attr("x", -8).attr("y", top - 6).attr("width", rowW + 16).attr("height", cellH + 10)
        .attr("rx", 6).attr("fill", "none").attr("stroke", "#e6c440").attr("stroke-width", 1.5);  // soft yellow outline
      const note = svg.append("text").attr("class", "panel-label")
        .attr("x", rowW + 28).attr("y", top + cellH / 2 - 8);
      note.append("tspan").attr("font-weight", 600).attr("fill", INK).text("Thyroid levels");
      note.append("tspan").attr("x", rowW + 28).attr("dy", "1.4em").text(`shown alongside ${group.toLowerCase()} for comparison`);
    }

    const cells = svg.selectAll("g.cell").data(shown).join("g")
      .attr("class", "cell")
      .attr("transform", (_, i) => `translate(${(slot(i) % cols) * (cellW + gapX) + pad.left},${top + Math.floor(slot(i) / cols) * (cellH + gapY) + pad.top})`);

    const hoverLines = [], hoverLabels = [], markers = [], selections = [];
    let dragStart = null;
    const pointerX = event => Math.max(0, Math.min(plotW, d3.pointer(event)[0]));
    cells.each(function (t) {
      const g = d3.select(this);
      const withRef = t.rows.filter(d => d.hi !== null);
      const ref = withRef.length ? withRef.at(-1) : null;  // the latest reference range
      const ext = d3.extent([...t.rows.map(d => d.value), ...(ref ? [ref.lo, ref.hi] : [])]);
      const span = ext[1] - ext[0] || Math.abs(ext[0]) || 1;
      const yLo = ext[0] - span * 0.15;
      const y = d3.scaleLinear().domain([ext[0] >= 0 ? Math.max(0, yLo) : yLo, ext[1] + span * 0.15]).range([plotH, 0]).nice(3);

      // Long names are shortened with an ellipsis to leave room for the hover value; the full name is in the tooltip.
      const title = g.append("text").attr("class", "cell-title").attr("x", -pad.left).attr("y", -8);
      const name = title.append("tspan").text(t.test);
      title.append("tspan").attr("class", "cell-unit").text(t.unit ? `  ${t.unit}` : "");
      title.append("title").text(t.unit ? `${t.test} (${t.unit})` : t.test);
      for (let n = t.test.length; title.node().getComputedTextLength() > cellW - 50 && n > 4; n--) {
        name.text(t.test.slice(0, n - 1).trimEnd() + "…");
      }

      const plot = g.append("g").attr("clip-path", "url(#all-clip)");
      plot.selectAll("rect.dose").data(onDose).join("rect").attr("class", "dose")
        .attr("x", d => x(d.start)).attr("width", d => x(d.end) - x(d.start))
        .attr("height", plotH).attr("fill", BLUE).attr("fill-opacity", 0.12);
      if (ref) {
        g.append("rect").attr("width", plotW)
          .attr("y", y(Math.min(ref.hi, y.domain()[1]))).attr("height", y(Math.max(ref.lo, y.domain()[0])) - y(Math.min(ref.hi, y.domain()[1])))
          .attr("fill", REF_GREEN).attr("fill-opacity", 0.3);
      }
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(3).tickSize(-plotW).tickFormat(""));
      // Lines and points go in a second clipped group so they draw above the band and grid.
      const marks = g.append("g").attr("clip-path", "url(#all-clip)");
      marks.append("path").datum(t.rows)
        .attr("fill", "none").attr("stroke", BLUE).attr("stroke-width", 2)
        .attr("d", d3.line().x(d => x(d.date)).y(d => y(d.value)));
      marks.selectAll("circle").data(t.rows).join("circle")
        .attr("cx", d => x(d.date)).attr("cy", d => y(d.value)).attr("r", 3.5)
        .attr("fill", d => d.censor ? SURFACE : BLUE)
        .attr("stroke", d => d.censor ? BLUE : SURFACE).attr("stroke-width", 1.5);
      g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(3).tickFormat(v => d3.format(Math.abs(v) >= 1000 ? "~s" : "~g")(v)).tickSizeOuter(0));
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${plotH})`)
        .call(xAxis.tickSizeOuter(0));

      hoverLines.push(g.append("line").attr("y2", plotH)
        .attr("stroke", INK).attr("stroke-opacity", 0.7).attr("pointer-events", "none").style("visibility", "hidden"));
      selections.push(g.append("rect").attr("height", plotH)
        .attr("fill", INK).attr("fill-opacity", 0.08).attr("stroke", INK2).attr("stroke-opacity", 0.4)
        .attr("pointer-events", "none").style("visibility", "hidden"));
      markers.push(g.append("line").attr("y2", plotH)
        .attr("stroke", INK).attr("stroke-width", 1.5).attr("stroke-opacity", 0.7).attr("stroke-dasharray", "4 3")
        .attr("pointer-events", "none").style("visibility", "hidden"));
      hoverLabels.push(g.append("text").attr("class", "cell-value").attr("x", plotW).attr("y", -8)
        .attr("text-anchor", "end").attr("pointer-events", "none"));

      // Hover anywhere in a small chart: the line follows the cursor in every chart, and each
      // chart shows its result from the nearest test date (blank if that test wasn't run then).
      g.append("rect").attr("width", plotW).attr("height", plotH).attr("fill", "transparent")
        .style("cursor", "crosshair")
        .on("pointerdown", event => {
          dragStart = pointerX(event);
          event.currentTarget.setPointerCapture(event.pointerId);
        })
        .on("pointermove", event => {
          const px = pointerX(event);
          hoverLines.forEach(l => l.attr("x1", px).attr("x2", px).style("visibility", "visible"));
          if (dragStart !== null && Math.abs(px - dragStart) > 5) {
            selections.forEach(r => r.attr("x", Math.min(px, dragStart)).attr("width", Math.abs(px - dragStart))
              .style("visibility", "visible"));
          }
          showDay(snap(px));
        })
        .on("pointerup", event => {
          if (dragStart === null) return;
          const px = pointerX(event), start = dragStart;
          dragStart = null;
          selections.forEach(r => r.style("visibility", "hidden"));
          if (Math.abs(px - start) > 5) {
            // Dragged: zoom every chart to the selected range (at least a week).
            let [a, b] = [x.invert(Math.min(px, start)), x.invert(Math.max(px, start))];
            if (b - a < 7 * DAY) b = new Date(+a + 7 * DAY);
            allZoom = [a, b];
            render();
            return;
          }
          // Clicked: drop a marker where you click (on the test date if you click within 8px
          // of one); clicking the marker again removes it.
          const day = snap(px);
          if (pinned && Math.abs(x(pinned) - px) < 6) pinned = null;
          else pinned = Math.abs(x(day) - px) <= 8 ? day : x.invert(px);
          showPinned();
        })
        .on("dblclick", () => { if (allZoom) { allZoom = null; render(); } })
        .on("pointerleave", () => {
          hoverLines.forEach(l => l.style("visibility", "hidden"));
          showPinned();
        });
    });

    const readout = d3.select("#dose-readout");
    const fmtDate = d3.utcFormat("%b %d, %Y");
    const allHint = "Hover to see every result from the nearest test date; click to leave a marker; drag to zoom";
    const nearest = t => dates[d3.minIndex(dates, d => Math.abs(d - t))];
    const snap = px => nearest(x.invert(px));

    // Each chart's value label shows its result on that day (blank if the test wasn't run then).
    function showDay(day) {
      shown.forEach((tt, i) => {
        const r = tt.rows.find(d => +d.date === +day);
        hoverLabels[i].text(r ? fmtValue(r) : "");
      });
      const mg = doseOn(day);
      readout.html(`<strong>${fmtDate(day)}</strong> &nbsp; methimazole: ${mg === null ? "n/a" : `${d3.format("~g")(mg)} mg/day`}`);
    }

    // The marker is shared with the other views, so one set there shows here too.
    function showPinned() {
      const onScreen = pinned && x(pinned) >= 0 && x(pinned) <= plotW;
      markers.forEach(l => l.attr("x1", onScreen ? x(pinned) : 0).attr("x2", onScreen ? x(pinned) : 0)
        .style("visibility", onScreen ? "visible" : "hidden"));
      if (pinned) showDay(nearest(pinned));
      else {
        hoverLabels.forEach(l => l.text(""));
        readout.text(allHint);
      }
      d3.select("#dose-reset").property("disabled", !allZoom && !pinned);
    }
    showPinned();
  }
}
