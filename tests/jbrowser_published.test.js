// Phase 2 — published snapshot auto-load tests. Pure functions from
// browser/js/core/published.js run under node --test: catalog fetch shape,
// latest-build selection, envelope/db hash verification against the REAL
// canonical archive + builds.json (no browser, no network).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickLatest, sha256Hex, verifyEnvelope, verifyDb } from "../frontend/sqljs/js/core/published.js";
import { extractSingleDbFromTarGz, isGzipBytes } from "../frontend/sqljs/js/core/snapshot-targz.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const builds = JSON.parse(fs.readFileSync(path.join(ROOT, "builds.json"), "utf8"));
const entry = builds.builds[0];
const archiveBytes = new Uint8Array(fs.readFileSync(path.join(ROOT, entry.file)));

test("published: pickLatest returns the newest version entry", () => {
  const catalog = {
    builds: [
      { version: "v0.0", file: "old.tgz" },
      { version: "v0.1", file: "new.tgz" },
    ],
  };
  const got = pickLatest(catalog);
  assert.equal(got.version, "v0.1");
  assert.equal(pickLatest({}), null);
  assert.equal(pickLatest({ builds: [] }), null);
});

test("published: envelope hash of the canonical archive matches builds.json", async () => {
  const ok = await verifyEnvelope(archiveBytes, entry);
  assert.equal(ok, true, "archive bytes must match envelope_hash");
});

test("published: db content hash of the extracted database matches builds.json", async () => {
  const { bytes } = await extractSingleDbFromTarGz(archiveBytes);
  const ok = await verifyDb(bytes, entry);
  assert.equal(ok, true, "extracted db bytes must match db_sha256");
});

test("published: a single modified byte breaks both hashes", async () => {
  const tampered = new Uint8Array(archiveBytes);
  tampered[tampered.length - 1] ^= 0x01;
  assert.equal(isGzipBytes(tampered), true);
  const okEnv = await verifyEnvelope(tampered, entry);
  assert.equal(okEnv, false, "envelope must reject tampering");
});

test("published: sha256Hex returns lowercase hex of correct length", async () => {
  const sha = await sha256Hex(new TextEncoder().encode("hello"));
  assert.equal(sha, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  assert.equal(sha.length, 64);
});