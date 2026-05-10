/**
 * @stoa/bus — public API surface
 *
 * Stoa live state bus: state-delta SSE/WebPush fanout, prefix subscriptions
 * with Bloom filters, vendor SDK to publish deltas, webhook-to-bus adapter.
 *
 * Spec reference: STOA.md §12 (Live state bus)
 *
 * @example
 * ```ts
 * import { publish, subscribe, createBloom, addToBloom } from "@stoa/bus";
 *
 * // Vendor: publish a resource change
 * await publish({
 *   urn: "urn:stoa:res:hubspot.contact:84021",
 *   version: 18,
 *   etag: 'W/"a4b"',
 *   changeset: [{ op: "replace", path: "/email", old_hash: "0xa", new_hash: "0xb" }],
 *   by: "agent:openai:apps#42",
 * });
 *
 * // Agent: subscribe to a prefix
 * const filter = createBloom();
 * addToBloom(filter, "urn:stoa:res:hubspot.contact:84021");
 * const sub = await subscribe("urn:stoa:res:hubspot.contact:*", {
 *   bloom_filter: serializeBloom(filter),
 * }, (delta) => console.log("delta", delta));
 *
 * // Cleanup
 * sub.unsubscribe();
 * ```
 */

// Types
export type {
  StateDelta,
  ChangesetEntry,
  ChangeOp,
  SubscriptionOpts,
  WebhookEvent,
  ResyncResponse,
  PublishResult,
} from "./types.js";

export {
  StateDeltaSchema,
  ChangesetEntrySchema,
  ChangeOpSchema,
  SubscriptionOptsSchema,
  WebhookEventSchema,
  ResyncResponseSchema,
  PublishResultSchema,
} from "./types.js";

// Publish
export { publish } from "./publish.js";

// Subscribe
export type { Subscription, DeltaHandler } from "./subscribe.js";
export { subscribe, subscribeSSE } from "./subscribe.js";

// Bloom filter
export type { BloomFilter } from "./bloom.js";
export {
  createBloom,
  addToBloom,
  testBloom,
  serializeBloom,
  deserializeBloom,
} from "./bloom.js";

// Webhook adapter
export type { WebhookMapper, WebhookToBusConfig } from "./webhook_to_bus.js";
export {
  createWebhookAdapter,
  stripeWebhookAdapter,
} from "./webhook_to_bus.js";

// ---------------------------------------------------------------------------
// Package metadata
// ---------------------------------------------------------------------------

export const STOA_BUS_VERSION = "0.1.0";
export const SPEC_VERSION = "stoa-0.1";
