function parseDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function isPageDict(dict) {
  return /\/Type\s*\/Page\b/.test(dict) && !/\/Type\s*\/Pages\b/.test(dict);
}

function readDuration(dict) {
  const match = /\/Dur\s+([-+]?\d+(?:\.\d+)?)/.exec(dict);
  return match ? parseDuration(match[1]) : null;
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Collect /Dur of every page object, keyed by object number. Page dicts may
 * be top-level objects or packed inside FlateDecode object streams (PDF 1.5+,
 * the pdflatex default), so both are scanned.
 */
async function collectDurations(data) {
  const decoder = new TextDecoder("latin1");
  const text = decoder.decode(data);
  const durations = new Map();
  const objectStreams = [];
  const headerPattern = /\b(\d+)\s+\d+\s+obj\b/g;
  let match;
  while ((match = headerPattern.exec(text))) {
    const start = headerPattern.lastIndex;
    const endobj = text.indexOf("endobj", start);
    if (endobj < 0) break;
    const streamAt = text.indexOf("stream", start);
    if (streamAt < 0 || streamAt > endobj) {
      const dict = text.slice(start, endobj);
      if (isPageDict(dict)) durations.set(Number(match[1]), readDuration(dict));
      headerPattern.lastIndex = endobj;
      continue;
    }
    // Skip binary stream data by /Length so stray "endobj" bytes can't split it.
    const dict = text.slice(start, streamAt);
    let dataStart = streamAt + "stream".length;
    if (text[dataStart] === "\r") dataStart += 1;
    if (text[dataStart] === "\n") dataStart += 1;
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const dataEnd = length ? dataStart + Number(length[1]) : text.indexOf("endstream", dataStart);
    if (dataEnd < dataStart) break;
    if (
      /\/Type\s*\/ObjStm\b/.test(dict) &&
      /\/Filter\s*\/FlateDecode\b/.test(dict) &&
      !/\/DecodeParms\b/.test(dict)
    ) {
      objectStreams.push({ dict, bytes: data.subarray(dataStart, dataEnd) });
    }
    headerPattern.lastIndex = dataEnd;
  }

  for (const { dict, bytes } of objectStreams) {
    const count = Number(/\/N\s+(\d+)/.exec(dict)?.[1]);
    const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1]);
    if (!count || !Number.isFinite(first)) continue;
    let content;
    try {
      content = decoder.decode(await inflate(bytes));
    } catch {
      continue;
    }
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i++) {
      const objectNumber = header[2 * i];
      const from = first + header[2 * i + 1];
      const to = i + 1 < count ? first + header[2 * i + 3] : content.length;
      const object = content.slice(from, to);
      if (isPageDict(object)) durations.set(objectNumber, readDuration(object));
    }
  }
  return durations;
}

/**
 * PDF.js does not expose the page dictionary's /Dur entry through its public
 * page API. Beamer writes /Dur directly on page objects, so inspect the raw
 * bytes as a narrow compatibility adapter and leave rendering untouched.
 * Durations are matched to slides via each page's object reference.
 */
export async function readSlideDurations(pdf) {
  try {
    const byObject = await collectDurations(await pdf.getData());
    if (![...byObject.values()].some((value) => value !== null)) return [];
    const durations = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      durations.push(byObject.get(page.ref?.num) ?? null);
    }
    return durations;
  } catch {
    return [];
  }
}
