/**
 * Stoa Bus — webhook-to-bus adapter.
 *
 * Converts existing Stripe-style webhook events into Stoa StateDelta envelopes,
 * then publishes them to the live state bus.
 *
 * Spec reference: STOA.md §17.3 (Webhook -> state bus adapter):
 * "Every existing webhook in every existing SaaS becomes a Stoa state-delta stream automatically."
 *
 * v0: mock implementation. Production: mount as a Cloudflare Worker or Express middleware.
 */

import {
  type StateDelta,
  type WebhookEvent,
  WebhookEventSchema,
} from "./types.js";
import { publish } from "./publish.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Maps a vendor webhook event to a StateDelta.
 * Return null to drop the event (e.g. for event types that don't map to a resource).
 */
export type WebhookMapper = (
  event: WebhookEvent
) => StateDelta | null | Promise<StateDelta | null>;

export interface WebhookToBusConfig {
  /** Vendor name, e.g. "stripe", "hubspot", "github". Used in logs. */
  vendor: string;
  /**
   * Map from webhook event type glob to mapper function.
   * Key: event type string (e.g. "charge.succeeded") or "*" for catch-all.
   */
  resource_mapping: Record<string, WebhookMapper>;
  /**
   * Optional signature verification function.
   * Called before mapping. Throw to reject the webhook.
   */
  verify_signature?: (
    payload: string,
    headers: Record<string, string>
  ) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Create a webhook-to-bus adapter for a vendor.
 *
 * @returns A handler function you mount at your webhook path.
 *
 * @example
 * ```ts
 * const stripeHandler = createWebhookAdapter({
 *   vendor: "stripe",
 *   resource_mapping: {
 *     "charge.succeeded": (event) => ({
 *       urn: `urn:stoa:res:stripe.charge:${event.data.object["id"]}`,
 *       version: 1,
 *       etag: `W/"${event.id}"`,
 *       changeset: [{ op: "create", path: "/", value_hash: event.id }],
 *       by: "stripe:webhook",
 *       ts: event.created,
 *     }),
 *   },
 * });
 * ```
 */
export function createWebhookAdapter(config: WebhookToBusConfig): {
  handle: (
    rawBody: string,
    headers?: Record<string, string>
  ) => Promise<{ accepted: boolean; delta: StateDelta | null }>;
} {
  return {
    async handle(rawBody, headers = {}) {
      // Step 1: Verify signature if configured
      if (config.verify_signature) {
        await config.verify_signature(rawBody, headers);
      }

      // Step 2: Parse webhook event
      let event: WebhookEvent;
      try {
        const raw = JSON.parse(rawBody) as unknown;
        const parsed = WebhookEventSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn(
            `[stoa-bus:webhook:${config.vendor}] event failed schema: ${parsed.error.message}`
          );
          return { accepted: false, delta: null };
        }
        event = parsed.data;
      } catch (err) {
        console.error(
          `[stoa-bus:webhook:${config.vendor}] JSON parse error: ${String(err)}`
        );
        return { accepted: false, delta: null };
      }

      // Step 3: Find matching mapper
      const mapper =
        config.resource_mapping[event.type] ??
        config.resource_mapping["*"] ??
        null;

      if (!mapper) {
        console.log(
          `[stoa-bus:webhook:${config.vendor}] no mapper for event type "${event.type}" — skipping`
        );
        return { accepted: true, delta: null };
      }

      // Step 4: Map to StateDelta
      let delta: StateDelta | null;
      try {
        delta = await mapper(event);
      } catch (err) {
        console.error(
          `[stoa-bus:webhook:${config.vendor}] mapper error for "${event.type}": ${String(err)}`
        );
        return { accepted: false, delta: null };
      }

      if (!delta) {
        return { accepted: true, delta: null };
      }

      // Step 5: Publish to the bus
      await publish(delta);

      return { accepted: true, delta };
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-built Stripe adapter (mock/example)
// ---------------------------------------------------------------------------

/**
 * Example Stripe webhook-to-bus adapter.
 * Maps common Stripe event types to Stoa resource URNs.
 * v0: mock — extend with real Stripe resource shapes.
 */
export const stripeWebhookAdapter = createWebhookAdapter({
  vendor: "stripe",
  resource_mapping: {
    "charge.succeeded": (event) => {
      const id = event.data.object["id"];
      if (typeof id !== "string") return null;
      return {
        urn: `urn:stoa:res:stripe.charge:${id}`,
        version: 1,
        etag: `W/"${event.id}"`,
        changeset: [
          {
            op: "create",
            path: "/",
            value_hash: `0x${Buffer.from(event.id).toString("hex")}`,
          },
        ],
        by: "stripe:webhook",
        ts: event.created,
      };
    },

    "charge.refunded": (event) => {
      const id = event.data.object["id"];
      if (typeof id !== "string") return null;
      return {
        urn: `urn:stoa:res:stripe.charge:${id}`,
        version: 2,
        etag: `W/"refunded-${event.id}"`,
        changeset: [
          {
            op: "replace",
            path: "/status",
            old_hash: "0xdeadbeef",
            new_hash: `0x${Buffer.from("refunded").toString("hex")}`,
          },
        ],
        by: "stripe:webhook",
        ts: event.created,
      };
    },

    "customer.subscription.updated": (event) => {
      const id = event.data.object["id"];
      if (typeof id !== "string") return null;
      return {
        urn: `urn:stoa:res:stripe.subscription:${id}`,
        version: 1,
        etag: `W/"${event.id}"`,
        changeset: [
          {
            op: "replace",
            path: "/",
            new_hash: `0x${Buffer.from(event.id).toString("hex")}`,
          },
        ],
        by: "stripe:webhook",
        ts: event.created,
      };
    },
  },
});
