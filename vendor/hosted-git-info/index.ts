export type HostName = "github" | "bitbucket" | "gitlab" | "gist" | "sourcehut";

export type RepresentationName =
  | "hash"
  | "ssh"
  | "sshurl"
  | "browse"
  | "browseFile"
  | "docs"
  | "bugs"
  | "https"
  | "git"
  | "shortcut"
  | "path"
  | "tarball";

export interface HostedGitOptions {
  noCommittish?: boolean;
  noGitPlus?: boolean;
  committish?: string;
  auth?: string;
  treepath?: string;
  fragment?: string;
}

export interface HostedGitManifest {
  repository?: string | { url?: string | null } | null;
}

interface ExtractedHostData {
  user: string | null;
  project: string;
  committish: string | null;
}

interface HostSpec {
  readonly name: HostName;
  readonly domain: string;
  readonly treepath: string;
  readonly protocols: readonly string[];
  readonly supportsGit: boolean;
  readonly hasBrowseFile: boolean;
  readonly extract: (pathname: string, hash: string) => ExtractedHostData | undefined;
}

const KNOWN_HOST_PROTOCOLS = new Set<string>([
  "github:",
  "bitbucket:",
  "gitlab:",
  "gist:",
  "sourcehut:",
]);

const MAX_CACHE_ENTRIES = 1000;
const urlCache = new Map<string, GitHost | undefined>();

function maybeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function stripLeadingSlashes(value: string): string {
  let i = 0;
  while (i < value.length && value.charCodeAt(i) === 47) {
    i++;
  }
  return i === 0 ? value : value.slice(i);
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return end === value.length ? value : value.slice(0, end);
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function extractHashCommittish(hash: string): string | null | undefined {
  if (!hash) {
    return null;
  }
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) {
    return null;
  }
  return maybeDecode(raw);
}

function extractGithub(pathname: string, hash: string): ExtractedHostData | undefined {
  const cleanPath = stripTrailingSlashes(stripLeadingSlashes(pathname));
  if (!cleanPath) {
    return undefined;
  }
  const segments = cleanPath.split("/");
  if (segments.length < 2) {
    return undefined;
  }
  const user = maybeDecode(segments[0]);
  const rawProject = stripGitSuffix(segments[1]);
  const project = maybeDecode(rawProject);
  if (!user || !project) {
    return undefined;
  }

  let pathCommittish: string | null = null;
  if (segments.length > 2) {
    if (segments[2] !== "tree") {
      return undefined;
    }
    if (segments.length > 3) {
      const joined = segments.slice(3).join("/");
      const decoded = maybeDecode(joined);
      if (decoded === undefined) {
        return undefined;
      }
      pathCommittish = decoded || null;
    }
  }

  const hashCommittish = extractHashCommittish(hash);
  if (hashCommittish === undefined) {
    return undefined;
  }

  return {
    user,
    project,
    committish: hashCommittish ?? pathCommittish,
  };
}

function extractBitbucket(pathname: string, hash: string): ExtractedHostData | undefined {
  const cleanPath = stripTrailingSlashes(stripLeadingSlashes(pathname));
  if (!cleanPath) {
    return undefined;
  }
  const segments = cleanPath.split("/");
  if (segments.length < 2) {
    return undefined;
  }
  if (segments.length > 2 && segments[2] === "get") {
    return undefined;
  }
  const user = maybeDecode(segments[0]);
  const project = maybeDecode(stripGitSuffix(segments[1]));
  if (!user || !project) {
    return undefined;
  }
  const hashCommittish = extractHashCommittish(hash);
  if (hashCommittish === undefined) {
    return undefined;
  }
  return {
    user,
    project,
    committish: hashCommittish,
  };
}

