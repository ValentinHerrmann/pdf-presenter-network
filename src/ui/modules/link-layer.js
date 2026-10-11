function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pageNumberFromDestination(pdf, destination) {
  if (!destination) return Promise.resolve(null);
  if (typeof destination === "string") {
    return pdf.getDestination(destination).then((resolved) =>
      pageNumberFromDestination(pdf, resolved),
    );
  }
  if (!Array.isArray(destination) || destination.length === 0) {
    return Promise.resolve(null);
  }
  const pageRef = destination[0];
  if (typeof pageRef === "number") return Promise.resolve(pageRef + 1);
  return pdf
    .getPageIndex(pageRef)
    .then((index) => index + 1)
    .catch(() => null);
}

export function createLinkLayer({ pdf, canvas, layer, onNavigate }) {
  let renderId = 0;

  async function render(pageNumber) {
    const currentRender = ++renderId;
    layer.replaceChildren();
    if (!canvas || !layer || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;

    const page = await pdf.getPage(pageNumber);
    const annotations = await page.getAnnotations({ intent: "display" });
    if (currentRender !== renderId) return;

    const unscaled = page.getViewport({ scale: 1 });
    const scale = canvas.clientWidth / unscaled.width;
    const viewport = page.getViewport({ scale });

    for (const annotation of annotations) {
      if (annotation.subtype !== "Link" || !annotation.rect) continue;
      const [left, top, right, bottom] = viewport.convertToViewportRectangle(
        annotation.rect,
      );
      const link = document.createElement("a");
      link.className = "slide-link";
      link.style.left = `${clamp(Math.min(left, right), 0, canvas.clientWidth)}px`;
      link.style.top = `${clamp(Math.min(top, bottom), 0, canvas.clientHeight)}px`;
      link.style.width = `${clamp(Math.abs(right - left), 0, canvas.clientWidth)}px`;
      link.style.height = `${clamp(Math.abs(bottom - top), 0, canvas.clientHeight)}px`;
      link.href = annotation.url || "#";
      if (annotation.url) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.addEventListener("click", async (event) => {
        if (!annotation.dest) return;
        event.preventDefault();
        const target = await pageNumberFromDestination(pdf, annotation.dest);
        if (target) onNavigate(target);
      });
      layer.append(link);
    }
  }

  return { render };
}