// Agreed C3PA Explorer snapshot schema constant (§6b.10 / §7b.9).
// Phase 1 (Colab notebook generator) embeds the identical literal into the
// snapshot's embedded `manifest` table; the Phase 2 boot validates every picked
// snapshot against this value.
"use strict";

export const SNAPSHOT_SCHEMA_VERSION = "c3pa-explorer-snapshot-v1";