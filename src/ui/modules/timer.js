// Presenter timer subsystem. Supports count-up and count-down (with warn/danger
// colour bands), click-to-pause on the timer element itself, and a separate
// reset button. An optional slide timer counts up from the last resetSlide(),
// has its own reset button and shares the pause state. All state is private to the factory closure.

const TICK_INTERVAL_MS = 250;

export function createTimer({
  timerEl,
  resetBtnEl,
  countdownMs,
  slideTimerEl = null,
  slideResetBtnEl = null,
}) {
  let startedAt = Date.now();
  let slideStartedAt = startedAt;
  let pausedAt = null; // ms timestamp when paused, null while running

  function elapsedSince(start) {
    const base = pausedAt !== null ? pausedAt : Date.now();
    return base - start;
  }

  function reset() {
    startedAt = Date.now();
    // Reset leaves pause state untouched — a reset while paused starts
    // the next run-cycle from 00:00 but still paused.
    if (pausedAt !== null) {
      // Keep the slide timer's elapsed value across the pausedAt shift.
      slideStartedAt += startedAt - pausedAt;
      pausedAt = startedAt;
    }
    tick();
  }

  function resetSlide() {
    slideStartedAt = pausedAt !== null ? pausedAt : Date.now();
    tick();
  }

  function togglePause() {
    if (pausedAt === null) {
      pausedAt = Date.now();
    } else {
      // Shift startedAt forward by the pause duration so elapsed continues
      // from where we left off.
      const pauseMs = Date.now() - pausedAt;
      startedAt += pauseMs;
      slideStartedAt += pauseMs;
      pausedAt = null;
    }
    tick();
  }

  function formatMs(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function tick() {
    const ms = elapsedSince(startedAt);
    if (countdownMs !== null) {
      const remaining = countdownMs - ms;
      timerEl.textContent = formatMs(remaining >= 0 ? remaining : -remaining);
      timerEl.classList.remove("warn", "danger");
      if (remaining <= 60 * 1000) timerEl.classList.add("danger");
      else if (remaining <= 5 * 60 * 1000) timerEl.classList.add("warn");
    } else {
      timerEl.textContent = formatMs(ms);
    }
    timerEl.classList.toggle("paused", pausedAt !== null);
    if (slideTimerEl) {
      slideTimerEl.textContent = formatMs(elapsedSince(slideStartedAt));
      slideTimerEl.classList.toggle("paused", pausedAt !== null);
    }
  }

  timerEl.addEventListener("click", (ev) => {
    ev.preventDefault();
    togglePause();
    timerEl.blur();
  });
  resetBtnEl.addEventListener("click", (ev) => {
    ev.preventDefault();
    reset();
    resetBtnEl.blur();
  });
  slideResetBtnEl?.addEventListener("click", (ev) => {
    ev.preventDefault();
    resetSlide();
    slideResetBtnEl.blur();
  });

  setInterval(tick, TICK_INTERVAL_MS);
  tick();

  return { reset, togglePause, resetSlide };
}
