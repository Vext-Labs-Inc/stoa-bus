# Contributing to stoa-bus

Thank you for your interest in contributing.

## Where the spec lives

The authoritative specification is at [github.com/stoa-spec/stoa-spec](https://github.com/stoa-spec/stoa-spec).
The live state bus is defined in STOA.md §12. All StateDelta types and subscription semantics
in this package must stay in sync with that section.

## Ground rules

- TypeScript strict mode. No `any` without a comment explaining why.
- All public exports must be documented with a JSDoc comment.
- Tests live alongside source in `src/`. Run `npm test` (vitest) before opening a PR.
- Bloom filter implementation in `src/bloom.ts` must be deterministic and cross-language-compatible.

## Opening a PR

1. Fork and branch from `main`.
2. Keep commits atomic — one logical change per commit.
3. Reference the spec section your change corresponds to in the PR description (e.g. "STOA.md §12.2").
4. CI (vitest) must pass.

## Code of conduct

Be direct, be kind, be specific. Maintainer email: agents@tryvext.com
