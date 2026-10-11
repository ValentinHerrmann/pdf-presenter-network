function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function pointFromEvent(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
}

function drawStroke(ctx, stroke, width, height) {
  if (!stroke.points?.length) return;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
  for (const point of stroke.points.slice(1)) {
    ctx.lineTo(point.x * width, point.y * height);
  }
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

export function createOverlay({
  canvas,
  overlay,
  interactive = false,
  getTool = () => "pen",
  getStrokes = () => [],
  onStroke = () => {},
  onErase = () => {},
  onLaser = () => {},
}) {
  const context = overlay.getContext("2d");
  let activeStroke = null;
  let laser = null;

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    overlay.width = Math.floor(width * dpr);
    overlay.height = Math.floor(height * dpr);
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function redraw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    for (const stroke of getStrokes()) drawStroke(context, stroke, width, height);
    if (laser) drawLaser(laser);
  }

  function drawLaser(point) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.beginPath();
    context.arc(point.x * width, point.y * height, 8, 0, Math.PI * 2);
    context.fillStyle = "rgba(255, 45, 45, 0.95)";
    context.shadowColor = "rgba(255, 45, 45, 0.8)";
    context.shadowBlur = 12;
    context.fill();
    context.shadowBlur = 0;
  }

  function setLaser(point) {
    laser = point && !point.hidden ? point : null;
    redraw();
  }

  function beginStroke(event) {
    if (getTool() === "laser") return;
    const point = pointFromEvent(event, canvas);
    if (!point) return;
    event.preventDefault();
    overlay.setPointerCapture?.(event.pointerId);
    if (getTool() === "eraser") {
      activeStroke = { erase: true, point };
      return;
    }
    activeStroke = {
      erase: false,
      stroke: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        points: [point],
        color: "#ff4f4f",
        width: 4,
      },
    };
    onStroke(activeStroke.stroke);
  }

  function moveStroke(event) {
    const point = pointFromEvent(event, canvas);
    if (!point) return;
    if (getTool() === "laser") {
      onLaser(point);
      return;
    }
    if (!activeStroke) return;
    event.preventDefault();
    if (activeStroke.erase) {
      activeStroke.point = point;
      const match = getStrokes().find((stroke) =>
        stroke.points.some(
          (candidate) =>
            Math.hypot(candidate.x - point.x, candidate.y - point.y) < 0.025,
        ),
      );
      if (match) onErase(match.id);
      return;
    }
    activeStroke.stroke.points.push(point);
    onStroke(activeStroke.stroke);
  }

  function endStroke(event) {
    if (!activeStroke) return;
    event.preventDefault();
    overlay.releasePointerCapture?.(event.pointerId);
    activeStroke = null;
  }

  function leave() {
    if (getTool() === "laser") onLaser({ hidden: true });
  }

  if (interactive) {
    overlay.addEventListener("pointerdown", beginStroke);
    overlay.addEventListener("pointermove", moveStroke);
    overlay.addEventListener("pointerup", endStroke);
    overlay.addEventListener("pointercancel", endStroke);
    overlay.addEventListener("pointerleave", leave);
  }

  return { resize, redraw, setLaser };
}