function extractGitlab(pathname: string, hash: string): ExtractedHostData | undefined {
  const cleanPath = stripTrailingSlashes(stripLeadingSlashes(pathname));
  if (!cleanPath) {
    return undefined;
  }
  if (cleanPath.includes("/-/") || cleanPath.endsWith("/archive.tar.gz")) {
    return undefined;
  }
  const segments = cleanPath.split("/");
  if (segments.length < 2) {
    return undefined;
  }
  const rawLast = segments[segments.length - 1];
  const project = maybeDecode(stripGitSuffix(rawLast));
  if (!project) {
    return undefined;
  }
  const decodedGroups: string[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = maybeDecode(segments[i]);
    if (!seg) {
      return undefined;
    }
    decodedGroups.push(seg);
  }
  const user = decodedGroups.join("/");
  const hashCommittish = extractHashCommittish(hash);
  if (hashCommittish === undefined) {
    return undefined;
  }
  return {
    user,
    project,
    committish: hashCommittish,
  };
}

function extractGist(pathname: string, hash: string): ExtractedHostData | undefined {
  const cleanPath = stripTrailingSlashes(stripLeadingSlashes(pathname));
  if (!cleanPath) {
    return undefined;
  }
  const segments = cleanPath.split("/");
  if (segments.length > 2) {
    return undefined;
  }
  let user: string | null = null;
  let rawProject = "";
  if (segments.length === 1) {
    rawProject = segments[0];
  } else {
    if (segments[0] === "raw" || segments[1] === "raw") {
      return undefined;
    }
    const decodedUser = maybeDecode(segments[0]);
    if (!decodedUser) {
      return undefined;
    }
    user = decodedUser;
    rawProject = segments[1];
  }
  const project = maybeDecode(stripGitSuffix(rawProject));
  if (!project) {
    return undefined;
  }
  const hashCommittish = extractHashCommittish(hash);
  if (hashCommittish === undefined) {
    return undefined;
  }
  return {
    user,
    project,
    committish: hashCommittish,
  };
}

function extractSourcehut(pathname: string, hash: string): ExtractedHostData | undefined {
  const cleanPath = stripTrailingSlashes(stripLeadingSlashes(pathname));
  if (!cleanPath) {
    return undefined;
  }
  const segments = cleanPath.split("/");
  if (segments.length < 2) {
    return undefined;
  }
  if (segments.length > 2 && segments[2] === "archive") {
    return undefined;
  }
  const user = maybeDecode(segments[0]);
  const project = maybeDecode(stripGitSuffix(segments[1]));
  if (!user || !project) {
    return undefined;
  }
  const hashCommittish = extractHashCommittish(hash);
  if (hashCommittish === undefined) {
    return undefined;
  }
  return {
    user,
    project,
    committish: hashCommittish,
  };
}

const HOST_SPECS: readonly HostSpec[] = [
  {
    name: "github",
    domain: "github.com",
    treepath: "tree",
    protocols: ["git:", "http:", "git+ssh:", "git+https:", "ssh:", "https:"],
    supportsGit: true,
    hasBrowseFile: true,
    extract: extractGithub,
  },
  {
    name: "bitbucket",
    domain: "bitbucket.org",
    treepath: "src",
    protocols: ["http:", "git+ssh:", "git+https:", "ssh:", "https:"],
    supportsGit: false,
    hasBrowseFile: true,
    extract: extractBitbucket,
  },
  {
    name: "gitlab",
    domain: "gitlab.com",
    treepath: "tree",
    protocols: ["git+ssh:", "git+https:", "ssh:", "https:"],
    supportsGit: false,
    hasBrowseFile: true,
    extract: extractGitlab,
  },
  {
    name: "gist",
    domain: "gist.github.com",
    treepath: "",
    protocols: ["git:", "git+ssh:", "git+https:", "ssh:", "https:"],
    supportsGit: true,
    hasBrowseFile: false,
    extract: extractGist,
  },
  {
    name: "sourcehut",
    domain: "git.sr.ht",
    treepath: "tree",
    protocols: ["git+ssh:", "https:"],
    supportsGit: false,
    hasBrowseFile: true,
    extract: extractSourcehut,
  },
];

function findHostByName(name: string): HostSpec | undefined {
  for (const spec of HOST_SPECS) {
    if (spec.name === name) {
      return spec;
    }
  }
  return undefined;
}

function findHostByDomain(domain: string): HostSpec | undefined {
  const normalized = domain.startsWith("www.") ? domain.slice(4) : domain;
  for (const spec of HOST_SPECS) {
    if (spec.domain === normalized) {
      return spec;
    }
  }
  return undefined;
}

