// One serialized writer per editor. Revisions are owned by PostgreSQL.
export function createAutosave({
  read,
  write,
  revision,
  onStatus,
  delay = 700,
}) {
  let saved = JSON.stringify(read()),
    timer = null,
    inflight = null,
    failures = 0,
    conflict = false,
    disposed = false;
  const dirty = () => JSON.stringify(read()) !== saved;
  async function flush() {
    clearTimeout(timer);
    if (inflight) {
      await inflight;
      if (dirty()) return flush();
      return;
    }
    if (conflict)
      throw new Error(
        "A newer version exists. Save your draft as a copy or review the latest version.",
      );
    if (!dirty() || disposed) return;
    const snapshot = read(),
      serialized = JSON.stringify(snapshot);
    onStatus("Saving…");
    inflight = (async () => {
      try {
        const result = await write({ ...snapshot, revision });
        failures=0;
        revision = result.item.revision;
        saved = serialized;
        onStatus(dirty() ? "Unsaved changes" : "Saved");
      } catch (error) {
        conflict = error.status === 409;
        failures++;
        if(!disposed && !conflict && error.status!==401 && (!error.status || error.status>=500) && failures<=4) timer=setTimeout(()=>flush().catch(()=>{}),Math.min(30000,1000*2**(failures-1)));
        onStatus(
          conflict
            ? "Conflict — your draft is preserved"
            : "Save failed — your draft is preserved",
          error,
        );
        throw error;
      } finally {
        inflight = null;
      }
    })();
    await inflight;
    if (dirty()) return flush();
  }
  return {
    dirty,
    flush,
    get revision() {
      return revision;
    },
    get conflicted() {
      return conflict;
    },
    changed() {
      if (disposed) return;
      onStatus("Unsaved changes");
      clearTimeout(timer);
      timer = setTimeout(() => flush().catch(() => {}), delay);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
