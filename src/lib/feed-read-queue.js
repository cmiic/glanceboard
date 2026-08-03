export function createFeedReadQueue ({ setFeedItemRead }) {
  let mutation = Promise.resolve()
  return {
    enqueue (sourceId, itemId, read) {
      const run = mutation.then(() => setFeedItemRead(sourceId, itemId, read))
      mutation = run.catch(() => {})
      return run
    }
  }
}