function isGitHubShorthand(arg: string): boolean {
  const hashIdx = arg.indexOf("#");
  const main = hashIdx === -1 ? arg : arg.slice(0, hashIdx);
  if (!main || main.startsWith(".")) {
    return false;
  }
  if (/\s/.test(main)) {
    return false;
  }
  const firstSlash = main.indexOf("/");
  if (firstSlash <= 0 || firstSlash !== main.lastIndexOf("/")) {
    return false;
  }
  if (main.endsWith("/")) {
    return false;
  }
  if (main.includes("@") || main.includes(":")) {
    return false;
  }
  return true;
}

function hasProtocolScheme(url: string): boolean {
  const schemeSep = url.indexOf("://");
  if (schemeSep > 0) {
    const scheme = url.slice(0, schemeSep);
    return /^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(scheme);
  }
  return false;
}

function hasShortcutProtocol(url: string): boolean {
  const colonIdx = url.indexOf(":");
  if (colonIdx <= 0) {
    return false;
  }
  const candidate = `${url.slice(0, colonIdx + 1).toLowerCase()}`;
  return KNOWN_HOST_PROTOCOLS.has(candidate);
}

function normalizeSshPathSeparator(raw: string): string {
  // Handle URLs like `git+ssh://git@github.com:user/repo` where `:` precedes a
  // path rather than a numeric port.
  const schemeIdx = raw.indexOf("://");
  if (schemeIdx === -1) {
    return raw;
  }
  const afterScheme = raw.slice(schemeIdx + 3);
  const hashIdx = afterScheme.indexOf("#");
  const authorityAndPath = hashIdx === -1 ? afterScheme : afterScheme.slice(0, hashIdx);
  const hashSuffix = hashIdx === -1 ? "" : afterScheme.slice(hashIdx);
  const atIdx = authorityAndPath.indexOf("@");
  const hostStart = atIdx === -1 ? 0 : atIdx + 1;
  const slashIdx = authorityAndPath.indexOf("/", hostStart);
  const hostPartEnd = slashIdx === -1 ? authorityAndPath.length : slashIdx;
  const colonIdx = authorityAndPath.indexOf(":", hostStart);
  if (colonIdx !== -1 && colonIdx < hostPartEnd) {
    const maybePortOrPath = authorityAndPath.slice(colonIdx + 1, hostPartEnd);
    if (!/^\d*$/.test(maybePortOrPath)) {
      const fixed =
        raw.slice(0, schemeIdx + 3) +
        authorityAndPath.slice(0, colonIdx) +
        "/" +
        stripLeadingSlashes(authorityAndPath.slice(colonIdx + 1)) +
        hashSuffix;
      return fixed;
    }
  }
  return raw;
}

export function parseUrl(url: string): URL | undefined {
  if (!url || typeof url !== "string") {
    return undefined;
  }
  let candidate = url;
  if (!hasProtocolScheme(url) && !hasShortcutProtocol(url)) {
    const hashIdx = url.indexOf("#");
    const head = hashIdx === -1 ? url : url.slice(0, hashIdx);
    const tail = hashIdx === -1 ? "" : url.slice(hashIdx);
    const scpMatch = /^([^/@\s]+@)([^:/\s]+):(.+)$/.exec(head);
    if (scpMatch) {
      const userInfo = scpMatch[1];
      const host = scpMatch[2];
      const pathPart = stripLeadingSlashes(scpMatch[3]);
      candidate = `ssh://${userInfo}${host}/${pathPart}${tail}`;
    } else {
      return undefined;
    }
  } else if (hasProtocolScheme(url)) {
    candidate = normalizeSshPathSeparator(url);
  }

  try {
    return new URL(candidate);
  } catch {
    return undefined;
  }
}

function protocolToDefault(protocol: string, isScp: boolean): RepresentationName {
  if (KNOWN_HOST_PROTOCOLS.has(protocol)) {
    return "shortcut";
  }
  if (isScp) {
    return "sshurl";
  }
  switch (protocol) {
    case "git:":
      return "git";
    case "ssh:":
    case "git+ssh:":
      return "sshurl";
    default:
      return "https";
  }
}

