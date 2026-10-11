const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createSlideViewport({ viewport, content, canPan = () => true, onChange }) {
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  const pointers = new Map();
  let panPointerId = null;
  let pinchDistance = 0;
  let pinchScale = 1;
  let startX = 0;
  let startY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;

  function bounds() {
    const contentWidth = content.offsetWidth * scale;
    const contentHeight = content.offsetHeight * scale;
    return {
      x: Math.max(0, (contentWidth - viewport.clientWidth) / 2),
      y: Math.max(0, (contentHeight - viewport.clientHeight) / 2),
    };
  }

  function apply() {
    const limit = bounds();
    offsetX = clamp(offsetX, -limit.x, limit.x);
    offsetY = clamp(offsetY, -limit.y, limit.y);
    content.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    content.style.transformOrigin = "center center";
    viewport.classList.toggle("zoomed", scale > MIN_SCALE);
    onChange?.({ scale, offsetX, offsetY });
  }

  function zoomAt(nextScale, clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const pointX = clientX - rect.left - rect.width / 2;
    const pointY = clientY - rect.top - rect.height / 2;
    const ratio = nextScale / scale;
    offsetX = pointX - (pointX - offsetX) * ratio;
    offsetY = pointY - (pointY - offsetY) * ratio;
    scale = nextScale;
    apply();
  }

  function zoomIn() {
    const rect = viewport.getBoundingClientRect();
    zoomAt(clamp(scale + SCALE_STEP, MIN_SCALE, MAX_SCALE), rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function zoomOut() {
    const rect = viewport.getBoundingClientRect();
    zoomAt(clamp(scale - SCALE_STEP, MIN_SCALE, MAX_SCALE), rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function reset() {
    scale = MIN_SCALE;
    offsetX = 0;
    offsetY = 0;
    apply();
  }

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const nextScale = clamp(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_SCALE, MAX_SCALE);
    zoomAt(nextScale, event.clientX, event.clientY);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".slide-link")) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewport.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      const [first, second] = pointers.values();
      pinchDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      pinchScale = scale;
      panPointerId = null;
      event.preventDefault();
      return;
    }
    if (scale <= MIN_SCALE || !canPan(event)) return;
    panPointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startOffsetX = offsetX;
    startOffsetY = offsetY;
    event.preventDefault();
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const [first, second] = pointers.values();
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      zoomAt(clamp(pinchScale * distance / pinchDistance, MIN_SCALE, MAX_SCALE), centerX, centerY);
      event.preventDefault();
      return;
    }
    if (event.pointerId !== panPointerId) return;
    offsetX = startOffsetX + event.clientX - startX;
    offsetY = startOffsetY + event.clientY - startY;
    apply();
    event.preventDefault();
  });

  function endPointer(event) {
    pointers.delete(event.pointerId);
    viewport.releasePointerCapture?.(event.pointerId);
    if (event.pointerId === panPointerId) panPointerId = null;
    if (pointers.size < 2) pinchDistance = 0;
  }
  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", endPointer);

  return { zoomIn, zoomOut, reset, resize: apply, getScale: () => scale };
}