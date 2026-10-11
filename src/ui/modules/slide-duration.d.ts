export function readSlideDurations(pdf: {
  getData(): Promise<Uint8Array>;
}): Promise<Array<number | null>>;