/**
 * Stoa Bus — publish state deltas.
 *
 * Vendor-facing SDK to publish resource state deltas to the Stoa live state bus.
 * Spec reference: STOA.md §12.4 (Vendor SDK to publish deltas)
 *
 * v0: logs to console. Production adapter: Cloudflare Pub/Sub or Durable Object fanout.
 */

import { StateDeltaSchema, type StateDelta, type PublishResult } from "./types.js";
import { addToBloom, type BloomFilter } from "./bloom.js";

// ---------------------------------------------------------------------------
// Internal subscriber registry (v0 in-memory)
// ---------------------------------------------------------------------------

interface Subscriber {
  prefix: string;
  bloom: BloomFilter | null;
  callback: (delta: StateDelta) => void;
}

const _subscribers: Subscriber[] = [];
let _seqCounter = 0;

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/**
 * Publish a state delta to all matching subscribers.
 *
 * Implements STOA.md §12.4:
 * "bus.publish(res, version, changeset, by)" — the canonical vendor SDK call
 * that turns a resource mutation into a Stoa state-delta event.
 *
 * In production this function would:
 *   1. Validate and enrich the delta (assign seq, ts)
 *   2. Persist to the 24h rolling delta log (R2 / Durable Object)
 *   3. Fan out to SSE connections and WebPush subscriptions via Cloudflare Pub/Sub
 *   4. Apply Bloom filter on the subscriber side to avoid unnecessary pushes
 *
 * @param delta - The state delta to publish
 * @returns Publication result (delivery count, sequence number)
 */
export async function publish(delta: StateDelta): Promise<PublishResult> {
  const parsed = StateDeltaSchema.safeParse(delta);
  if (!parsed.success) {
    throw new Error(`Invalid StateDelta: ${parsed.error.message}`);
  }

  const enriched: StateDelta = {
    ...parsed.data,
    ts: parsed.data.ts ?? Math.floor(Date.now() / 1000),
    seq: parsed.data.seq ?? _seqCounter++,
  };

  // v0: log to console so vendors have observable output during development
  console.log(
    `[stoa-bus] publish ${enriched.urn} v${enriched.version} ` +
      `by=${enriched.by} changes=${enriched.changeset.length}`
  );

  // Fan out to matching in-process subscribers
  let deliveredTo = 0;
  for (const sub of _subscribers) {
    if (!_matchesPrefix(enriched.urn, sub.prefix)) continue;
    if (sub.bloom !== null && !_passesBloom(enriched.urn, sub.bloom)) continue;

    try {
      sub.callback(enriched);
      deliveredTo++;
    } catch (err) {
      console.error(`[stoa-bus] subscriber callback error: ${String(err)}`);
    }
  }

  return {
    delivered_to: deliveredTo,
    persisted: false, // v0: no persistence
    seq: enriched.seq ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Internal subscription registration (used by subscribe.ts)
// ---------------------------------------------------------------------------

/**
 * Register an in-process subscriber (used internally by subscribe()).
 * Returns an unsubscribe function.
 */
export function _registerSubscriber(
  prefix: string,
  bloom: BloomFilter | null,
  callback: (delta: StateDelta) => void
): () => void {
  const sub: Subscriber = { prefix, bloom, callback };
  _subscribers.push(sub);
  return () => {
    const idx = _subscribers.indexOf(sub);
    if (idx !== -1) _subscribers.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _matchesPrefix(urn: string, prefix: string): boolean {
  if (prefix.endsWith("*")) {
    return urn.startsWith(prefix.slice(0, -1));
  }
  return urn === prefix;
}

function _passesBloom(urn: string, bloom: BloomFilter): boolean {
  // Check if the urn is likely in the bloom filter
  // If not in bloom, skip the delta (bloom false negatives: impossible by design)
  const testFilter = { ...bloom };
  // We test by checking if all bits for the urn are set
  const encoder = new TextEncoder();
  const bytes = encoder.encode(urn);
  // Simple inclusion test — mirrors bloom.ts test() logic
  for (let i = 0; i < 3; i++) {
    let h = 2166136261;
    for (const b of bytes) {
      h ^= b + i;
      h = (h * 16777619) >>> 0;
    }
    const bit = h % (bloom.bits.length * 8);
    const byteIdx = Math.floor(bit / 8);
    const bitIdx = bit % 8;
    const byte = bloom.bits[byteIdx];
    if (byte === undefined || (byte & (1 << bitIdx)) === 0) return false;
  }
  return true;
}
