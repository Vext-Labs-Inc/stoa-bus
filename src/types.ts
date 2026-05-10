/**
 * Stoa Bus — type definitions.
 *
 * Zod schemas for the StateDelta envelope as specified in STOA.md §12.
 * All field names match the spec exactly.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Changeset operation (JSON-Patch style, STOA.md §12.1)
// ---------------------------------------------------------------------------

export const ChangeOpSchema = z.enum(["create", "replace", "remove", "add"]);
export type ChangeOp = z.infer<typeof ChangeOpSchema>;

export const ChangesetEntrySchema = z.object({
  /** JSON-Patch operation type. */
  op: ChangeOpSchema,
  /** JSON Pointer path within the resource (RFC 6901). */
  path: z.string(),
  /** SHA-256 hash of the new value. Omitted on "remove". */
  new_hash: z.string().regex(/^0x[0-9a-f]+$/).optional(),
  /** SHA-256 hash of the prior value. Present on "replace" and "remove". */
  old_hash: z.string().regex(/^0x[0-9a-f]+$/).optional(),
  /** Inline value — only for "create" on small (<4KB) non-sensitive payloads. */
  value: z.unknown().optional(),
  /** Hash of the inline value (cross-check). */
  value_hash: z.string().optional(),
});

export type ChangesetEntry = z.infer<typeof ChangesetEntrySchema>;

// ---------------------------------------------------------------------------
// StateDelta envelope (STOA.md §12.1)
// ---------------------------------------------------------------------------

/**
 * The canonical state-delta envelope emitted by a Stoa-conformant vendor
 * when a resource changes via any path (UI, API, or another agent).
 *
 * This is the payload of SSE events on the live state bus and the value of
 * `state_delta` in the Stoa/1 response envelope.
 */
export const StateDeltaSchema = z.object({
  /**
   * Stable resource URN.
   * Pattern: "urn:stoa:res:<vendor>.<resource_type>:<id>"
   * Example: "urn:stoa:res:hubspot.contact:84021"
   */
  urn: z.string().regex(/^urn:stoa:res:/),

  /** Monotonically increasing resource version. Used for optimistic concurrency. */
  version: z.number().int().positive(),

  /**
   * HTTP-style ETag. Must match the ETag that would be returned on a GET
   * of this resource at this version.
   */
  etag: z.string(),

  /** Ordered list of field-level changes in this delta. */
  changeset: z.array(ChangesetEntrySchema).min(1),

  /**
   * Identifier of the actor that caused this change.
   * Can be an agent sub ("agent:openai:apps#42"), a user ID, or a system process.
   */
  by: z.string(),

  /** Unix timestamp when the change was committed on the vendor side. */
  ts: z.number().int().positive().optional(),

  /**
   * Sequence number within this resource's delta log.
   * Subscribers use this to detect gaps and trigger resync.
   */
  seq: z.number().int().nonnegative().optional(),
});

export type StateDelta = z.infer<typeof StateDeltaSchema>;

// ---------------------------------------------------------------------------
// Subscription request options
// ---------------------------------------------------------------------------

export const SubscriptionOptsSchema = z.object({
  /**
   * Return only deltas after this version (exclusive).
   * Pass the last known version to resume from a checkpoint.
   */
  since_version: z.number().int().nonnegative().optional(),

  /**
   * Sequence number of the last received delta.
   * Server uses this to detect missed events and emit a resync.
   */
  since_seq: z.number().int().nonnegative().optional(),

  /**
   * Base64-encoded Bloom filter for prefix subscriptions (STOA.md §12.2).
   * Only deltas whose URN is in the filter are pushed to this subscriber.
   * When absent, all deltas under the prefix are pushed.
   */
  bloom_filter: z.string().optional(),

  /** Max number of in-flight deltas before backpressure is applied. */
  max_inflight: z.number().int().positive().default(100),
});

export type SubscriptionOpts = z.infer<typeof SubscriptionOptsSchema>;

// ---------------------------------------------------------------------------
// Webhook event (generic Stripe-style incoming webhook)
// ---------------------------------------------------------------------------

export const WebhookEventSchema = z.object({
  /** Event type in vendor notation, e.g. "charge.succeeded". */
  type: z.string(),
  /** Vendor-assigned unique event ID. Used for deduplication. */
  id: z.string(),
  /** Unix timestamp of the event on the vendor side. */
  created: z.number().int().positive(),
  /** The resource object embedded in the event. */
  data: z.object({
    object: z.record(z.unknown()),
    previous_attributes: z.record(z.unknown()).optional(),
  }),
  /** Arbitrary vendor metadata. */
  metadata: z.record(z.unknown()).optional(),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

// ---------------------------------------------------------------------------
// Resync response (STOA.md §12.5)
// ---------------------------------------------------------------------------

export const ResyncResponseSchema = z.object({
  urn: z.string().regex(/^urn:stoa:res:/),
  /** Full current resource state. */
  current: z.record(z.unknown()),
  /** Current version. */
  version: z.number().int().positive(),
  /** All deltas from `requested_since` to the current version, in order. */
  deltas: z.array(StateDeltaSchema),
  /** ISO-8601 timestamp of the resync snapshot. */
  as_of: z.string().datetime(),
});

export type ResyncResponse = z.infer<typeof ResyncResponseSchema>;

// ---------------------------------------------------------------------------
// Published delta (internal bus message)
// ---------------------------------------------------------------------------

export const PublishResultSchema = z.object({
  /** How many subscribers received this delta. */
  delivered_to: z.number().int().nonnegative(),
  /** Whether the delta was persisted to the 24h delta log. */
  persisted: z.boolean(),
  /** Sequence number assigned to this delta. */
  seq: z.number().int().nonnegative(),
});

export type PublishResult = z.infer<typeof PublishResultSchema>;
