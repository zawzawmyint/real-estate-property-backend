/** Keys identify public assets only. Private documents need a separate authorized store. */
export interface Storage {
  save(content: Buffer, extension: string): Promise<string>;
  delete(key: string): Promise<void>;
  resolveUrl(key: string): string;
}
