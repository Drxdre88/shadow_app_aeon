import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRepos, reposFilePath, resolveRepo } from './registry.js'

const dirs: string[] = []
const originalFile = process.env.KAIROS_REPOS_FILE

function withRegistry(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-registry-'))
  dirs.push(dir)
  const file = join(dir, name)
  writeFileSync(file, contents, 'utf8')
  process.env.KAIROS_REPOS_FILE = file
  return file
}

afterEach(() => {
  if (originalFile === undefined) delete process.env.KAIROS_REPOS_FILE
  else process.env.KAIROS_REPOS_FILE = originalFile
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('loadRepos (yaml)', () => {
  it('reads slugs, paths, branches and env setup commands', () => {
    withRegistry('repos.local.yaml', [
      'repos:',
      '  aeon:',
      '    path: C:/Users/dev/shadow_app_aeon',
      '    defaultBranch: main',
      '    envSetupCmd: null',
      '  swarm:',
      '    path: D:/code/swarm',
      '',
    ].join('\n'))

    expect(loadRepos()).toEqual({
      aeon: {
        slug: 'aeon',
        path: 'C:/Users/dev/shadow_app_aeon',
        defaultBranch: 'main',
        envSetupCmd: null,
        link: [],
        copy: [],
      },
      swarm: { slug: 'swarm', path: 'D:/code/swarm', defaultBranch: 'main', envSetupCmd: null, link: [], copy: [] },
    })
  })

  it('strips trailing comments without eating a hash inside a path', () => {
    withRegistry('repos.local.yaml', [
      '# machine-local registry',
      'repos:',
      '  hashy:',
      '    path: C:/x#y   # the runner host keeps this odd folder name',
      '    defaultBranch: trunk',
      '',
    ].join('\n'))

    expect(loadRepos().hashy).toEqual({
      slug: 'hashy',
      path: 'C:/x#y',
      defaultBranch: 'trunk',
      envSetupCmd: null,
      link: [],
      copy: [],
    })
  })

  it('strips surrounding quotes from scalars', () => {
    withRegistry('repos.local.yaml', [
      'repos:',
      '  quoted:',
      '    path: "C:/Program Files/repo"',
      "    defaultBranch: 'develop'",
      '    envSetupCmd: "nvm use 22"',
      '',
    ].join('\n'))

    expect(loadRepos().quoted).toEqual({
      slug: 'quoted',
      path: 'C:/Program Files/repo',
      defaultBranch: 'develop',
      envSetupCmd: 'nvm use 22',
      link: [],
      copy: [],
    })
  })

  it('splits link/copy csv scalars into trimmed lists', () => {
    withRegistry('repos.local.yaml', [
      'repos:',
      '  seeded:',
      '    path: C:/code/seeded',
      '    link: node_modules, apps/web/node_modules',
      '    copy: apps/web/.env.local',
      '',
    ].join('\n'))

    expect(loadRepos().seeded.link).toEqual(['node_modules', 'apps/web/node_modules'])
    expect(loadRepos().seeded.copy).toEqual(['apps/web/.env.local'])
  })

  it('skips entries with no path — an unusable repo must not be claimable', () => {
    withRegistry('repos.local.yaml', [
      'repos:',
      '  ghost:',
      '    defaultBranch: main',
      '  nulled:',
      '    path: ~',
      '  real:',
      '    path: C:/code/real',
      '',
    ].join('\n'))

    const repos = loadRepos()
    expect(Object.keys(repos)).toEqual(['real'])
    expect(resolveRepo('ghost')).toBeNull()
    expect(resolveRepo('real')?.path).toBe('C:/code/real')
  })

  it('ignores keys outside the repos block', () => {
    withRegistry('repos.local.yaml', [
      'version: 1',
      'other:',
      '  decoy:',
      '    path: C:/nope',
      'repos:',
      '  aeon:',
      '    path: C:/code/aeon',
      '',
    ].join('\n'))

    expect(Object.keys(loadRepos())).toEqual(['aeon'])
  })

  it('returns nothing when the registry file is absent', () => {
    process.env.KAIROS_REPOS_FILE = join(tmpdir(), 'aeon-registry-does-not-exist.yaml')
    expect(loadRepos()).toEqual({})
    expect(resolveRepo('aeon')).toBeNull()
    expect(resolveRepo(null)).toBeNull()
  })
})

describe('loadRepos (json)', () => {
  it('parses a .json registry through the JSON branch', () => {
    withRegistry('repos.local.json', JSON.stringify({
      repos: {
        aeon: { path: 'C:/code/aeon', defaultBranch: 'main', envSetupCmd: 'npm ci' },
        broken: { defaultBranch: 'main' },
      },
    }))

    const repos = loadRepos()
    expect(Object.keys(repos)).toEqual(['aeon'])
    expect(repos.aeon).toEqual({
      slug: 'aeon',
      path: 'C:/code/aeon',
      defaultBranch: 'main',
      envSetupCmd: 'npm ci',
      link: [],
      copy: [],
    })
  })
})

describe('reposFilePath', () => {
  it('honours KAIROS_REPOS_FILE and defaults to the worker directory', () => {
    const file = withRegistry('repos.local.yaml', 'repos:\n')
    expect(reposFilePath()).toBe(file)
    delete process.env.KAIROS_REPOS_FILE
    expect(reposFilePath().replace(/\\/g, '/')).toMatch(/kairos-worker\/repos\.local\.yaml$/)
  })
})

describe('slug safety', () => {
  it('never resolves a slug through the prototype chain', () => {
    withRegistry('repos.local.yaml', [
      'repos:',
      '  aeon:',
      '    path: C:/code/aeon',
      '',
    ].join('\n'))

    // a bare repos[slug] would hand back Object.prototype members as a repo
    for (const slug of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(resolveRepo(slug)).toBeNull()
    }
    expect(resolveRepo('aeon')?.path).toBe('C:/code/aeon')
  })

  it('drops a registry key that is not a plain path component', () => {
    withRegistry('repos.local.json', JSON.stringify({
      repos: {
        '..': { path: 'C:/code/up' },
        '.hidden': { path: 'C:/code/hidden' },
        '-flag': { path: 'C:/code/flag' },
        '__proto__': { path: 'C:/code/proto' },
        good: { path: 'C:/code/good' },
      },
    }))

    expect(Object.keys(loadRepos())).toEqual(['good'])
    expect(resolveRepo('..')).toBeNull()
    expect(resolveRepo('__proto__')).toBeNull()
    expect(resolveRepo('good')?.path).toBe('C:/code/good')
  })

  it('accepts the slug shapes the operator actually uses', () => {
    withRegistry('repos.local.json', JSON.stringify({
      repos: {
        aeon: { path: 'C:/a' },
        shadow_app_aeon: { path: 'C:/b' },
        'kal-el': { path: 'C:/c' },
        'repo.v2': { path: 'C:/d' },
      },
    }))

    expect(Object.keys(loadRepos()).sort()).toEqual(['aeon', 'kal-el', 'repo.v2', 'shadow_app_aeon'])
  })
})
