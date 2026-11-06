export type EntrySaveBase = { path?: string; sha?: string };
export type EntrySaveResult = { path: string; sha: string; commitSha?: string; [key: string]: unknown };

/** One editor's confirmed file version. Only explicit saves enter this queue. */
export function createEntrySaveQueue<T>({ persist, onSaved, onBusyChange, fingerprint = JSON.stringify }: {
  persist: (snapshot: T, base: EntrySaveBase) => Promise<EntrySaveResult>;
  onSaved: (snapshot: T, result: EntrySaveResult) => void;
  onBusyChange: (busy: boolean) => void;
  fingerprint?: (snapshot: T) => string;
}) {
  const id = crypto.randomUUID();
  let base: EntrySaveBase = {};
  let epoch = 0;
  let pending = 0;
  let tail = Promise.resolve();
  const queued = new Map<string, Promise<EntrySaveResult>>();

  return {
    id,
    get epoch() { return epoch; },
    get busy() { return pending > 0; },
    get base() { return { ...base }; },
    adoptRemote(remote: EntrySaveBase, readEpoch: number, startedWhileSaving = false) {
      if (pending || startedWhileSaving || readEpoch !== epoch) return false;
      base = { ...remote };
      return true;
    },
    rename(path: string) { base = { ...base, path }; epoch++; },
    enqueue(values: T): Promise<EntrySaveResult> {
      const snapshot = structuredClone(values);
      const key = fingerprint(snapshot);
      const duplicate = queued.get(key);
      if (duplicate) return duplicate;
      pending++;
      onBusyChange(true);
      const job = tail.then(async () => {
        epoch++;
        try {
          const result = await persist(snapshot, { ...base });
          if (!result.path || !result.sha) throw new Error("저장 응답에 파일 버전이 없어요. 초안을 유지했어요.");
          base = { path: result.path, sha: result.sha };
          epoch++;
          onSaved(snapshot, result);
          return result;
        } catch (error) {
          epoch++;
          throw error;
        } finally {
          queued.delete(key);
          pending--;
          onBusyChange(pending > 0);
        }
      });
      queued.set(key, job);
      tail = job.then(() => undefined, () => undefined);
      return job;
    },
  };
}
