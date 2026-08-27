import { createHash } from 'node:crypto';

export const RECOMMENDATION_TAGS = Object.freeze(['entry', 'tech', 'stamina', 'accuracy', 'speed']);
export const CHART_TYPES = Object.freeze(['std', 'dx']);
export const CHART_DIFFICULTIES = Object.freeze(['basic', 'advanced', 'expert', 'master', 'remaster']);
export const EVIDENCE_STATUSES = Object.freeze(['active', 'deleted', 'edited_out']);

const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'generatedAt', 'entries']);
const ENTRY_KEYS = new Set([
  'key',
  'songId',
  'chart',
  'summary',
  'tags',
  'evidenceWeight',
  'manualWeightOverride',
  'firstSeenAt',
  'lastSeenAt',
  'evidence'
]);
const CHART_KEYS = new Set(['type', 'difficulty']);
const EVIDENCE_KEYS = new Set([
  'source',
  'sourceId',
  'candidateId',
  'threadId',
  'url',
  'createdAt',
  'observedScore',
  'status',
  'lastCheckedAt'
]);

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
}

function rejectUnknownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${path}.${key} is not allowed.`);
    }
  }
}

function assertRfc3339(value, path, { nullable = false } = {}) {
  if (nullable && value == null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    throw new Error(`${path} must be a UTC RFC 3339 timestamp.`);
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${path} is not a valid timestamp.`);
  }
}

function assertNullableString(value, path) {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`${path} must be a string or null.`);
  }
}

