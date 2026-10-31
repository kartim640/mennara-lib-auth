// Builds the package tarball that apps vendor, and prints its provenance entry.
// sha256/integrity pin the exact .tgz (what a consumer's lockfile verifies). tarSha256 hashes the
// uncompressed tar: gzip output differs between Node/zlib builds, the tar content does not.
// Usage: node scripts/pack-tarball.mjs <output-directory>
// See docs/PACKING.md. The tarball is only as trustworthy as the checkout it came from,
// so this refuses a dirty tree and records the exact commit.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { arch, platform } from "node:os"
import { resolve } from "node:path"
import { gunzipSync } from "node:zlib"

const packageDirectory = resolve(import.meta.dirname, "..")
const outputDirectory = process.argv[2] ? resolve(process.argv[2]) : undefined
assert.ok(outputDirectory, "Usage: node scripts/pack-tarball.mjs <output-directory>")

const run = (command, args) =>
  execFileSync(command, args, { cwd: packageDirectory, encoding: "utf8" }).trim()

assert.equal(run("git", ["status", "--porcelain", "--untracked-files=no"]), "", "working tree has tracked changes")
const commit = run("git", ["rev-parse", "HEAD"])

await mkdir(outputDirectory, { recursive: true })
assert.deepEqual(await readdir(outputDirectory), [], "output directory must be empty")
// "prepack" runs the build, so the tarball always holds a fresh dist.
run("pnpm", ["pack", "--pack-destination", outputDirectory])

const files = await readdir(outputDirectory)
assert.equal(files.length, 1, `expected exactly one tarball, found: ${files.join(", ")}`)
const [file] = files
const bytes = await readFile(resolve(outputDirectory, file))
const packageJson = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"))
const manifest = JSON.parse(await readFile(resolve(packageDirectory, "vendor/manifest.json"), "utf8"))

const tar = gunzipSync(bytes)
const contents = new Map()
// tar: 512-byte headers (name at 0-100, octal size at 124-136), data padded to 512.
for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0; ) {
  const text = (start, end) => tar.subarray(offset + start, offset + end).toString("utf8").replace(/\0.*$/s, "")
  const size = parseInt(text(124, 136).trim(), 8)
  if (tar[offset + 156] === 0x30 || tar[offset + 156] === 0) {
    contents.set(text(0, 100), tar.subarray(offset + 512, offset + 512 + size).toString("utf8"))
  }
  offset += 512 + Math.ceil(size / 512) * 512
}
const entries = [...contents.keys()].sort()
const read = (name) => contents.get(`package/${name.replace(/^\.\//, "")}`)

// Only package metadata and dist: no vendor/ folder, no node_modules, no bundled @mennara/http.
for (const required of ["package.json", "README.md", "CHANGELOG.md"]) {
  assert.ok(read(required) !== undefined, `tarball is missing ${required}`)
}
assert.ok(
  entries.every((name) => /^package\/(package\.json|README\.md|CHANGELOG\.md|dist\/.+)$/.test(name)),
  `tarball holds unexpected files: ${entries.join(", ")}`,
)

const packed = JSON.parse(read("package.json"))
assert.equal(packed.name, packageJson.name)
assert.equal(packed.version, packageJson.version)
assert.deepEqual(packed.exports, packageJson.exports, "packed exports differ from package.json")
for (const [subpath, definition] of Object.entries(packed.exports)) {
  assert.ok(read(definition.import)?.trim(), `${subpath}: ${definition.import} is missing or empty`)
  assert.ok(read(definition.types)?.trim(), `${subpath}: ${definition.types} is missing or empty`)
}

// The HTTP dependency stays a declared, vendored dependency; it is never copied into this package.
const [http] = manifest.packages.filter((entry) => entry.name === "@mennara/http")
assert.ok(http, "vendor/manifest.json has no @mennara/http entry")
assert.deepEqual(packed.dependencies, { "@mennara/http": `file:vendor/${http.file}` }, "packed dependencies changed")
assert.ok(!packed.bundleDependencies && !packed.bundledDependencies, "bundled dependencies are not allowed")
const javascript = entries.filter((name) => name.endsWith(".js"))
assert.ok(
  javascript.some((name) => /from\s*["']@mennara\/http["']/.test(contents.get(name))),
  "dist no longer imports @mennara/http as an external module",
)
for (const name of javascript) {
  // Error strings defined only inside @mennara/http: finding one means its code was bundled.
  assert.doesNotMatch(contents.get(name), /Network request failed|request_timeout/, `${name} bundles @mennara/http code`)
}

const entry = {
  name: packageJson.name,
  version: packageJson.version,
  file,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  tarSha256: createHash("sha256").update(tar).digest("hex"),
  entries,
  exports: Object.keys(packed.exports),
  dependencies: packed.dependencies,
  source: { commit },
  build: {
    node: process.version,
    pnpm: run("pnpm", ["--version"]),
    os: `${platform()}-${arch()}`,
  },
}

await writeFile(resolve(outputDirectory, `${file}.provenance.json`), `${JSON.stringify(entry, null, 2)}\n`)
console.log(JSON.stringify(entry, null, 2))
