// Update button: shown when the server reports a newer GitHub release and
// can install it (release install on this machine). The server answers
// /api/update only for requests from its own machine, so audience devices
// and remote presenters never see the button.

const RECHECK_MS = 60 * 60 * 1000;
const POLL_MS = 2000;

async function fetchStatus() {
  const response = await fetch("/api/update", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// `reloadUrl` is where to go once the new version runs (directory mode
// forgets the open PDF on restart, so the presenter returns to the list).
export function createUpdateButton(button, { reloadUrl = window.location.href } = {}) {
  if (!button) return;
  let installing = false;

  async function check() {
    if (installing) return;
    try {
      const status = await fetchStatus();
      const show = status.available && status.canUpdate;
      button.classList.toggle("hidden", !show);
      if (show) {
        button.textContent = `Update to v${status.latest}`;
        button.title = `Installed: v${status.current}. Installing restarts the server.`;
      }
    } catch {
      button.classList.add("hidden");
    }
  }

  // After the update the server exits and systemd restarts it; reload once
  // it answers with a different version.
  async function waitForRestart(previous) {
    try {
      const status = await fetchStatus();
      if (status.current !== previous) return window.location.replace(reloadUrl);
      if (status.state === "failed") {
        installing = false;
        button.disabled = false;
        button.textContent = "Update failed – retry";
        return;
      }
    } catch {
      // Server is restarting.
    }
    window.setTimeout(() => waitForRestart(previous), POLL_MS);
  }

  button.addEventListener("click", async () => {
    if (!window.confirm("Install the update now? The server restarts and the presentation is interrupted briefly.")) {
      return;
    }
    let previous;
    try {
      previous = (await fetchStatus()).current;
      const response = await fetch("/api/update", { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
    } catch (err) {
      button.textContent = "Update failed – retry";
      button.title = err instanceof Error ? err.message : String(err);
      return;
    }
    installing = true;
    button.disabled = true;
    button.textContent = "Updating…";
    waitForRestart(previous);
  });

  check();
  window.setInterval(check, RECHECK_MS);
}
