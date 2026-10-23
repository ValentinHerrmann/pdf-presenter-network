/** @typedef {{ pdfName: string; hasNotes: boolean; filledCount: number; totalSlides: number; source?: string }} PdfStatus */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function readConfig() {
  const el = document.getElementById("pdf-presenter-config");
  return el ? JSON.parse(el.textContent) : {};
}

/** @param {PdfStatus} s */
function badgeHtml(s) {
  if (!s.hasNotes) return `<span class="badge badge-none">No notes</span>`;
  if (s.filledCount === 0) return `<span class="badge badge-empty">Empty template</span>`;
  if (s.filledCount >= s.totalSlides) return `<span class="badge badge-ready">Ready</span>`;
  return `<span class="badge badge-partial">${s.filledCount}/${s.totalSlides}</span>`;
}

/** @param {PdfStatus} s */
function cardHtml(s) {
  const encoded = encodeURIComponent(s.pdfName);
  const slides = s.totalSlides > 0 ? `<span class="slide-count">${s.totalSlides} slides</span>` : "";
  // Linked PDFs (`.url` files) show the link target; Open fetches the latest version first.
  const name = s.source ? s.pdfName.replace(/\.url$/i, "") : s.pdfName;
  const title = s.source
    ? `<span class="pdf-title">
      <span class="pdf-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      <a class="pdf-source" href="${escapeHtml(s.source)}" target="_blank" rel="noopener" title="${escapeHtml(s.source)}">${escapeHtml(s.source)}</a>
    </span>
    <span class="badge badge-link">Link</span>`
    : `<span class="pdf-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
  const remove = s.source
    ? `<button type="button" class="btn btn-remove" data-remove="${escapeHtml(s.pdfName)}" title="Remove this link from the list">Remove</button>`
    : "";
  return `<div class="pdf-card">
    ${title}
    ${badgeHtml(s)}
    ${slides}
    <span class="actions">
      <a class="btn btn-primary" href="/pdf/${encoded}/presenter"${s.source ? ` data-link="${escapeHtml(s.pdfName)}"` : ""}>Open</a>
      <a class="btn" href="/pdf/${encoded}/">Audience</a>
      ${remove}
    </span>
  </div>`;
}

export async function initListing() {
  const config = readConfig();
  const dirEl = document.getElementById("dir-path");
  if (dirEl && config.dirName) dirEl.textContent = config.dirName;

  const openButton = document.getElementById("open-pdf");
  const openInput = document.getElementById("open-pdf-input");
  openButton?.addEventListener("click", () => openInput?.click());
  openInput?.addEventListener("change", async () => {
    const file = openInput.files?.[0];
    if (!file) return;
    openButton.disabled = true;
    openButton.textContent = "Opening...";
    try {
      const response = await fetch("/api/open", {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          "X-PDF-Name": file.name,
        },
        body: file,
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      window.location.href = result.presenterUrl;
    } catch (err) {
      openButton.disabled = false;
      openButton.textContent = "Open PDF";
      alert(`Could not open PDF: ${err.message}`);
    }
    openInput.value = "";
  });

  initAddUrl();

  const listEl = document.getElementById("list");
  listEl.addEventListener("click", (event) => {
    const removeButton = event.target.closest("button[data-remove]");
    if (removeButton) return removeLink(removeButton);
    const button = event.target.closest("a[data-link]");
    if (!button) return;
    event.preventDefault();
    openLinked(button);
  });
  try {
    const res = await fetch("/api/listing");
    /** @type {PdfStatus[]} */
    const pdfs = await res.json();
    if (pdfs.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No PDF files found in this directory.</div>`;
      return;
    }
    listEl.innerHTML = pdfs.map(cardHtml).join("");
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Failed to load listing: ${err.message}</div>`;
  }
}

// Fetches the latest version of a linked PDF, then opens the presenter. When
// the site is unreachable the server offers its last cached copy.
async function openLinked(button) {
  const label = button.textContent;
  button.textContent = "Fetching...";
  button.style.pointerEvents = "none";
  try {
    const response = await fetch(`/api/links/fetch?name=${encodeURIComponent(button.dataset.link)}`, {
      method: "POST",
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    if (result.stale) {
      const date = new Date(result.fetchedAt).toLocaleString();
      if (!confirm(`Could not load the latest version (${result.error}).\n\nUse the copy from ${date}?`)) {
        return;
      }
    }
    window.location.href = button.href;
  } catch (err) {
    alert(`Could not open the linked PDF: ${err.message}`);
  } finally {
    button.textContent = label;
    button.style.pointerEvents = "";
  }
}

async function removeLink(button) {
  const name = button.dataset.remove;
  if (!confirm(`Remove "${name.replace(/\.url$/i, "")}" from the list?\n\nOnly the link is removed; the PDF on the website and your notes stay.`)) {
    return;
  }
  try {
    const response = await fetch(`/api/links?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await response.text());
    button.closest(".pdf-card")?.remove();
  } catch (err) {
    alert(`Could not remove the link: ${err.message}`);
  }
}

/**
 * Name suggestion from the URL's file name, e.g. ".../slides.pdf" → "slides".
 * If that name is already listed (many sites name every file alike), the
 * parent folder is prepended: "inf09_tabkalk – presentation_x". Without a
 * usable path the host is used.
 */
function defaultLinkName(value, takenNames) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .map((part) => part.replace(/\.pdf$/i, "").replace(/[\\/]/g, "-"));
  if (parts.length === 0) return url.hostname;
  const name = parts[parts.length - 1];
  if (!takenNames.has(name.toLowerCase()) || parts.length < 2) return name;
  return `${parts[parts.length - 2]} – ${name}`;
}

/** Lower-case names of all listed entries, without extension. */
function listedNames() {
  return new Set(
    [...document.querySelectorAll(".pdf-card .pdf-name")].map((el) =>
      el.textContent.replace(/\.pdf$/i, "").toLowerCase(),
    ),
  );
}

function initAddUrl() {
  const button = document.getElementById("add-url");
  const dialog = document.getElementById("add-url-dialog");
  const form = document.getElementById("add-url-form");
  const urlInput = document.getElementById("add-url-url");
  const nameInput = document.getElementById("add-url-name");
  const errorEl = document.getElementById("add-url-error");
  const submit = document.getElementById("add-url-submit");
  if (!button || !dialog) return;

  let nameEdited = false;
  button.addEventListener("click", () => {
    form.reset();
    errorEl.textContent = "";
    nameEdited = false;
    dialog.showModal();
  });
  document.getElementById("add-url-cancel").addEventListener("click", () => dialog.close());
  nameInput.addEventListener("input", () => (nameEdited = true));
  urlInput.addEventListener("input", () => {
    if (!nameEdited) nameInput.value = defaultLinkName(urlInput.value, listedNames());
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = "Loading...";
    errorEl.textContent = "";
    try {
      const response = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.value, url: urlInput.value }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      window.location.href = result.presenterUrl;
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = "Add";
    }
  });
}
