export interface IdempotencyStore {
  claim(key: string): Promise<boolean>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly claimed = new Set<string>();

  async claim(key: string) {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
}

export async function once<T>(store: IdempotencyStore, key: string, run: () => Promise<T>) {
  const claimed = await store.claim(key);
  if (!claimed) return { executed: false as const };
  return { executed: true as const, value: await run() };
}
