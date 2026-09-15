## Why

The two label modules still show pending labels. Update source/left.mjs and source/right.mjs to export Left ready and Right ready.

## What Changes

The two label modules still show pending labels. Update source/left.mjs and source/right.mjs to export Left ready and Right ready.

## Non-Goals

No changes to the candidate plugin, host configuration, other fixture changes, or external files.

## Decision Boundaries

Only these two source modules may change. Preserve both fixed acceptance checks. This is a reversible two-module change without a public API, build, auth or migration change.
