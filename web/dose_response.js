// "Beyond the thyroid": one small chart per lab test on a shared time axis, with the methimazole
// periods shaded. The thyroid timeline and cards above it are drawn by flashcards.js.

const SURFACE = "#fcfcfb", INK = "#0b0b0b", INK2 = "#52514e", MUTED = "#a3a29c";
// Same soft green as the flashcards, so "normal range" looks the same everywhere.
const REF_GREEN = "#1baf7a";
// Lines and the methimazole shading are grey; red and blue are kept for thyroid status only.
const LINE_GREY = "#b9b6ae", DOT_GREY = "#4a4945", DOSE_GREY = "#6f6d67";
// Out-of-range thyroid results take the color of the status they point to (same as the flashcards).
const STATUS_COLORS = { hyperthyroid: "#e34948", hypothyroid: "#2a78d6" };
// Thyroid tests: which way a high result points. TSH rises when the thyroid is underactive.
const THYROID_DIRECTION = { "TSH": "inverse", "Free T4": "direct", "T3 Total": "direct" };

const parseDate = d3.utcParse("%Y-%m-%d");
const DAY = 24 * 60 * 60 * 1000;

Promise.all([
  d3.json("../data/processed/personal.json"),
  d3.csv("../data/processed/all_labs.csv"),
]).then(([raw, allLabs]) => draw(raw, allLabs));

