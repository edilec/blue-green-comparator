# blue-green-comparator

Offline, read-only parity comparison of two complete redacted environment snapshots. It does not switch traffic or deploy.

## Run

Node.js 22+; no dependencies or network calls.

```sh
node bin/blue-green-comparator.mjs --root examples/pass --policy policy.json --blue blue.json --green green.json
node bin/blue-green-comparator.mjs --root examples/fail --policy policy.json --blue blue.json --green green.json
npm run check
```

The CLI emits one JSON report: exit 0=`pass`, 1=`fail`, 2=`incomplete` or invalid configuration. Invalid options, root, or policy leave stdout empty. Unreadable or invalid blue/green inputs produce an incomplete report. Input paths are resolved by realpath beneath `--root`; strict UTF-8 and duplicate decoded JSON keys are enforced. It writes no files.

## Input and exclusions

Policy: `{"schemaVersion":"1","expectedDifferences":["/slotId"]}`. The only supported exclusion is the exact `/slotId` field; a request to exclude database schema or another parity field is invalid configuration. Exclusions are explicitly reported. Optional `metadata` is non-semantic.

Each snapshot is `{"schemaVersion":"1","complete":true,"slotId":"blue","artifactVersion":"1.2.3","configSchema":"v2","databaseSchema":"schema-1","dependencies":[{"name":"cache","version":"1.0.0"}],"migrations":[{"id":"001","checksum":"abc"}]}`. Dependency names and migration IDs are stable identities; their order does not matter. Missing fields, partial snapshots, duplicate identities, or unsupported semantic keys are `incomplete`, never presumed equal. Different artifact versions, config schemas, database schemas, dependency names/versions, or migration IDs/checksums fail. Optional snapshot `metadata` is non-semantic. Diagnostic messages and pointers never echo private values from snapshots.

## Limits and non-goals

Policy ≤65,536 bytes; each snapshot ≤524,288 bytes; ≤1,000 dependencies and ≤1,000 migrations per side; JSON depth ≤16; evaluation deadline 5,000 ms using an injectable monotonic clock. N is accepted and N+1 rejected for each bound. Findings are ordered by UTF-16 code-unit order. This is structural parity of supplied redacted exports, not a live infrastructure audit or proof of runtime equivalence.
