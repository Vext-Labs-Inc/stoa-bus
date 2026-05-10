# @stoa/bus

Live state bus for the Stoa open substrate. Implements SSE/WebPush state-delta fanout, prefix subscriptions with Bloom filters, vendor SDK to publish resource deltas, and a webhook-to-bus adapter that converts Stripe-style webhooks into Stoa state-delta streams.

Polling is dead. Every Stoa-conformant capability that returns a `state_delta` opts its resource into the bus. Agents subscribe by URN and receive push deltas when the resource changes via any path — UI, API, or another agent.

Spec: [STOA.md §12 — Live state bus](https://github.com/stoa-spec/stoa-spec)

---

## Install

```bash
npm install @stoa/bus zod
```

---

## Usage

### Vendor: publish a resource change

```ts
import { publish } from "@stoa/bus";

await publish({
  urn: "urn:stoa:res:hubspot.contact:84021",
  version: 18,
  etag: 'W/"a4b"',
  changeset: [
    { op: "replace", path: "/email", old_hash: "0xa", new_hash: "0xb" }
  ],
  by: "agent:openai:apps#42",
});
// => { delivered_to: 3, persisted: false, seq: 17 }
```

### Agent: subscribe to a single resource

```ts
import { subscribe } from "@stoa/bus";

const sub = await subscribe(
  "urn:stoa:res:hubspot.contact:84021",
  { since_version: 17 },
  (delta) => {
    console.log("contact updated", delta.changeset);
  }
);

// Later:
sub.unsubscribe();
```

### Agent: prefix subscription with Bloom filter (STOA.md §12.2)

```ts
import { subscribe, createBloom, addToBloom, serializeBloom } from "@stoa/bus";

// Only push deltas for the 50K contacts we actually care about
const filter = createBloom(8192); // 8KB filter
addToBloom(filter, "urn:stoa:res:hubspot.contact:84021");
addToBloom(filter, "urn:stoa:res:hubspot.contact:84022");
// ... add more

const sub = await subscribe(
  "urn:stoa:res:hubspot.contact:*",
  { bloom_filter: serializeBloom(filter) },
  (delta) => console.log("delta", delta.urn)
);
```

### Vendor: webhook-to-bus adapter

Turn existing Stripe-style webhooks into Stoa state-delta events automatically:

```ts
import { createWebhookAdapter } from "@stoa/bus";

const handler = createWebhookAdapter({
  vendor: "stripe",
  resource_mapping: {
    "charge.succeeded": (event) => ({
      urn: `urn:stoa:res:stripe.charge:${event.data.object["id"]}`,
      version: 1,
      etag: `W/"${event.id}"`,
      changeset: [{ op: "create", path: "/", value_hash: event.id }],
      by: "stripe:webhook",
      ts: event.created,
    }),
  },
});

// In your webhook route handler:
const result = await handler.handle(rawBody, req.headers);
// => { accepted: true, delta: { urn: "urn:stoa:res:stripe.charge:...", ... } }
```

A pre-built Stripe adapter is also exported as `stripeWebhookAdapter`.

---

## The StateDelta envelope (STOA.md §12)

| Field | Type | Description |
|---|---|---|
| `urn` | `urn:stoa:res:*` | Stable resource URN |
| `version` | number | Monotonically increasing resource version |
| `etag` | string | HTTP-style ETag for optimistic concurrency |
| `changeset` | array | Field-level changes (JSON-Patch style) |
| `by` | string | Actor that caused the change |
| `ts` | number? | Unix timestamp of the commit |
| `seq` | number? | Sequence number within the resource's delta log |

---

## Bloom filter

The `src/bloom.ts` module is a self-contained, deterministic, no-dependency 1024-bit Bloom filter. Serialises to base64 for transport in the subscribe query parameter.

```ts
import { createBloom, addToBloom, testBloom, serializeBloom, deserializeBloom } from "@stoa/bus";

const f = createBloom(1024, 3); // 1024-bit, 3 hash functions
addToBloom(f, "urn:stoa:res:hubspot.contact:84021");
testBloom(f, "urn:stoa:res:hubspot.contact:84021"); // true
testBloom(f, "urn:stoa:res:hubspot.contact:99999"); // false (or rarely, a false positive)

const b64 = serializeBloom(f);
const f2 = deserializeBloom(b64); // round-trip
```

---

## Links

- Stoa spec: https://github.com/stoa-spec/stoa-spec
- STOA.md §12: Live state bus
- stoa-identity: https://github.com/Vext-Labs-Inc/stoa-identity
- stoa-conformance: https://github.com/Vext-Labs-Inc/stoa-conformance

---

## License

Apache-2.0. Copyright 2026 Vext Labs Inc.

The Stoa spec is CC-BY-4.0. This runtime package is Apache-2.0.
Everything is open source, forever. See [STOA.md §2](https://github.com/stoa-spec/stoa-spec).