function draw(raw, allLabs) {
  const draws = raw.draws.map(d => ({ ...d, date: parseDate(d.date) }));
  const known = raw.dose_spans
    .filter(d => d.dose_mg !== null)
    .map(d => ({ ...d, start: parseDate(d.start), end: parseDate(d.end) }));

  // The clicked marker's date. Reset clears it and the zoom.
  let pinned = null;
  d3.select("#dose-reset").on("click", () => {
    allZoom = null;
    pinned = null;
    render();
  });

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
  // On a draw date, use the dose taken at that draw (as the flashcards do); spans start on the
  // day of the change, so a span lookup alone would report the next dose (or n/a after the last draw).
  const doseOn = t => {
    const draw = draws.find(d => +d.date === +t);
    if (draw) return draw.dose_mg;
    const span = known.find(d => d.start <= t && t < d.end);
    return span ? span.dose_mg : null;
  };
  const fmtValue = d => `${d.censor || ""}${d3.format("~g")(d.value)}`;

  // Group dropdown (thyroid included, listed first). It opens on a short list of
  // labs that changed while my thyroid was overactive, so the first view isn't all 73 tests at once.
  const HIGHLIGHT = "Highlights";
  const HIGHLIGHT_TESTS = ["Cholesterol", "LDL-Chol (Calc)", "Alkaline Phosphatase", "Creatinine"];
  const groupTitle = g => g === HIGHLIGHT ? "Labs that changed while my thyroid was overactive"
    : g === "All" ? "All biomarkers over time" : `${g} over time`;
  let group = HIGHLIGHT;
  // Zoomed time range; the charts cover 2017 on.
  let allZoom = null;
  d3.select("#marker-group").selectAll("option")
    .data([HIGHLIGHT, "All", ...new Set(tests.map(t => t.group))]).join("option")
    .attr("value", d => d).text(d => d === HIGHLIGHT ? "Labs that changed" : d === "All" ? "All groups" : d);
  d3.select("#marker-group").property("value", group);
  d3.select("#marker-group").on("change", function () { group = this.value; render(); });
  render();

  function render() {
    // Any single group other than Thyroid gets TSH, Free T4 and T3 as its first row, for comparison.
    const thyroid = group === "All" || group === "Thyroid" ? []
      : ["TSH", "Free T4", "T3 Total"].map(name => tests.find(t => t.test === name)).filter(Boolean);
    const own = group === "All" ? tests
      : group === HIGHLIGHT ? HIGHLIGHT_TESTS.map(name => tests.find(t => t.test === name)).filter(Boolean)
      : tests.filter(t => t.group === group);
    const shown = [...thyroid, ...own];
    // Hover snaps to the dates this group was actually tested.
    const dates = [...new Set(shown.flatMap(t => t.rows.map(d => +d.date)))].sort((a, b) => a - b).map(t => new Date(t));
    d3.select("#dose-title").text(groupTitle(group));

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
    // Lines and dots get a few pixels of room above and below, so a dot on the edge isn't cut in half.
    svg.append("clipPath").attr("id", "all-clip-marks").append("rect")
      .attr("y", -6).attr("width", plotW).attr("height", plotH + 12);

    // Key for the shading.
    const key = svg.append("g").attr("class", "legend").attr("transform", "translate(0,6)");
    key.append("rect").attr("width", 14).attr("height", 12).attr("fill", DOSE_GREY).attr("fill-opacity", 0.14);
    key.append("text").attr("x", 20).attr("y", 6).attr("dy", "0.35em").text("on methimazole");
    key.append("rect").attr("x", 130).attr("width", 14).attr("height", 12).attr("fill", REF_GREEN).attr("fill-opacity", 0.16);
    key.append("text").attr("x", 150).attr("y", 6).attr("dy", "0.35em").text("reference range");
    key.append("circle").attr("cx", 272).attr("cy", 6).attr("r", 4).attr("fill", SURFACE).attr("stroke", DOT_GREY).attr("stroke-width", 1.5);
    key.append("text").attr("x", 282).attr("y", 6).attr("dy", "0.35em").text("reported as a limit (e.g. >60)");

    // Outlined box around the thyroid comparison row, labelled in the empty space beside it.
    if (thyroid.length) {
      const rowW = thyroid.length * cellW + (thyroid.length - 1) * gapX;
      svg.append("rect").attr("x", -8).attr("y", top - 6).attr("width", rowW + 16).attr("height", cellH + 10)
        .attr("rx", 6).attr("fill", "none").attr("stroke", MUTED).attr("stroke-width", 1.5);  // grey outline: color is kept for thyroid status
      const note = svg.append("text").attr("class", "panel-label")
        .attr("x", rowW + 28).attr("y", top + cellH / 2 - 8);
      note.append("tspan").attr("font-weight", 600).attr("fill", INK).text("Thyroid levels");
      note.append("tspan").attr("x", rowW + 28).attr("dy", "1.4em").text(group === HIGHLIGHT ? "in the top row, for comparison" : `shown alongside ${group.toLowerCase()} for comparison`);
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
        .attr("height", plotH).attr("fill", DOSE_GREY).attr("fill-opacity", 0.14);
      if (ref) {
        g.append("rect").attr("width", plotW)
          .attr("y", y(Math.min(ref.hi, y.domain()[1]))).attr("height", y(Math.max(ref.lo, y.domain()[0])) - y(Math.min(ref.hi, y.domain()[1])))
          .attr("fill", REF_GREEN).attr("fill-opacity", 0.16);
      }
      g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(3).tickSize(-plotW).tickFormat(""));
      // Lines and points go in a second clipped group so they draw above the band and grid.
      const marks = g.append("g").attr("clip-path", "url(#all-clip-marks)");
      marks.append("path").datum(t.rows)
        .attr("fill", "none").attr("stroke", LINE_GREY).attr("stroke-width", 2)
        .attr("d", d3.line().x(d => x(d.date)).y(d => y(d.value)));
      // In-range results: small grey dots. Out of range: red or blue on the thyroid tests (the status they
      // point to), a larger black dot on every other test, where high or low says nothing about the thyroid.
      const dotColor = d => {
        if (d.hi === null || (d.value >= d.lo && d.value <= d.hi)) return null;
        const high = d.value > d.hi;
        if (!(t.test in THYROID_DIRECTION)) return INK;
        return (THYROID_DIRECTION[t.test] === "inverse" ? !high : high) ? STATUS_COLORS.hyperthyroid : STATUS_COLORS.hypothyroid;
      };
      marks.selectAll("circle").data(t.rows).join("circle")
        .attr("cx", d => x(d.date)).attr("cy", d => y(d.value)).attr("r", d => dotColor(d) ? 3.2 : 2.3)
        .attr("fill", d => d.censor ? SURFACE : dotColor(d) || DOT_GREY)
        .attr("stroke", d => d.censor ? dotColor(d) || DOT_GREY : SURFACE).attr("stroke-width", d => d.censor ? 1.2 : 1);
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
    d3.select("#dose-hint").text("Hover to see every result from the nearest test date. Click to drop a point-in-time marker. Select and drag a range to zoom in.");
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

    function showPinned() {
      const onScreen = pinned && x(pinned) >= 0 && x(pinned) <= plotW;
      markers.forEach(l => l.attr("x1", onScreen ? x(pinned) : 0).attr("x2", onScreen ? x(pinned) : 0)
        .style("visibility", onScreen ? "visible" : "hidden"));
      if (pinned) showDay(nearest(pinned));
      else {
        hoverLabels.forEach(l => l.text(""));
        readout.text("");
      }
      d3.select("#dose-reset").property("disabled", !allZoom && !pinned);
    }
    showPinned();
  }
}
