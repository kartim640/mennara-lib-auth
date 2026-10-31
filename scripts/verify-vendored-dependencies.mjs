// Checks that every @mennara/* dependency is the vendored, hash-pinned tarball and nothing else.
// Usage: node scripts/verify-vendored-dependencies.mjs [--installed]
//   --installed  also checks node_modules after `pnpm install` (name, version, exports, files).
// See vendor/README.md. No registry access; reads only files in this repository.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { access, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { gunzipSync } from "node:zlib"

const root = resolve(import.meta.dirname, "..")
const read = (file) => readFile(resolve(root, file), "utf8")
const packageJson = JSON.parse(await read("package.json"))
const manifest = JSON.parse(await read("vendor/manifest.json"))
const lockfile = await read("pnpm-lock.yaml")

assert.equal(manifest.schema, 1, "vendor/manifest.json: unsupported schema")
assert.ok(Array.isArray(manifest.packages) && manifest.packages.length > 0, "manifest lists no packages")

// Reads the regular files of a tarball: 512-byte headers, octal size at 124-136, data padded to 512.
function readTar(tar) {
  const files = new Map()
  const text = (start, end) => tar.subarray(start, end).toString("utf8").replace(/\0.*$/s, "")
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0; ) {
    const name = text(offset, offset + 100)
    const size = parseInt(text(offset + 124, offset + 136).trim(), 8)
    if (tar[offset + 156] === 0x30 || tar[offset + 156] === 0) {
      files.set(name, tar.subarray(offset + 512, offset + 512 + size))
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

const vendored = new Map()
for (const entry of manifest.packages) {
  const label = `${entry.name}@${entry.version}`
  assert.match(entry.name, /^@mennara\//, `${label}: not a @mennara package`)
  assert.equal(entry.file, `${entry.name.replace("@mennara/", "mennara-")}-${entry.version}.tgz`, `${label}: unexpected file name`)
  assert.match(entry.source?.commit ?? "", /^[0-9a-f]{40}$/, `${label}: source.commit must be a full commit`)
  assert.ok(entry.source.repository && entry.build?.node && entry.build?.pnpm && entry.build?.os, `${label}: incomplete provenance`)

  const path = `vendor/${entry.file}`
  await access(resolve(root, path)).catch(() => assert.fail(`${label}: ${path} is missing`))
  const bytes = await readFile(resolve(root, path))
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `${label}: .tgz SHA-256 mismatch`)
  assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, entry.integrity, `${label}: SHA-512 integrity mismatch`)
  const tar = gunzipSync(bytes)
  assert.equal(createHash("sha256").update(tar).digest("hex"), entry.tarSha256, `${label}: uncompressed tar SHA-256 mismatch`)

  const files = readTar(tar)
  assert.deepEqual([...files.keys()].sort(), [...entry.entries].sort(), `${label}: tarball entries differ from the manifest`)
  const inner = JSON.parse(files.get("package/package.json").toString("utf8"))
  assert.equal(inner.name, entry.name, `${label}: package.json name differs`)
  assert.equal(inner.version, entry.version, `${label}: package.json version differs`)
  assert.deepEqual(Object.keys(inner.exports ?? {}), entry.exports, `${label}: package exports differ from the manifest`)
  for (const definition of Object.values(inner.exports)) {
    for (const target of [definition.import, definition.types]) {
      assert.ok(files.has(`package/${target.replace(/^\.\//, "")}`), `${label}: export target ${target} is not in the tarball`)
    }
  }
  vendored.set(entry.name, { entry, path, inner })
}

// package.json: every @mennara/* dependency is exactly the vendored file, nothing is overridden.
const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
const declared = new Map()
for (const section of sections) {
  for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
    if (!name.startsWith("@mennara/")) continue
    assert.ok(vendored.has(name), `${section}.${name} is not in vendor/manifest.json`)
    assert.equal(spec, `file:${vendored.get(name).path}`, `${section}.${name} must be file:${vendored.get(name).path}, found ${spec}`)
    declared.set(name, spec)
  }
}
for (const name of vendored.keys()) assert.ok(declared.has(name), `${name} is vendored but not declared in package.json`)
for (const key of ["overrides", "resolutions"]) {
  for (const holder of [packageJson, packageJson.pnpm ?? {}]) {
    assert.ok(!JSON.stringify(holder[key] ?? {}).includes("@mennara/"), `${key} must not touch @mennara packages`)
  }
}

// Registry settings: none of them may add or redirect a package source.
assert.ok(!existsSync(resolve(root, ".npmrc")), ".npmrc is not allowed: it could redirect the registry")
assert.ok(!existsSync(resolve(root, "pnpm-workspace.yaml")), "pnpm-workspace.yaml is not allowed")
for (const variable of Object.keys(process.env)) {
  assert.ok(!/^npm_config_.*registry$/i.test(variable), `${variable} must not be set`)
}
assert.ok(!packageJson.publishConfig?.registry, "publishConfig.registry must not be set")

// pnpm-lock.yaml: split into package blocks (two-space indent keys) and check every @mennara/* one.
const resolved = new Set()
for (const block of lockfile.split(/\n(?=  \S)/)) {
  const key = block.match(/^\s{2}'?(@mennara\/[^@']+)@/)
  if (!key || !/\n    resolution:/.test(`\n${block}`)) continue
  const { entry, path } = vendored.get(key[1]) ?? assert.fail(`lockfile resolves ${key[1]}, which is not vendored`)
  assert.ok(
    block.includes(`resolution: {integrity: ${entry.integrity}, tarball: file:${path}}`),
    `lockfile: ${key[1]} must resolve to the vendored tarball with the manifest integrity`,
  )
  resolved.add(key[1])
}
for (const name of vendored.keys()) assert.ok(resolved.has(name), `lockfile has no resolution for ${name}`)
for (const line of lockfile.split("\n")) {
  if (line.includes("@mennara/")) {
    assert.doesNotMatch(line, /https?:|git\+|link:|directory:|workspace:/, `lockfile: unexpected source for a @mennara package: ${line.trim()}`)
  }
  const tarball = line.match(/tarball: (\S+?)[,}]/)
  if (tarball) assert.match(tarball[1], /^file:vendor\//, `lockfile: tarball outside vendor/: ${tarball[1]}`)
}
assert.doesNotMatch(lockfile.split("importers:")[0], /registr|catalog/i, "lockfile settings must not set a registry")

if (process.argv.includes("--installed")) {
  for (const [name, { entry }] of vendored) {
    const directory = resolve(root, "node_modules", name)
    assert.ok(existsSync(directory), `${name} is not installed in node_modules`)
    const installed = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"))
    assert.equal(installed.name, name)
    assert.equal(installed.version, entry.version, `${name}: installed version differs`)
    for (const definition of Object.values(installed.exports)) {
      for (const target of [definition.import, definition.types]) await access(resolve(directory, target))
    }
  }
}

console.log(`Vendored dependencies verified (${vendored.size} package${vendored.size === 1 ? "" : "s"}${process.argv.includes("--installed") ? ", installed" : ""}).`)
