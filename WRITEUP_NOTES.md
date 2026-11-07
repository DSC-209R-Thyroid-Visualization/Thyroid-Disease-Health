
- Why the design looks the way it does (encodings, colors, the card layout).
- Rough people-hours for each of us, and what took the most time. Both are required and missing.

## Visual encodings

- Timeline: dose (step line, the dose holds until it changes), TSH (log scale, it spans below 0.01 to
  about 4 and moves in orders of magnitude), Total T3, and a status strip, all on one time axis.
- Green bands: UCSD reference ranges.
- The selected test is a larger dot, a dashed line across all rows, and an outlined status segment.
- Status colors: red overactive, orange slightly overactive, green normal, purple slightly
  underactive, blue underactive. The Kaggle bar on the card uses the same hues.
- Card: the journal entry, then the status, each lab as a bar with the normal range shaded and the
  value as a dot (red when out of range), then the share of the 50 nearest Kaggle patients diagnosed
  hyper / normal / hypo.

## Alternatives considered (checkpoint designs)

1. Timeline of dose and labs (Joel). Became the timeline beside the cards.
2. TSH ridgeline vs Kaggle groups (Joel).
3. Treatment comparison vs Kaggle pills / radioactive iodine / surgery (Priyanka). Dropped: a static
   chart says it all.
4. Kaggle lookalikes vs my status (Priyanka). Now the bar on each card.
5. Parallel sets to tumor / goitre (Joel). Interactive, but off the Graves story and hard to read.
6. TODO (Sanjana's design?)

Later drafts that were dropped: the six-panel timeline with Raw / Normalized / Overlay views (the
slides call view-switching "static charts with extra steps"), a scatter panel of the 50 lookalikes, and
a step-through story with a moving dot (the slides warn that stepping through time relies on memory).

## Development process (fill in)
- Joel: personal data collection and cleaning, scripts, prototypes 1, 2, 5, the first D3 page, story
  overlay, journal, All Markers, GitHub Pages workflow, write-up. Hours: TODO.
- Priyanka: prototypes 3 and 4, the lookalike method, the flashcard redesign, testing at laptop and
  phone sizes. Hours: TODO.
- Sanjana: TODO. Hours: TODO.
- What took the most time: TODO.
