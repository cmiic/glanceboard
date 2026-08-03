function mergedSourceIds (jobs) {
  if (jobs.some(job => job.sourceIds == null)) return null
  return [...new Set(jobs.flatMap(job => job.sourceIds || []))]
}

function resultForJob (result, sourceIds) {
  if (sourceIds == null) return result
  const requested = new Set(sourceIds)
  return {
    ...result,
    attempted: (result?.attempted || []).filter(id => requested.has(id)),
    failures: (result?.failures || []).filter(item => requested.has(item.sourceId))
  }
}

// Own the single background refresh lane. Jobs of the same priority that arrive while settings are
// being read are combined into one source batch, while each caller still receives only its result.
export function createFeedRefreshQueue ({
  getSettings, refreshFeedSources, scheduleFeedRefresh, onError = () => {}
}) {
  const pending = []
  let running = false
  let order = 0

  function takeMatchingJobs (first) {
    const batch = [first]
    for (let index = 0; index < pending.length;) {
      if (pending[index].priority === first.priority) batch.push(...pending.splice(index, 1))
      else index++
    }
    return batch
  }

  async function reschedule (settings) {
    try {
      await scheduleFeedRefresh(settings || await getSettings())
    } catch (error) {
      onError('Glanceboard feed refresh rescheduling failed', error)
    }
  }

  async function drain () {
    if (running) return
    running = true
    try {
      while (pending.length) {
        pending.sort((a, b) => b.priority - a.priority || a.order - b.order)
        const first = pending.shift()
        let batch = [first]
        let settings = null
        let result = null
        let failure = null
        try {
          // This storage read yields long enough for concurrently-mounted feed cards to join the
          // pending batch instead of each causing its own cache scan and scheduling pass.
          settings = await getSettings()
          batch = takeMatchingJobs(first)
          const sourceIds = mergedSourceIds(batch)
          result = await refreshFeedSources(sourceIds, {
            force: first.force,
            pollingEnabled: !!settings.feedPollingEnabled
          })
        } catch (error) {
          onError('Glanceboard feed refresh failed', error)
          failure = error
        } finally {
          // The alarm is one-shot. Always reconstruct it after a job, including failed refreshes,
          // and isolate scheduling errors so they cannot stop later queue entries.
          await reschedule(settings)
        }
        for (const job of batch) {
          if (failure) job.reject(failure)
          else job.resolve(resultForJob(result, job.sourceIds))
        }
      }
    } finally {
      running = false
      if (pending.length) drain().catch(error => onError('Glanceboard feed queue re-drain failed', error))
    }
  }

  function enqueue (sourceIds, { force = false } = {}) {
    return new Promise((resolve, reject) => {
      pending.push({
        sourceIds: Array.isArray(sourceIds) ? [...new Set(sourceIds)] : null,
        force,
        priority: force ? 1 : 0,
        order: order++,
        resolve,
        reject
      })
      drain().catch(error => {
        onError('Glanceboard feed queue failed', error)
        reject(error)
      })
    })
  }

  return { enqueue }
}
