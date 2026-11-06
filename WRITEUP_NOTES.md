# Write-up notes (not published)

The page changed from the six-panel timeline to flashcards, so Joel's write-up (`#writeup` in
`web/index.html`) now describes controls that are gone: the Raw / Normalized / Overlay buttons, the
pulsing + callouts, and hovering the main chart. It needs updating, in our own words (the rubric marks
down AI-written write-ups). The rubric also asks for things it doesn't have yet:

- Why the design looks the way it does (encodings, colors, the card layout).
- Alternatives considered, with the reason each was dropped.
- Rough people-hours for each of us, and what took the most time. Both are required and missing.

The rest of this file is facts to draw on. Delete it before submitting if you don't want it in the repo.

## The question and why this design

- Title question: "Could I tell how my thyroid was doing just by how I felt?"
- The professor's test (week 7 slides): could the same information be shown just as well in a static
  plot? 17 journal entries of text, each with its labs and Kaggle comparison, can't fit on a static
  chart. The timeline is the overview and the card is detail on demand, the same pattern as the
  comment-vis award example (click a word, read the comments).
- One interaction idea, as the slides recommend, instead of a dashboard of controls.
- Examples where feeling and labs disagree: May 2024 "considerably better" but labs had overshot into
  hypo; Dec 2024 "I feel back to normal" but labs still slightly overactive; Jun 2025 ER visit for a
  suspected heart attack with normal labs; Apr 2026 "I think I'm finally stable", relapse a month later.
- A version where the reader guessed the result before seeing it was tried and dropped.

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

## Interactions

- Clicking any dot or status segment on the timeline opens that test's card.
- Previous / Next and the left/right arrow keys move between cards.
- Below: All Markers (every lab since 2017, by body system) kept from Joel's version.
- Play-the-story overlay at the top kept as the intro.

## Data transformations

- Status: each draw compared to UCSD reference ranges (TSH 0.27–4.2 mIU/L, Free T4 0.93–1.7 ng/dL,
  Total T3 0.8–2.0 ng/mL). Overactive covers hyperthyroid and subclinical hyper; underactive covers
  hypothyroid and subclinical hypo.
- Kaggle diagnosis groups from the first letter of `target`: A–D hyper, E–H hypo, `-` normal; other
  codes and ages over 100 dropped. Lookalikes: Euclidean distance on [log10 TSH, T3], each scaled by its
  standard deviation; 50 nearest (`scripts/prepare_lookalikes.py`). Kaggle T3 is in nmol/L.
- The two diagnosis draws (Jan 29 and Feb 1, 2024) are one card.
- Jun 1, 2025 has no T3, so that card has no Kaggle comparison.

## What the design obscures

- A Kaggle label is one diagnosis per patient, made with T4, symptoms and history.
- Kaggle patients were referred for thyroid testing, not the general population.
- The journal was written by Joel, sometimes after knowing the results.

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

## Before submitting

- Update the write-up to describe the flashcards.
- Repo Settings → Pages → Source should be "GitHub Actions"; check the latest Actions run is green and the site loads.
- Check the Kaggle link in the footer points to the dataset you used.
