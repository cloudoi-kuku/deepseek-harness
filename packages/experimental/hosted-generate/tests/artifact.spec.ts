import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectArtifact } from '../src/artifact.ts'
import { HostedGenerateError } from '../src/error.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-generate-artifact-'))
  roots.push(root)
  return root
}

describe('collectArtifact', () => {
  it('returns posix-relative UTF-8 files and skips hidden, vendor, and binary paths', async () => {
    const root = await workspace()
    await mkdir(join(root, 'css'))
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await mkdir(join(root, '.secret'))
    await writeFile(join(root, 'index.html'), '<h1>ok</h1>')
    await writeFile(join(root, 'css', 'app.css'), 'body{}')
    await writeFile(join(root, '.env'), 'SECRET=1')
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports=1')
    await writeFile(join(root, '.secret', 'x.txt'), 'no')
    await writeFile(join(root, 'logo.bin'), Buffer.from([0xff, 0xfe, 0x00]))

    await expect(collectArtifact(root, {
      maxArtifactBytes: 10_000,
      maxFiles: 8,
      maxFileBytes: 10_000,
    })).resolves.toEqual({
      'index.html': '<h1>ok</h1>',
      'css/app.css': 'body{}',
    })
  })

  it('rejects a single file over maxFileBytes', async () => {
    const root = await workspace()
    await writeFile(join(root, 'big.html'), 'abcdef')
    await expect(collectArtifact(root, {
      maxArtifactBytes: 100,
      maxFiles: 8,
      maxFileBytes: 4,
    })).rejects.toMatchObject<Partial<HostedGenerateError>>({
      code: 'GENERATE_TOO_LARGE',
    })
  })

  it('rejects when the file count cap is crossed', async () => {
    const root = await workspace()
    await writeFile(join(root, 'a.html'), 'a')
    await writeFile(join(root, 'b.html'), 'b')
    await expect(collectArtifact(root, {
      maxArtifactBytes: 100,
      maxFiles: 1,
      maxFileBytes: 10,
    })).rejects.toMatchObject<Partial<HostedGenerateError>>({
      code: 'GENERATE_TOO_LARGE',
    })
  })

  it('skips directory-symlink escapes that resolve outside the workspace', async () => {
    const root = await workspace()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-generate-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.txt'), 'nope')
    await symlink(outside, join(root, 'escape'))
    await writeFile(join(root, 'ok.html'), 'ok')
    await expect(collectArtifact(root, {
      maxArtifactBytes: 10_000,
      maxFiles: 8,
      maxFileBytes: 10_000,
    })).resolves.toEqual({ 'ok.html': 'ok' })
  })

  it('rejects when the total byte cap is crossed', async () => {
    const root = await workspace()
    await writeFile(join(root, 'a.html'), 'aaaa')
    await writeFile(join(root, 'b.html'), 'bbbb')
    await expect(collectArtifact(root, {
      maxArtifactBytes: 6,
      maxFiles: 8,
      maxFileBytes: 10,
    })).rejects.toMatchObject<Partial<HostedGenerateError>>({
      code: 'GENERATE_TOO_LARGE',
    })
  })
})
