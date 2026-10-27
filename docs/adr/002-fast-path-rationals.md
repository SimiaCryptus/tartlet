# ADR-002: Rationals with a small-integer fast path

**Status:** accepted (G0)

A `Rational` holds either two JS numbers (both within ±(2³¹−1)) or two bigints. Operations
compute in doubles only while every intermediate stays within `Number.MAX_SAFE_INTEGER`, and
otherwise use bigint. Results are normalised and demoted back to numbers when they fit.

The fast path is tested differentially against a naive bigint reference on every operation.
The denominator ceiling (10⁹) is enforced by the query budget from T1.