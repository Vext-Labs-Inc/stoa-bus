/**
 * Stoa Bus — Bloom filter for prefix subscriptions.
 *
 * Used by STOA.md §12.2 (Prefix subscriptions):
 * "clients subscribe to a prefix with a Bloom-filter intersection so the vendor
 * only pushes when something the client cares about changes."
 *
 * Implementation:
 *   - 1024-bit (128-byte) bit array by default
 *   - 3 hash functions using FNV-1a variant with per-function seed offset
 *   - No external dependencies
 *   - Serialises to base64 for transport in the subscribe query param
 *
 * False positive rate at 1024 bits, 3 hashes, 100 elements: ~0.8%
 * This is acceptable for the bus use case: a false positive just means
 * the vendor sends a delta the client didn't strictly need — not a correctness issue.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BloomFilter {
  /** Raw bit array. Length in bits = bits.length * 8. */
  bits: Uint8Array;
  /** Number of hash functions used. */
  k: number;
  /** Number of items added. */
  count: number;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Create a new empty Bloom filter.
 *
 * @param bit_count - Size of the filter in bits. Must be a multiple of 8.
 *   Default: 1024 bits.
 * @param k - Number of hash functions. Default: 3.
 */
export function createBloom(bit_count = 1024, k = 3): BloomFilter {
  if (bit_count % 8 !== 0) {
    throw new Error(`bit_count must be a multiple of 8, got ${bit_count}`);
  }
  return {
    bits: new Uint8Array(bit_count / 8),
    k,
    count: 0,
  };
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Add an item to the Bloom filter (mutates in place).
 *
 * @param filter - The filter to add to
 * @param item - The string item to add
 */
export function addToBloom(filter: BloomFilter, item: string): void {
  const hashes = _computeHashes(item, filter.k, filter.bits.length * 8);
  for (const bit of hashes) {
    const byteIdx = Math.floor(bit / 8);
    const bitIdx = bit % 8;
    // byteIdx is always valid because bit < filter.bits.length * 8
    filter.bits[byteIdx]! |= 1 << bitIdx;
  }
  filter.count++;
}

/**
 * Test whether an item is probably in the Bloom filter.
 *
 * Returns false means definitely not in the set.
 * Returns true means probably in the set (with false-positive probability).
 *
 * @param filter - The filter to test against
 * @param item - The string item to test
 */
export function testBloom(filter: BloomFilter, item: string): boolean {
  const hashes = _computeHashes(item, filter.k, filter.bits.length * 8);
  for (const bit of hashes) {
    const byteIdx = Math.floor(bit / 8);
    const bitIdx = bit % 8;
    const byte = filter.bits[byteIdx];
    if (byte === undefined || (byte & (1 << bitIdx)) === 0) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Serialisation (for transport in subscribe query params)
// ---------------------------------------------------------------------------

/**
 * Serialise a Bloom filter to a base64 string for use in the subscribe endpoint.
 *
 * Format: base64(k_byte || bits...)
 * The first byte encodes k (number of hash functions, 1–255).
 */
export function serializeBloom(filter: BloomFilter): string {
  const buf = new Uint8Array(1 + filter.bits.length);
  buf[0] = filter.k & 0xff;
  buf.set(filter.bits, 1);
  return Buffer.from(buf).toString("base64");
}

/**
 * Deserialise a Bloom filter from a base64 string.
 *
 * @param b64 - Base64-encoded filter string produced by serializeBloom
 */
export function deserializeBloom(b64: string): BloomFilter {
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 2) {
    throw new Error("Bloom filter data too short");
  }
  const k = buf[0]!;
  const bits = new Uint8Array(buf.buffer, 1);
  return { bits, k, count: 0 }; // count is not persisted
}

// ---------------------------------------------------------------------------
// Hash functions (FNV-1a with seed offset)
// ---------------------------------------------------------------------------

/**
 * Compute k bit positions for an item.
 * Uses FNV-1a with a seed offset per hash function for independence.
 *
 * @param item - String to hash
 * @param k - Number of hash positions to compute
 * @param bit_count - Total number of bits in the filter
 */
function _computeHashes(item: string, k: number, bit_count: number): number[] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(item);
  const positions: number[] = [];

  for (let i = 0; i < k; i++) {
    // FNV-1a 32-bit with per-function seed offset
    let h = (2166136261 + i * 16777619) >>> 0;
    for (const byte of bytes) {
      h ^= byte;
      h = Math.imul(h, 16777619) >>> 0;
    }
    positions.push(h % bit_count);
  }

  return positions;
}
