/** Access boundary (docs/98 §1.1, 92 §2-1): only registered owner ids may touch memory. */
export interface AllowlistStore {
  isAllowed(userId: string): Promise<boolean>;
  add(userId: string): Promise<void>;
}

/** In-memory allowlist (skeleton). TODO: TiDB-backed `st_allowlist` to persist across restarts. */
export class InMemoryAllowlist implements AllowlistStore {
  private ids = new Set<string>();
  async isAllowed(id: string): Promise<boolean> {
    return this.ids.has(id);
  }
  async add(id: string): Promise<void> {
    this.ids.add(id);
  }
}

export interface OnboardResult {
  status: "registered" | "denied";
  reply: string;
}

/**
 * One-time-code owner onboarding (docs/96 C-4): until someone sends the exact setup code,
 * the bot responds minimally and registers no one (fail-closed; not "first to message wins").
 */
export async function tryOnboard(
  store: AllowlistStore,
  userId: string,
  text: string,
  code: string,
): Promise<OnboardResult> {
  if (text.trim() === code) {
    await store.add(userId);
    return { status: "registered", reply: "登録しました。これから会話を覚えます。" };
  }
  return { status: "denied", reply: "セットアップコードを送ってください。" };
}
