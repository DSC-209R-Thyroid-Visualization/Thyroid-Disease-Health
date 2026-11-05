// "Press play to read my journey": dims the page and fades the story in one paragraph at a time.
(() => {
  const story = document.getElementById("story");
  const play = document.getElementById("story-play");
  const close = story.querySelector(".story-close");
  const paragraphs = [...story.querySelectorAll(".story-text p")];
  const hint = story.querySelector(".story-hint");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timers = [];
  let hideTimer = null;

  // Each paragraph waits long enough to read the one before it.
  const readingTime = p => Math.max(1800, p.textContent.length * 30);

  const allShown = () => paragraphs.every(p => p.classList.contains("shown"));
  const show = p => {
    p.classList.add("shown");
    const done = allShown();
    hint.textContent = done ? "Click anywhere or press Esc to close" : "Click to skip ahead · Esc to close";
    hint.classList.toggle("done", done);
  };

  const showAll = () => {
    timers.forEach(clearTimeout);
    timers = [];
    paragraphs.forEach(show);
  };

  const open = () => {
    clearTimeout(hideTimer);
    story.hidden = false;
    document.body.style.overflow = "hidden";
    paragraphs.forEach(p => p.classList.remove("shown"));
    hint.textContent = "Click to skip ahead · Esc to close";
    hint.classList.remove("done");
    story.offsetHeight;  // apply the hidden state before fading in
    story.classList.add("open");
    close.focus();
    if (reduceMotion) return showAll();
    let delay = 600;
    paragraphs.forEach(p => {
      timers.push(setTimeout(() => show(p), delay));
      delay += readingTime(p);
    });
  };

  const shut = () => {
    timers.forEach(clearTimeout);
    timers = [];
    story.classList.remove("open");
    document.body.style.overflow = "";
    hideTimer = setTimeout(() => { story.hidden = true; }, reduceMotion ? 0 : 500);
    play.focus();
  };

  play.addEventListener("click", open);
  close.addEventListener("click", e => { e.stopPropagation(); shut(); });
  // A click skips to the end; once everything is showing, a click closes.
  story.addEventListener("click", () => {
    if (allShown()) shut();
    else showAll();
  });
  // Esc closes; Tab stays on the close button so focus can't wander behind the overlay.
  document.addEventListener("keydown", e => {
    if (story.hidden) return;
    if (e.key === "Escape") shut();
    else if (e.key === "Tab") { e.preventDefault(); close.focus(); }
  });
})();
