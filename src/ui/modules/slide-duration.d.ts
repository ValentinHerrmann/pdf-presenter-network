export function readSlideDurations(pdf: {
  getData(): Promise<Uint8Array>;
  numPages: number;
  getPage(pageNumber: number): Promise<{ ref: { num: number; gen: number } | null }>;
}): Promise<Array<number | null>>;
