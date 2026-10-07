export const BUCKETS = ['code', 'tests', 'docs', 'config', 'generated_or_data', 'other']
export const DATA_DUMP_LINES = 2000

const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'uv.lock',
  'pipfile.lock', 'cargo.lock', 'composer.lock', 'gemfile.lock', 'go.sum', 'bun.lockb', 'bun.lock',
  'pdm.lock', 'conda-lock.yml', 'packages.lock.json',
])
const VENDOR_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'site-packages',
  'bower_components', 'coverage', '.turbo', '.vercel', '__snapshots__', '.ipynb_checkpoints',
])
const DATA_EXT = new Set([
  'csv', 'tsv', 'parquet', 'feather', 'pkl', 'pickle', 'h5', 'hdf5', 'xlsx', 'xls', 'sqlite', 'sqlite3',
  'db', 'npy', 'npz', 'jsonl', 'ndjson', 'arrow', 'avro', 'orc', 'joblib', 'log', 'ipynb', 'snap',
])
const SIZE_RULE_EXT = new Set(['json', 'geojson', 'xml', 'yaml', 'yml', 'txt', 'sql', 'html', 'htm', 'svg'])
const DOC_EXT = new Set(['md', 'mdx', 'markdown', 'html', 'htm', 'txt', 'rst', 'adoc', 'asciidoc', 'tex', 'org'])
const DOC_NAMES = new Set(['license', 'readme', 'changelog', 'notice', 'authors', 'contributing', 'copying'])
const CONFIG_EXT = new Set([
  'json', 'json5', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'env', 'xml',
  'plist', 'editorconfig', 'csproj', 'sln', 'props', 'targets', 'gradle',
])
const CONFIG_NAMES = new Set([
  'dockerfile', 'makefile', 'procfile', 'pipfile', 'codeowners', 'gemfile', 'justfile', 'containerfile',
])
const CODE_EXT = new Set([
  'py', 'pyi', 'pyx', 'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'go', 'rs', 'java', 'kt', 'kts',
  'scala', 'c', 'h', 'cpp', 'hpp', 'cc', 'hh', 'cxx', 'cs', 'fs', 'vb', 'rb', 'php', 'swift', 'm', 'mm',
  'sql', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'psd1', 'bat', 'cmd', 'r', 'jl', 'lua', 'vue', 'svelte', 'astro',
  'css', 'scss', 'sass', 'less', 'dart', 'proto', 'graphql', 'gql', 'hcl', 'tf', 'pl', 'ex', 'exs', 'erl',
  'hs', 'clj', 'groovy', 'vbs', 'ahk', 'nim', 'zig', 'sol', 'wgsl', 'glsl', 'hlsl', 'kql', 'dax', 'cu',
])
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', '__mocks__', 'testing'])
const DATA_DIRS = new Set(['docs', 'runs', 'data', 'research', 'outputs'])
const DATA_DIR_EXT = new Set(['json', 'html', 'htm'])
const HTML_EXT = new Set(['html', 'htm'])
const WEB_DIRS = new Set(['templates', 'static', 'app', 'web', 'src'])
const MARKDOWN_EXT = new Set(['md', 'mdx', 'markdown', 'rst'])

export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/'
        re += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else re += '[^/]*'
    } else if (ch === '?') re += '[^/]'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

export class PathClassifier {
  constructor({ excludeGlobs = [], dirDepth = 2 } = {}) {
    this.excludes = excludeGlobs.map(globToRegExp)
    this.dirDepth = dirDepth
  }

  isExcluded(path) {
    const norm = path.replace(/\\/g, '/')
    return this.excludes.some((re) => re.test(norm))
  }

  classify(path, linesChanged = 0) {
    const norm = path.replace(/\\/g, '/')
    const lower = norm.toLowerCase()
    const segments = lower.split('/')
    const base = segments[segments.length - 1]
    const dirs = segments.slice(0, -1)
    const dot = base.lastIndexOf('.')
    const ext = dot > 0 ? base.slice(dot + 1) : ''
    const stem = dot > 0 ? base.slice(0, dot) : base

    if (this.excludes.some((re) => re.test(norm))) return 'generated_or_data'
    if (isGenerated(lower, base, ext, dirs)) return 'generated_or_data'
    if (DATA_EXT.has(ext)) return 'generated_or_data'
    if (DATA_DIR_EXT.has(ext) && dirs.some((d) => DATA_DIRS.has(d))) return 'generated_or_data'
    if (HTML_EXT.has(ext) && dirs.some((d) => WEB_DIRS.has(d))) return 'code'
    if (SIZE_RULE_EXT.has(ext) && linesChanged > DATA_DUMP_LINES) return 'generated_or_data'
    if (MARKDOWN_EXT.has(ext)) return 'docs'
    if (isTest(base, dirs)) return 'tests'
    if (isConfigName(base, stem, ext)) return 'config'
    if (DOC_EXT.has(ext) || (!ext && DOC_NAMES.has(stem))) return 'docs'
    if (CONFIG_EXT.has(ext)) return 'config'
    if (CODE_EXT.has(ext)) return 'code'
    return 'other'
  }

  dirKey(path) {
    const parts = path.replace(/\\/g, '/').split('/').slice(0, -1)
    return parts.length ? parts.slice(0, this.dirDepth).join('/') : '.'
  }
}

function isGenerated(lower, base, ext, dirs) {
  if (LOCKFILES.has(base) || ext === 'lock') return true
  if (dirs.some((d) => VENDOR_DIRS.has(d))) return true
  if (/\.min\.(js|css|mjs)$/.test(base) || ext === 'map') return true
  if (/\.generated\.|_pb2(_grpc)?\.pyi?$|\.pb\.go$|\.g\.dart$|\.designer\.cs$/.test(base)) return true
  if (/(^|\/)meta\/\d+_snapshot\.json$|(^|\/)meta\/_journal\.json$/.test(lower)) return true
  return false
}

function isTest(base, dirs) {
  if (dirs.some((d) => TEST_DIRS.has(d))) return true
  if (/\.(test|spec)\.[a-z0-9]+$/.test(base)) return true
  if (/^test_.+\.py$|_test\.(py|go|rs|rb|ts|js)$|^conftest\.py$|tests?\.(cs|java|kt)$/.test(base)) return true
  return false
}

function isConfigName(base, stem, ext) {
  if (CONFIG_NAMES.has(base) || CONFIG_NAMES.has(stem)) return true
  if (/^requirements.*\.(txt|in)$|^constraints.*\.txt$/.test(base)) return true
  if (/\.config\.(js|ts|mjs|cjs|mts)$|^\.[a-z]+rc(\.(js|cjs|json|ya?ml))?$/.test(base)) return true
  if (base.startsWith('.env') || base === '.gitignore' || base === '.gitattributes' || base === '.dockerignore') return true
  if (base === '.gitmodules' || base === '.nvmrc' || base === '.npmrc' || base === '.python-version') return true
  return ext === 'toml' && stem === 'pyproject'
}
