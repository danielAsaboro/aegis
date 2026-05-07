#!/usr/bin/env node
/**
 * One-shot QVAC backfill — embed every existing AgentFact / AgentToolCall
 * row that doesn't yet have an embedding. Idempotent: re-running is safe
 * and only touches rows missing an embedding.
 */

import { initDb, closeDb } from '../engine/db/index.mjs';
import { backfillAll } from '../engine/qvac/indexer.mjs';

async function main() {
  await initDb();
  const stats = await backfillAll();
  console.log(JSON.stringify(stats, null, 2));
  await closeDb();
}

main().catch(err => {
  console.error(`backfill failed: ${err.message}`);
  process.exit(1);
});
