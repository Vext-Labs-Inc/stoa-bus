/**
 * Stoa Bus — subscribe to resource state deltas.
 *
 * Client-side subscription primitives for the Stoa live state bus.
 * Spec reference: STOA.md §12.1 (Subscriptions), §12.2 (Prefix subscriptions),
 * §12.3 (WebPush for offline clients), §12.5 (Backpressure & reliability)
 *
 * v0: in-process event emitter backed by publish.ts.
 *     Production: SSE stream consumer pointing at a Cloudflare Workers endpoint.
 */

import {
  type StateDelta,
  type SubscriptionOpts,
  SubscriptionOptsSchema,
} from "./types.js";
import { createBloom, addToBloom, deserializeBloom, type BloomFilter } from "./bloom.js";
import { _registerSubscriber } from "./publish.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Subscription {
  /** Unsubscribe and release resources. */
  unsubscribe(): void;
  /** The prefix this subscription was opened on. */
  prefix: string;
  /** Number of deltas received so far. */
  readonly received: number;
}

export type DeltaHandler = (delta: StateDelta) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Subscribe
// ---------------------------------------------------------------------------

/**
 * Subscribe to state deltas matching a URN prefix.
 *
 * Spec: STOA.md §12.1 — exact resource URN subscription
 *       STOA.md §12.2 — prefix subscription with Bloom filter
 *
 * @example
 * // Subscribe to a single resource
 * const sub = await subscribe("urn:stoa:res:hubspot.contact:84021", {}, handler);
 *
 * @example
 * // Subscribe to all contacts (prefix) with Bloom filter
 * const filter = createBloom();
 * addToBloom(filter, "urn:stoa:res:hubspot.contact:84021");
 * addToBloom(filter, "urn:stoa:res:hubspot.contact:84022");
 * const sub = await subscribe("urn:stoa:res:hubspot.contact:*", { bloom_filter: serializeBloom(filter) }, handler);
 *
 * @param prefix - Full URN or URN prefix ending with "*"
 * @param opts - Subscription options (since_version, bloom_filter, etc.)
 * @param handler - Callback invoked for each matching delta
 * @returns Subscription handle
 */
export async function subscribe(
  prefix: string,
  opts: Partial<SubscriptionOpts>,
  handler: DeltaHandler
): Promise<Subscription> {
  const parsedOpts = SubscriptionOptsSchema.parse({
    max_inflight: 100,
    ...opts,
  });

  // Resolve bloom filter
  let bloom: BloomFilter | null = null;
  if (parsedOpts.bloom_filter) {
    bloom = deserializeBloom(parsedOpts.bloom_filter);
  }

  let received = 0;
  let inflight = 0;

  const unsubscribe = _registerSubscriber(prefix, bloom, async (delta) => {
    // Backpressure: drop if too many inflight (STOA.md §12.5)
    if (inflight >= parsedOpts.max_inflight) {
      console.warn(
        `[stoa-bus] subscriber on ${prefix} is at max_inflight=${parsedOpts.max_inflight}, dropping delta seq=${delta.seq}`
      );
      return;
    }

    // Version filter: skip if delta is older than since_version
    if (
      parsedOpts.since_version !== undefined &&
      delta.version <= parsedOpts.since_version
    ) {
      return;
    }

    inflight++;
    received++;
    try {
      await handler(delta);
    } catch (err) {
      console.error(`[stoa-bus] handler error on ${prefix}: ${String(err)}`);
    } finally {
      inflight--;
    }
  });

  return {
    prefix,
    get received() {
      return received;
    },
    unsubscribe,
  };
}

// ---------------------------------------------------------------------------
// SSE stream consumer (production adapter placeholder)
// ---------------------------------------------------------------------------

/**
 * Subscribe via an SSE stream from a remote Stoa bus endpoint.
 *
 * v0: stub — logs what it would do and returns a no-op subscription.
 * Production: open an EventSource to the vendor's subscribe endpoint,
 * parse each `event: delta` SSE frame, validate via StateDeltaSchema,
 * and forward to handler.
 *
 * @param endpoint - Full SSE endpoint URL
 *   e.g. "https://api.hubspot.com/v1/subscribe?res=urn:stoa:res:hubspot.contact:84021"
 * @param jwt - Hive JWT for authorization
 * @param handler - Delta handler
 */
export async function subscribeSSE(
  endpoint: string,
  jwt: string,
  handler: DeltaHandler
): Promise<Subscription> {
  // TODO: implement with EventSource or fetch + ReadableStream
  console.log(
    `[stoa-bus] subscribeSSE (stub): would connect to ${endpoint} ` +
      `with Authorization: Bearer ${jwt.slice(0, 20)}...`
  );

  let received = 0;

  return {
    prefix: endpoint,
    get received() {
      return received;
    },
    unsubscribe() {
      console.log(`[stoa-bus] subscribeSSE unsubscribed from ${endpoint}`);
    },
  };
}