function mergeOpts(base: HostedGitOptions, override?: HostedGitOptions): HostedGitOptions {
  if (!override) {
    return base;
  }
  return {
    noCommittish: override.noCommittish ?? base.noCommittish,
    noGitPlus: override.noGitPlus ?? base.noGitPlus,
    committish: override.committish ?? base.committish,
    auth: override.auth ?? base.auth,
    treepath: override.treepath ?? base.treepath,
    fragment: override.fragment ?? base.fragment,
  };
}

export class GitHost {
  readonly type: HostName;
  readonly user: string | null;
  readonly auth: string | null;
  readonly project: string;
  readonly committish: string | null;
  readonly default: RepresentationName;
  readonly opts: HostedGitOptions;
  readonly domain: string;
  readonly treepath: string;

  private readonly spec: HostSpec;

  constructor(
    type: HostName,
    user: string | null,
    auth: string | null,
    project: string,
    committish: string | null,
    defaultRepresentation: RepresentationName,
    opts: HostedGitOptions = {}
  ) {
    const spec = findHostByName(type);
    if (!spec) {
      throw new Error(`Unsupported hosted git provider: ${type}`);
    }
    this.spec = spec;
    this.type = type;
    this.user = user;
    this.auth = auth;
    this.project = project;
    this.committish = committish;
    this.default = defaultRepresentation;
    this.opts = { ...opts };
    this.domain = spec.domain;
    this.treepath = spec.treepath;
  }

  static parseUrl(url: string): URL | undefined {
    return parseUrl(url);
  }

  static fromUrl(giturl: string, opts?: HostedGitOptions): GitHost | undefined {
    return fromUrl(giturl, opts);
  }

  static fromManifest(manifest: HostedGitManifest, opts?: HostedGitOptions): GitHost | undefined {
    return fromManifest(manifest, opts);
  }

  private resolveCommittish(opts?: HostedGitOptions): string | null {
    const merged = mergeOpts(this.opts, opts);
    if (merged.noCommittish) {
      return null;
    }
    return merged.committish ?? this.committish;
  }

  private resolveAuth(opts?: HostedGitOptions): string {
    const merged = mergeOpts(this.opts, opts);
    const auth = merged.auth ?? this.auth;
    return auth ? `${auth}@` : "";
  }

  private resolveNoGitPlus(opts?: HostedGitOptions): boolean {
    const merged = mergeOpts(this.opts, opts);
    return Boolean(merged.noGitPlus);
  }

  hash(opts?: HostedGitOptions): string {
    const committish = this.resolveCommittish(opts);
    return committish ? `#${committish}` : "";
  }

  ssh(opts?: HostedGitOptions): string {
    const hash = this.hash(opts);
    if (this.type === "gist") {
      return `git@${this.domain}:/${this.project}.git${hash}`;
    }
    const suffix = this.type === "sourcehut" ? "" : ".git";
    return `git@${this.domain}:${this.user}/${this.project}${suffix}${hash}`;
  }

  sshurl(opts?: HostedGitOptions): string {
    const hash = this.hash(opts);
    const prefix = this.resolveNoGitPlus(opts) ? "" : "git+";
    if (this.type === "gist") {
      return `${prefix}ssh://git@${this.domain}/${this.project}.git${hash}`;
    }
    const suffix = this.type === "sourcehut" ? "" : ".git";
    return `${prefix}ssh://git@${this.domain}/${this.user}/${this.project}${suffix}${hash}`;
  }

  https(opts?: HostedGitOptions): string {
    const hash = this.hash(opts);
    const prefix = this.resolveNoGitPlus(opts) ? "" : "git+";
    const auth = this.resolveAuth(opts);
    if (this.type === "gist") {
      return `${prefix}https://${this.domain}/${this.project}.git${hash}`;
    }
    const suffix = this.type === "sourcehut" ? "" : ".git";
    return `${prefix}https://${auth}${this.domain}/${this.user}/${this.project}${suffix}${hash}`;
  }

  git(opts?: HostedGitOptions): string | undefined {
    if (!this.spec.supportsGit) {
      return undefined;
    }
    const hash = this.hash(opts);
    const auth = this.resolveAuth(opts);
    if (this.type === "gist") {
      return `git://${this.domain}/${this.project}.git${hash}`;
    }
    return `git://${auth}${this.domain}/${this.user}/${this.project}.git${hash}`;
  }

