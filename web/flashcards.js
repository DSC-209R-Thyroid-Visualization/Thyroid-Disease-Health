// "Could I tell how my thyroid was doing just by how I felt?"
// One card per blood draw: what I wrote in my journal that day next to what my labs said, each lab
// against its reference range, and what the 50 Kaggle patients with the closest TSH and T3 were
// diagnosed with. The timeline beside the card is the overview; clicking a draw opens its card.

(() => {
  const SURFACE = "#fcfcfb";
  const DOSE_COLOR = "#2a78d6";
  const LAB_COLORS = { TSH: "#7656D6", FT4: "#168aad", T3: "#C04A8B" };
  const STATUS_COLORS = {
    hyperthyroid: "#e34948", subclinical_hyper: "#eda100", euthyroid: "#1baf7a",
    subclinical_hypo: "#6250d6", hypothyroid: "#2a78d6",
  };
  const KAGGLE_COLORS = { hyper: "#e34948", normal: "#1baf7a", hypo: "#2a78d6" };
  // UCSD reference ranges, same as the rest of the page.
  const REF = { TSH: [0.27, 4.2], FT4: [0.93, 1.7], T3: [0.8, 2.0] };
  const LAB_ROWS = [
    { lab: "TSH", name: "TSH", unit: "mIU/L", log: true, max: 20 },
    { lab: "FT4", name: "Free T4", unit: "ng/dL", max: 4 },
    { lab: "T3", name: "Total T3", unit: "ng/mL", max: 4.5 },
  ];
  const STATUS_TEXT = {
    hyperthyroid: ["Overactive", "Free T4 or T3 was above the normal range."],
    subclinical_hyper: ["Slightly overactive", "TSH was below range, so my body was still getting too much thyroid hormone, even though Free T4 and T3 were in range."],
    euthyroid: ["Normal", "TSH, Free T4 and T3 were all in range."],
    subclinical_hypo: ["Slightly underactive", "TSH was above range, even though Free T4 and T3 were in range."],
    hypothyroid: ["Underactive", "Free T4 or T3 was below the normal range."],
  };

  const parseDate = d3.utcParse("%Y-%m-%d");
  const fmtLong = d3.utcFormat("%B %-d, %Y");
  const fmtShort = d3.utcFormat("%b %-d, %Y");
  const DAY = 864e5;

  Promise.all([
    d3.json("../data/processed/personal.json"),
    d3.json("../data/journal.json").catch(() => ({})),
    d3.json("../data/processed/lookalikes.json").catch(() => ({ draws: [] })),
  ]).then(([raw, journal, look]) => init(raw, journal, look));

  function init(raw, journal, look) {
    const kaggle = new Map(look.draws.map(d => [d.date, d]));
    const cards = raw.draws.map((d, i) => {
      const labs = {};
      raw.labs.filter(l => l.draw_id === d.id).forEach(l => { labs[l.lab] = l; });
      return {
        i, key: d.date, date: parseDate(d.date), status: d.status, dose: d.dose_mg,
        entry: journal[d.date] || "", labs, kaggle: kaggle.get(d.date) || null,
      };
    });
    const doseSpans = raw.dose_spans.filter(s => s.dose_mg != null)
      .map(s => ({ start: parseDate(s.start), end: parseDate(s.end), dose: s.dose_mg }));
    const series = lab => cards.filter(c => c.labs[lab]).map(c => ({ card: c, ...c.labs[lab] }));

    let current = 0;

    // ---------- timeline ----------
    const width = 800, margin = { top: 6, right: 14, bottom: 30, left: 118 };
    const rows = [
      { key: "dose", h: 64, label: ["Methimazole", "(mg/day)"] },
      { key: "TSH", h: 118, label: ["TSH", "(mIU/L)"] },
      { key: "FT4", h: 104, label: ["Free T4", "(ng/dL)"] },
      { key: "T3", h: 104, label: ["Total T3", "(ng/mL)"] },
      { key: "status", h: 26, label: ["My status"] },
    ];
    const gap = 14;
    let y0 = margin.top;
    rows.forEach(r => { r.top = y0; y0 += r.h + gap; });
    const height = y0 - gap + margin.bottom;
    const innerW = width - margin.left - margin.right;
    const xEnd = new Date(+cards.at(-1).date + 45 * DAY);
    const x = d3.scaleUtc().domain([new Date(+cards[0].date - 20 * DAY), xEnd]).range([0, innerW]);
    const rowH = k => rows.find(r => r.key === k).h;
    const yDose = d3.scaleLinear().domain([0, 12]).range([rowH("dose"), 0]);
    const yTsh = d3.scaleLog().domain([0.006, 8]).range([rowH("TSH"), 0]).clamp(true);
    const yFt4 = d3.scaleLinear().domain([0, 3.6]).range([rowH("FT4"), 0]);
    const yT3 = d3.scaleLinear().domain([0, 4.6]).range([rowH("T3"), 0]);

    const svg = d3.select("#fc-timeline").append("svg")
      .attr("viewBox", [0, 0, width, height])
      .attr("role", "img")
      .attr("aria-label", "Timeline of methimazole dose, TSH, Free T4, T3 and status for each blood draw. Click a draw to open its card.");
    const root = svg.append("g").attr("transform", `translate(${margin.left},0)`);
    const row = k => root.append("g").attr("transform", `translate(0,${rows.find(r => r.key === k).top})`);

    rows.forEach(r => {
      const t = root.append("text").attr("class", "fc-axis-label").attr("text-anchor", "end")
        .attr("x", -40).attr("y", r.top + r.h / 2 - (r.label.length - 1) * 7);
      r.label.forEach((line, i) => t.append("tspan").attr("x", -40).attr("dy", i ? "1.15em" : "0.35em").text(line));
    });

    // Dose.
    const gDose = row("dose");
    gDose.append("g").attr("class", "fc-axis").call(d3.axisLeft(yDose).tickValues([0, 5, 10]).tickSize(-innerW));
    const doseLine = doseSpans.flatMap(s => [[s.start, s.dose], [s.end, s.dose]]);
    gDose.append("path").datum(doseLine).attr("fill", DOSE_COLOR).attr("fill-opacity", 0.12)
      .attr("d", d3.area().x(d => x(d[0])).y0(yDose(0)).y1(d => yDose(d[1])));
    gDose.append("path").datum(doseLine).attr("fill", "none").attr("stroke", DOSE_COLOR).attr("stroke-width", 2)
      .attr("d", d3.line().x(d => x(d[0])).y(d => yDose(d[1])));

    // TSH, Free T4 and T3, each with its reference band.
    const labRow = (lab, y, ticks, fmt) => {
      const g = row(lab), [lo, hi] = REF[lab];
      g.append("rect").attr("x", 0).attr("width", innerW).attr("y", y(hi)).attr("height", y(lo) - y(hi))
        .attr("fill", STATUS_COLORS.euthyroid).attr("fill-opacity", 0.12);
      g.append("g").attr("class", "fc-axis").call(d3.axisLeft(y).tickValues(ticks).tickFormat(fmt).tickSize(-innerW));
      const pts = series(lab);
      g.append("path").datum(pts).attr("fill", "none").attr("stroke", LAB_COLORS[lab]).attr("stroke-width", 2)
        .attr("stroke-opacity", 0.55).attr("d", d3.line().x(d => x(d.card.date)).y(d => y(d.value)));
      return g.append("g").selectAll("circle").data(pts).join("circle")
        .attr("class", "fc-dot").attr("cx", d => x(d.card.date)).attr("cy", d => y(d.value)).attr("r", 5)
        .on("click", (_, d) => go(d.card.i))
        .call(s => s.append("title").text(d => `Blood test ${d.card.i + 1}: ${fmtShort(d.card.date)}`));
    };
    const tshDots = labRow("TSH", yTsh, [0.01, 0.1, 1, 4], v => v === 0.01 ? "<0.01" : d3.format("~g")(v));
    const ft4Dots = labRow("FT4", yFt4, [0, 1, 2, 3], d3.format("~g"));
    const t3Dots = labRow("T3", yT3, [0, 1, 2, 3, 4], d3.format("~g"));

    // Status strip: each draw's status runs until the next draw.
    const gStatus = row("status");
    const segs = gStatus.selectAll("g").data(cards).join("g").attr("class", "fc-seg").on("click", (_, c) => go(c.i));
    const segEnd = c => x(c.i < cards.length - 1 ? cards[c.i + 1].date : xEnd);
    segs.append("rect").attr("x", c => x(c.date)).attr("width", c => Math.max(1, segEnd(c) - x(c.date)))
      .attr("y", 0).attr("height", rows.at(-1).h).attr("stroke", SURFACE).attr("stroke-width", 1);
    segs.append("title").text(c => `Blood test ${c.i + 1}: ${fmtShort(c.date)}`);

    const xAxis = root.append("g").attr("class", "fc-axis fc-x")
      .attr("transform", `translate(0,${rows.at(-1).top + rows.at(-1).h + 6})`)
      .call(d3.axisBottom(x).ticks(d3.utcMonth.every(6)).tickFormat(d3.utcFormat("%b %Y")).tickSize(0));
    xAxis.select(".domain").remove();

    const marker = root.append("line").attr("class", "fc-marker")
      .attr("y1", rows[0].top - 2).attr("y2", rows.at(-1).top + rows.at(-1).h + 2);

    // ---------- card ----------
    const card = d3.select("#fc-card-body");
    d3.select("#fc-prev").on("click", () => go(current - 1));
    d3.select("#fc-next").on("click", () => go(current + 1));
    document.getElementById("flashcards").addEventListener("keydown", e => {
      if (e.target.closest("button, a, select, input")) return;
      if (e.key === "ArrowLeft") go(current - 1);
      if (e.key === "ArrowRight") go(current + 1);
    });

    go(0);

    function go(i) {
      if (i < 0 || i >= cards.length) return;
      current = i;
      fill(cards[i]);
      d3.select("#fc-prev").property("disabled", i === 0);
      d3.select("#fc-next").property("disabled", i === cards.length - 1);
      d3.select("#fc-count").text(`Blood test ${i + 1} of ${cards.length}`);
      updateTimeline();
    }

    function fill(c) {
      card.html("");
      card.append("h3").attr("class", "fc-date").text(fmtLong(c.date));
      card.append("p").attr("class", "fc-dose").text(doseText(c.dose));
      card.append("p").attr("class", "fc-label").text("How I felt");
      card.append("blockquote").attr("class", "fc-quote").text(c.entry || "No journal entry for this draw.");

      const [label, why] = STATUS_TEXT[c.status];
      card.append("p").attr("class", "fc-label").text("What my labs said");
      card.append("p").attr("class", "fc-badge").style("background", STATUS_COLORS[c.status]).text(label);
      card.append("p").attr("class", "fc-why").text(why);
      const gauges = card.append("div").attr("class", "fc-gauges");
      LAB_ROWS.forEach(r => gauge(gauges, r, c.labs[r.lab]));
      card.append("p").attr("class", "fc-note").text("Shaded = UCSD normal range");

      card.append("p").attr("class", "fc-label").text("50 Kaggle patients with labs like mine were diagnosed");
      if (c.kaggle) {
        const bar = card.append("div").attr("class", "fc-kaggle");
        ["hyper", "normal", "hypo"].filter(k => c.kaggle[k] > 0).forEach(k => bar.append("span")
          .style("flex", c.kaggle[k]).style("background", KAGGLE_COLORS[k])
          .attr("title", `${Math.round(c.kaggle[k] * 100)}% ${k}`)
          .text(c.kaggle[k] >= 0.2 ? `${Math.round(c.kaggle[k] * 100)}% ${k}` : ""));
      } else {
        card.append("p").attr("class", "fc-note").text("No T3 was measured this time, so there's no Kaggle comparison.");
      }
    }

    function gauge(parent, r, l) {
      const wrap = parent.append("div").attr("class", "fc-gauge");
      const head = wrap.append("div").attr("class", "fc-gauge-head");
      head.append("span").text(r.name);
      if (!l) {
        head.append("span").attr("class", "fc-gauge-val").text("not measured");
        return;
      }
      const shown = l.censored ? `<${l.value}` : d3.format("~g")(l.value);
      head.append("span").attr("class", "fc-gauge-val").text(`${shown} ${r.unit}`);
      const s = (r.log ? d3.scaleLog().domain([0.005, r.max]) : d3.scaleLinear().domain([0, r.max])).range([0, 100]).clamp(true);
      const [lo, hi] = REF[r.lab];
      const track = wrap.append("div").attr("class", "fc-track");
      track.append("span").attr("class", "fc-range").style("left", `${s(lo)}%`).style("width", `${s(hi) - s(lo)}%`);
      const out = l.value < lo || l.value > hi;
      track.append("span").attr("class", "fc-value").classed("out", out).style("left", `${s(l.value)}%`);
    }

    function updateTimeline() {
      [[tshDots, "TSH"], [ft4Dots, "FT4"], [t3Dots, "T3"]].forEach(([dots, lab]) => dots
        .attr("fill", LAB_COLORS[lab])
        .attr("stroke", SURFACE).attr("stroke-width", 1.5)
        .attr("r", d => d.card.i === current ? 7.5 : 5));
      segs.select("rect").attr("fill", c => STATUS_COLORS[c.status])
        .attr("fill-opacity", c => c.i === current ? 1 : 0.7);
      segs.classed("current", c => c.i === current);
      marker.attr("x1", x(cards[current].date)).attr("x2", x(cards[current].date));
    }

    function doseText(mg) {
      return mg > 0 ? `Methimazole: ${d3.format("~g")(mg)} mg a day` : "Not taking methimazole";
    }
  }
})();
