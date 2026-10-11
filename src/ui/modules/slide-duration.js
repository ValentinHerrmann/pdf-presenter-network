function parseDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

/**
 * PDF.js does not expose the page dictionary's /Dur entry through its public
 * page API. Beamer writes /Dur directly on page objects, so inspect the raw
 * bytes as a narrow compatibility adapter and leave rendering untouched.
 */
export async function readSlideDurations(pdf) {
  try {
    const data = await pdf.getData();
    const text = new TextDecoder("latin1").decode(data);
    const durations = [];
    const objectPattern = /\b\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
    let match;
    while ((match = objectPattern.exec(text))) {
      const object = match[1];
      if (!/\/Type\s*\/Page\b/.test(object) || /\/Type\s*\/Pages\b/.test(object)) {
        continue;
      }
      const durationMatch = /\/Dur\s+([-+]?\d+(?:\.\d+)?)/.exec(object);
      durations.push(durationMatch ? parseDuration(durationMatch[1]) : null);
    }
    return durations;
  } catch {
    return [];
  }
}