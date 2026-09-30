export const MIN_QUIET_READ_INTERVAL_HOURS = 20;
export const QUIET_READ_BACKOFF_HOURS = 6;

function nonNegativeInteger(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function defaultPlayCollectionState() {
  return {
    historyEnabled: false,
    quietReadAt: null,
    collectionStartedAt: null,
    lastPlayCount: null,
    continuousPlays: 0,
    totalCapturedPlays: 0,
    gapsDetected: 0,
    lastGapAt: null,
    backoffUntil: null,
    leaseUntil: null,
    lastOutcome: null
  };
}

export function applyPlayCollectionObservation(rawState, {
  playCount,
  newlyCaptured = 0,
  observedAt = new Date().toISOString(),
  quiet = false
} = {}) {
  const state = { ...defaultPlayCollectionState(), ...(rawState || {}) };
  const currentPlayCount = nonNegativeInteger(playCount);
  const previousPlayCount = nonNegativeInteger(state.lastPlayCount);
  const captured = nonNegativeInteger(newlyCaptured) ?? 0;
  const next = {
    ...state,
    quietReadAt: quiet ? observedAt : state.quietReadAt,
    collectionStartedAt: state.collectionStartedAt || observedAt,
    lastPlayCount: currentPlayCount ?? state.lastPlayCount,
    totalCapturedPlays: (nonNegativeInteger(state.totalCapturedPlays) ?? 0) + captured,
    leaseUntil: null,
    lastOutcome: 'ok'
  };

  // The first observation is a baseline. Plays already visible in the rolling
  // recent list cannot safely be called a continuous, replayable window.
  if (previousPlayCount == null || currentPlayCount == null) {
    return { state: next, gap: null, baseline: true };
  }

  const playCountDelta = currentPlayCount - previousPlayCount;
  const counterReset = playCountDelta < 0;
  const missingPlays = counterReset ? 0 : Math.max(0, playCountDelta - captured);
  if (counterReset || missingPlays > 0) {
    const gap = {
      detectedAt: observedAt,
      reason: counterReset ? 'play-count-reset' : 'recent-window-overflow',
      previousPlayCount,
      currentPlayCount,
      newlyCaptured: captured,
      missingPlays
    };
    return {
      state: {
        ...next,
        collectionStartedAt: observedAt,
        continuousPlays: 0,
        gapsDetected: (nonNegativeInteger(state.gapsDetected) ?? 0) + 1,
        lastGapAt: observedAt,
        lastOutcome: 'gap'
      },
      gap,
      baseline: false
    };
  }

  return {
    state: {
      ...next,
      continuousPlays: (nonNegativeInteger(state.continuousPlays) ?? 0) + captured
    },
    gap: null,
    baseline: false
  };
}

export function isQuietReadDue(state, now = Date.now(), intervalHours = MIN_QUIET_READ_INTERVAL_HOURS) {
  if (!state?.historyEnabled) return false;
  const backoffUntil = Date.parse(state.backoffUntil || '');
  if (Number.isFinite(backoffUntil) && backoffUntil > now) return false;
  const lastRead = Date.parse(state.quietReadAt || '');
  if (!Number.isFinite(lastRead)) return true;
  const safeHours = Math.max(MIN_QUIET_READ_INTERVAL_HOURS, Number(intervalHours) || 0);
  return now - lastRead >= safeHours * 60 * 60 * 1000;
}