  shortcut(opts?: HostedGitOptions): string {
    const hash = this.hash(opts);
    if (this.type === "gist") {
      return `gist:${this.project}${hash}`;
    }
    return `${this.type}:${this.user}/${this.project}${hash}`;
  }

  path(opts?: HostedGitOptions): string {
    const hash = this.hash(opts);
    if (this.type === "gist") {
      return `${this.project}${hash}`;
    }
    return `${this.user}/${this.project}${hash}`;
  }

  browse(pathOrOpts?: string | HostedGitOptions, maybeOpts?: HostedGitOptions): string {
    let subPath = "";
    let opts: HostedGitOptions | undefined;
    if (typeof pathOrOpts === "string") {
      subPath = stripLeadingSlashes(pathOrOpts);
      opts = maybeOpts;
    } else {
      opts = pathOrOpts;
    }
    const merged = mergeOpts(this.opts, opts);
    const committish = this.resolveCommittish(merged);
    const fragment = merged.fragment ? `#${merged.fragment}` : "";

    let base = "";
    if (this.type === "gist") {
      base = `https://${this.domain}/${this.user ? `${this.user}/` : ""}${this.project}`;
      if (committish) {
        base += `/${committish}`;
      }
      return `${base}${fragment}`;
    }

    base = `https://${this.domain}/${this.user}/${this.project}`;
    if (subPath) {
      const treepath = merged.treepath ?? this.treepath;
      const ref = committish ?? "HEAD";
      return `${base}/${treepath}/${ref}/${subPath}${fragment}`;
    }
    if (committish) {
      return `${base}/${this.treepath}/${committish}${fragment}`;
    }
    return `${base}${fragment}`;
  }

  browseFile(path: string, opts?: HostedGitOptions): string {
    const merged = mergeOpts(this.opts, opts);
    const cleanFile = stripLeadingSlashes(path);
    const committish = this.resolveCommittish(merged) ?? "HEAD";
    const fragment = merged.fragment ? `#${merged.fragment}` : "";

    switch (this.type) {
      case "github":
        return `https://${this.domain}/${this.user}/${this.project}/blob/${committish}/${cleanFile}${fragment}`;
      case "bitbucket":
        return `https://${this.domain}/${this.user}/${this.project}/src/${committish}/${cleanFile}${fragment}`;
      case "gitlab":
        return `https://${this.domain}/${this.user}/${this.project}/-/blob/${committish}/${cleanFile}${fragment}`;
      case "sourcehut":
        return `https://${this.domain}/${this.user}/${this.project}/tree/${committish}/item/${cleanFile}${fragment}`;
      case "gist":
        return `https://${this.domain}/${this.user ? `${this.user}/` : ""}${this.project}${fragment}`;
    }
  }

  docs(opts?: HostedGitOptions): string {
    if (this.type === "gist") {
      return `${this.browse(opts)}#readme`;
    }
    const url = this.browse(opts);
    return url.includes("#") ? url : `${url}#readme`;
  }

  bugs(_opts?: HostedGitOptions): string {
    switch (this.type) {
      case "gist":
        return `https://${this.domain}/${this.user ? `${this.user}/` : ""}${this.project}`;
      case "sourcehut":
        return `https://todo.sr.ht/${this.user}/${this.project}`;
      default:
        return `https://${this.domain}/${this.user}/${this.project}/issues`;
    }
  }

  tarball(opts?: HostedGitOptions): string {
    const committish = this.resolveCommittish(opts) ?? "HEAD";
    switch (this.type) {
      case "github":
        return `https://codeload.github.com/${this.user}/${this.project}/tar.gz/${committish}`;
      case "bitbucket":
        return `https://bitbucket.org/${this.user}/${this.project}/get/${committish}.tar.gz`;
      case "gitlab":
        return `https://gitlab.com/${this.user}/${this.project}/repository/archive.tar.gz?ref=${committish}`;
      case "gist":
        return `https://gist.github.com/${this.user ? `${this.user}/` : ""}${this.project}/archive/${committish}.tar.gz`;
      case "sourcehut":
        return `https://git.sr.ht/${this.user}/${this.project}/archive/${committish}.tar.gz`;
    }
  }