function assertWeight(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a finite number from 0 to 1.`);
  }
}

export function canonicalChartKey(songId, type, difficulty) {
  return `${String(songId || '').trim()}:${String(type || '').trim().toLowerCase()}:${String(difficulty || '').trim().toLowerCase()}`;
}

export function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateCatalogV2(document) {
  assertObject(document, 'catalog');
  rejectUnknownKeys(document, TOP_LEVEL_KEYS, 'catalog');
  if (document.schemaVersion !== 2) throw new Error('catalog.schemaVersion must be 2.');
  assertRfc3339(document.generatedAt, 'catalog.generatedAt');
  if (!Array.isArray(document.entries)) throw new Error('catalog.entries must be an array.');

  const seenKeys = new Set();
  const seenCandidateIds = new Set();
  const entries = document.entries.map((rawEntry, entryIndex) => {
    const path = `catalog.entries[${entryIndex}]`;
    assertObject(rawEntry, path);
    rejectUnknownKeys(rawEntry, ENTRY_KEYS, path);
    assertObject(rawEntry.chart, `${path}.chart`);
    rejectUnknownKeys(rawEntry.chart, CHART_KEYS, `${path}.chart`);

    const songId = String(rawEntry.songId || '').trim();
    const type = String(rawEntry.chart.type || '').toLowerCase();
    const difficulty = String(rawEntry.chart.difficulty || '').toLowerCase();
    const key = canonicalChartKey(songId, type, difficulty);
    if (!/^song:[a-f0-9]{16}$/.test(songId)) throw new Error(`${path}.songId is not canonical.`);
    if (!CHART_TYPES.includes(type)) throw new Error(`${path}.chart.type is invalid.`);
    if (!CHART_DIFFICULTIES.includes(difficulty)) throw new Error(`${path}.chart.difficulty is invalid.`);
    if (rawEntry.key !== key) throw new Error(`${path}.key must equal ${key}.`);
    if (seenKeys.has(key)) throw new Error(`${path}.key duplicates ${key}.`);
    seenKeys.add(key);

    const summary = String(rawEntry.summary || '').trim();
    if (!summary || summary.length > 180) throw new Error(`${path}.summary must contain 1-180 characters.`);
    if (!Array.isArray(rawEntry.tags)) throw new Error(`${path}.tags must be an array.`);
    const tags = rawEntry.tags.map((tag) => String(tag).toLowerCase());
    if (new Set(tags).size !== tags.length || tags.some((tag) => !RECOMMENDATION_TAGS.includes(tag))) {
      throw new Error(`${path}.tags must be unique allowed values.`);
    }
    assertWeight(rawEntry.evidenceWeight, `${path}.evidenceWeight`);
    if (rawEntry.manualWeightOverride !== undefined) {
      assertWeight(rawEntry.manualWeightOverride, `${path}.manualWeightOverride`);
    }
    assertRfc3339(rawEntry.firstSeenAt, `${path}.firstSeenAt`);
    assertRfc3339(rawEntry.lastSeenAt, `${path}.lastSeenAt`);
    if (!Array.isArray(rawEntry.evidence) || rawEntry.evidence.length === 0) {
      throw new Error(`${path}.evidence must contain at least one item.`);
    }

    const evidence = rawEntry.evidence.map((rawEvidence, evidenceIndex) => {
      const evidencePath = `${path}.evidence[${evidenceIndex}]`;
      assertObject(rawEvidence, evidencePath);
      rejectUnknownKeys(rawEvidence, EVIDENCE_KEYS, evidencePath);
      const source = String(rawEvidence.source || '');
      const sourceId = String(rawEvidence.sourceId || '').trim();
      const status = String(rawEvidence.status || '');
      if (!['manual', 'reddit'].includes(source)) throw new Error(`${evidencePath}.source is invalid.`);
      if (!sourceId) throw new Error(`${evidencePath}.sourceId is required.`);
      if (!EVIDENCE_STATUSES.includes(status)) throw new Error(`${evidencePath}.status is invalid.`);
      assertRfc3339(rawEvidence.lastCheckedAt, `${evidencePath}.lastCheckedAt`);
      for (const field of ['candidateId', 'threadId', 'url']) assertNullableString(rawEvidence[field] ?? null, `${evidencePath}.${field}`);
      assertRfc3339(rawEvidence.createdAt ?? null, `${evidencePath}.createdAt`, { nullable: true });
      if (rawEvidence.observedScore !== null && rawEvidence.observedScore !== undefined && !Number.isInteger(rawEvidence.observedScore)) {
        throw new Error(`${evidencePath}.observedScore must be an integer or null.`);
      }
      if (source === 'manual' && !/^manual:[a-z0-9][a-z0-9._-]*$/.test(sourceId)) {
        throw new Error(`${evidencePath}.sourceId must be a stable manual slug.`);
      }
      if (source === 'reddit' && status === 'active') {
        if (!rawEvidence.candidateId || !rawEvidence.threadId || !rawEvidence.url || !rawEvidence.createdAt || !Number.isInteger(rawEvidence.observedScore)) {
          throw new Error(`${evidencePath} is missing active Reddit provenance.`);
        }
        let url;
        try { url = new URL(rawEvidence.url); } catch { throw new Error(`${evidencePath}.url is invalid.`); }
        if (!/(^|\.)reddit\.com$/i.test(url.hostname) || !url.pathname.toLowerCase().includes('/r/maimai/')) {
          throw new Error(`${evidencePath}.url must belong to r/maimai on reddit.com.`);
        }
        if (!/^t[13]_[a-z0-9]+$/i.test(sourceId) || !/^t3_[a-z0-9]+$/i.test(rawEvidence.threadId) || !/^[a-f0-9]{64}$/.test(rawEvidence.candidateId)) {
          throw new Error(`${evidencePath} has invalid Reddit or candidate identifiers.`);
        }
        if (seenCandidateIds.has(rawEvidence.candidateId)) throw new Error(`${evidencePath}.candidateId is duplicated.`);
        seenCandidateIds.add(rawEvidence.candidateId);
      }
      return Object.freeze({ ...rawEvidence, source, sourceId, status });
    });

    return Object.freeze({
      ...rawEntry,
      songId,
      key,
      chart: Object.freeze({ type, difficulty }),
      summary,
      tags: Object.freeze(tags),
      evidence: Object.freeze(evidence)
    });
  });

  return Object.freeze({ schemaVersion: 2, generatedAt: document.generatedAt, entries: Object.freeze(entries) });
}

export function validateCandidateV1(candidate) {
  assertObject(candidate, 'candidate');
  const allowed = new Set([
    'schemaVersion', 'candidateId', 'supersedes', 'source', 'sourceId', 'threadId', 'url',
    'titleHint', 'artistHint', 'chartType', 'difficulty', 'stance', 'rationale', 'tags',
    'confidence', 'promptVersion', 'model', 'contentHash'
  ]);
  rejectUnknownKeys(candidate, allowed, 'candidate');
  if (candidate.schemaVersion !== 1) throw new Error('candidate.schemaVersion must be 1.');
  for (const field of ['candidateId', 'source', 'sourceId', 'threadId', 'url', 'titleHint', 'rationale', 'promptVersion', 'model', 'contentHash']) {
    if (typeof candidate[field] !== 'string' || !candidate[field].trim()) throw new Error(`candidate.${field} is required.`);
  }
  if (candidate.source !== 'reddit') throw new Error('candidate.source must be reddit.');
  if (!/^[a-f0-9]{64}$/.test(candidate.candidateId) || !/^[a-f0-9]{64}$/.test(candidate.contentHash)) {
    throw new Error('candidate IDs and content hashes must be lowercase SHA-256 values.');
  }
  let url;
  try { url = new URL(candidate.url); } catch { throw new Error('candidate.url is invalid.'); }
  if (!/(^|\.)reddit\.com$/i.test(url.hostname) || !url.pathname.toLowerCase().includes('/r/maimai/')) {
    throw new Error('candidate.url must belong to r/maimai on reddit.com.');
  }
  if (candidate.supersedes != null && typeof candidate.supersedes !== 'string') throw new Error('candidate.supersedes must be a string or null.');
  if (candidate.artistHint != null && typeof candidate.artistHint !== 'string') throw new Error('candidate.artistHint must be a string or null.');
  if (candidate.chartType != null && !CHART_TYPES.includes(candidate.chartType)) throw new Error('candidate.chartType is invalid.');
  if (candidate.difficulty != null && !CHART_DIFFICULTIES.includes(candidate.difficulty)) throw new Error('candidate.difficulty is invalid.');
  if (!['positive', 'negative', 'mixed', 'unclear'].includes(candidate.stance)) throw new Error('candidate.stance is invalid.');
  assertWeight(candidate.confidence, 'candidate.confidence');
  if (!Array.isArray(candidate.tags) || candidate.tags.some((tag) => !RECOMMENDATION_TAGS.includes(tag)) || new Set(candidate.tags).size !== candidate.tags.length) {
    throw new Error('candidate.tags must be unique allowed values.');
  }
  if (candidate.rationale.length > 180) throw new Error('candidate.rationale must not exceed 180 characters.');
  return Object.freeze({ ...candidate });
}