  getDefaultRepresentation(): RepresentationName {
    return this.default;
  }

  toString(opts?: HostedGitOptions): string {
    switch (this.default) {
      case "hash":
        return this.hash(opts);
      case "ssh":
        return this.ssh(opts);
      case "sshurl":
        return this.sshurl(opts);
      case "browse":
        return this.browse(opts);
      case "browseFile":
        return this.browseFile("", opts);
      case "docs":
        return this.docs(opts);
      case "bugs":
        return this.bugs(opts);
      case "https":
        return this.https(opts);
      case "git":
        return this.git(opts) ?? this.https(opts);
      case "shortcut":
        return this.shortcut(opts);
      case "path":
        return this.path(opts);
      case "tarball":
        return this.tarball(opts);
    }
  }
}

function fromUrlInternal(giturl: string, opts?: HostedGitOptions): GitHost | undefined {
  if (!giturl || typeof giturl !== "string") {
    return undefined;
  }

  const isShorthand = isGitHubShorthand(giturl);
  const rawInput = isShorthand ? `github:${giturl}` : giturl;
  const isScp =
    !isShorthand &&
    !hasProtocolScheme(giturl) &&
    !hasShortcutProtocol(giturl) &&
    /^[^/@\s]+@[^:/\s]+:.+$/.test(giturl);

  const parsed = parseUrl(rawInput);
  if (!parsed) {
    return undefined;
  }

  const protocol = parsed.protocol.toLowerCase();
  let spec: HostSpec | undefined;
  if (KNOWN_HOST_PROTOCOLS.has(protocol)) {
    const hostType = protocol.slice(0, -1);
    spec = findHostByName(hostType);
  } else {
    spec = findHostByDomain(parsed.hostname.toLowerCase());
    if (!spec || !spec.protocols.includes(protocol)) {
      return undefined;
    }
  }

  if (!spec) {
    return undefined;
  }

  const extracted = spec.extract(parsed.pathname, parsed.hash);
  if (!extracted) {
    return undefined;
  }

  let auth: string | null = null;
  if (parsed.username && protocol !== "ssh:" && protocol !== "git+ssh:") {
    const userPart = maybeDecode(parsed.username);
    const passPart = parsed.password ? maybeDecode(parsed.password) : "";
    if (userPart !== undefined && passPart !== undefined) {
      auth = parsed.password ? `${userPart}:${passPart}` : userPart;
    }
  }

  const defaultRep = protocolToDefault(protocol, isScp);
  return new GitHost(
    spec.name,
    extracted.user,
    auth,
    extracted.project,
    extracted.committish,
    defaultRep,
    opts
  );
}

export function fromUrl(giturl: string, opts?: HostedGitOptions): GitHost | undefined {
  if (!giturl || typeof giturl !== "string") {
    return undefined;
  }
  const hasOpts = Boolean(
    opts &&
      (opts.noCommittish !== undefined ||
        opts.noGitPlus !== undefined ||
        opts.committish !== undefined ||
        opts.auth !== undefined ||
        opts.treepath !== undefined ||
        opts.fragment !== undefined)
  );
  if (!hasOpts && urlCache.has(giturl)) {
    return urlCache.get(giturl);
  }
  const result = fromUrlInternal(giturl, opts);
  if (!hasOpts) {
    if (urlCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = urlCache.keys().next().value;
      if (oldestKey !== undefined) {
        urlCache.delete(oldestKey);
      }
    }
    urlCache.set(giturl, result);
  }
  return result;
}

export function fromManifest(
  manifest: HostedGitManifest,
  opts?: HostedGitOptions
): GitHost | undefined {
  if (!manifest || typeof manifest !== "object") {
    return undefined;
  }
  const repo = manifest.repository;
  let url: string | null | undefined;
  if (typeof repo === "string") {
    url = repo;
  } else if (repo && typeof repo === "object") {
    url = repo.url;
  }
  if (typeof url !== "string" || !url) {
    return undefined;
  }
  return fromUrl(url, opts);
}

export default GitHost;
