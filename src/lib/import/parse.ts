/**
 * Pragmatic Terraform HCL parser for resource / data / module blocks
 * and simple attribute assignments (scalars, lists, objects, refs).
 */

import { tokenize, type Token, type TokenType } from "./tokenize";

export type HclValue =
  | string
  | number
  | boolean
  | null
  | HclValue[]
  | { [key: string]: HclValue }
  | { __ref: string }
  | { __expr: string }
  | { __raw_block: true; type: string; body: HclBody };

export interface HclBody {
  attrs: Record<string, HclValue>;
  blocks: { type: string; labels: string[]; body: HclBody }[];
  /** Raw attribute keys that used for_each / count / complex expressions */
  meta?: { hasForEach?: boolean; hasCount?: boolean };
}

export interface ParsedBlock {
  kind: "resource" | "data" | "module" | "other";
  type: string;
  name: string;
  labels: string[];
  body: HclBody;
  sourceHint?: string;
  sourceIndex?: number;
  /** Transient upload root used to prevent cross-root reference binding. */
  sourceRoot?: string;
  /** Transient module expansion diagnostic; never enters the domain model. */
  moduleReason?: string;
}

export interface ParseResult {
  blocks: ParsedBlock[];
  warnings: string[];
  warningUploadIndexes?: Array<number | null>;
  uploadPaths?: string[];
}

class Parser {
  private tokens: Token[];
  private pos = 0;
  private allowTopLevelAssignments: boolean;
  warnings: string[] = [];

  constructor(tokens: Token[], allowTopLevelAssignments = false) {
    this.tokens = tokens;
    this.allowTopLevelAssignments = allowTopLevelAssignments;
  }

  private peek(n = 0): Token {
    return this.tokens[Math.min(this.pos + n, this.tokens.length - 1)];
  }

  private at(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private consume(type?: TokenType): Token {
    const t = this.peek();
    if (type && t.type !== type) {
      throw new Error(
        `Expected ${type} at ${t.line}:${t.col}, got ${t.type}`
      );
    }
    this.pos++;
    return t;
  }

  private tryConsume(type: TokenType): Token | null {
    if (this.at(type)) return this.consume();
    return null;
  }

  parseFile(): ParsedBlock[] {
    const blocks: ParsedBlock[] = [];
    while (!this.at("EOF")) {
      try {
        const b = this.parseTopLevel();
        if (b) blocks.push(b);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.warnings.push(`Parse error: ${msg}`);
        // Skip to next top-level keyword-ish by advancing one token
        this.pos++;
        // Try to resync at next resource/data/module
        while (
          !this.at("EOF") &&
          !(
            this.at("IDENT") &&
            ["resource", "data", "module", "locals", "variable", "output", "terraform", "provider", "import"].includes(
              this.peek().value
            )
          )
        ) {
          // if we see a lone RBRACE, consume it to unwind
          if (this.at("RBRACE")) {
            this.consume();
            break;
          }
          this.pos++;
        }
      }
    }
    return blocks;
  }

  private parseTopLevel(): ParsedBlock | null {
    if (!this.at("IDENT")) {
      this.pos++;
      return null;
    }
    const kw = this.peek().value;
    if (kw === "resource" || kw === "data") {
      this.consume("IDENT");
      const typeTok = this.consume("STRING");
      const nameTok = this.consume("STRING");
      const body = this.parseBody();
      return {
        kind: kw,
        type: typeTok.value,
        name: nameTok.value,
        labels: [typeTok.value, nameTok.value],
        body,
      };
    }
    if (kw === "module") {
      this.consume("IDENT");
      const nameTok = this.consume("STRING");
      const body = this.parseBody();
      return {
        kind: "module",
        type: "module",
        name: nameTok.value,
        labels: [nameTok.value],
        body,
      };
    }
    if (kw === "import") {
      this.consume("IDENT");
      this.skipBody();
      return null;
    }
    // locals / variable / output / terraform / provider — skip body
    if (
      ["locals", "variable", "output", "terraform", "provider"].includes(kw)
    ) {
      this.consume("IDENT");
      const labels: string[] = [];
      while (this.at("STRING") || (this.at("IDENT") && this.peek(1).type !== "LBRACE" && this.peek(1).type !== "EQUALS")) {
        if (this.at("STRING")) labels.push(this.consume("STRING").value);
        else labels.push(this.consume("IDENT").value);
        if (labels.length > 3) break;
      }
      // provider "azurerm" { } or variable "x" { }
      if (this.at("LBRACE")) {
        const body = kw === "variable"
          ? this.parseVariableBody()
          : kw === "locals"
            ? this.parseLocalsBody()
            : this.parseBody();
        return {
          kind: "other",
          type: kw,
          name: labels[0] ?? kw,
          labels,
          body,
        };
      } else if (this.at("EQUALS")) {
        this.consume("EQUALS");
        this.parseValue();
      }
      return {
        kind: "other",
        type: kw,
        name: labels[0] ?? kw,
        labels,
        body: { attrs: {}, blocks: [] },
      };
    }

    if (this.allowTopLevelAssignments && this.peek(1).type === "EQUALS") {
      this.consume("IDENT");
      this.consume("EQUALS");
      return {
        kind: "other",
        type: "tfvars",
        name: kw,
        labels: [kw],
        body: { attrs: { [kw]: this.parseValue() }, blocks: [] },
      };
    }

    // Unknown top-level — skip token
    this.pos++;
    return null;
  }

  private parseBody(): HclBody {
    this.consume("LBRACE");
    const attrs: Record<string, HclValue> = {};
    const blocks: HclBody["blocks"] = [];
    const meta: HclBody["meta"] = {};

    while (!this.at("RBRACE") && !this.at("EOF")) {
      if (!this.at("IDENT")) {
        // stray token inside body
        this.pos++;
        continue;
      }
      const keyTok = this.consume("IDENT");
      const key = keyTok.value;

      if (this.at("EQUALS")) {
        this.consume("EQUALS");
        if (key === "for_each") meta.hasForEach = true;
        if (key === "count") meta.hasCount = true;
        attrs[key] = this.parseValue();
      } else if (this.at("LBRACE")) {
        // nested block without labels
        const nested = this.parseBody();
        blocks.push({ type: key, labels: [], body: nested });
      } else if (this.at("STRING")) {
        // nested block with labels: lifecycle { } already handled;
        // e.g. dynamic "setting" { } or provisioner "local-exec"
        const labels: string[] = [];
        while (this.at("STRING")) labels.push(this.consume("STRING").value);
        if (this.at("LBRACE")) {
          const nested = this.parseBody();
          blocks.push({ type: key, labels, body: nested });
        } else {
          this.warnings.push(
            `Unexpected tokens after block type "${key}" at ${keyTok.line}:${keyTok.col}`
          );
        }
      } else {
        this.warnings.push(
          `Unexpected token after "${key}" at ${keyTok.line}:${keyTok.col}`
        );
        this.pos++;
      }
    }
    this.tryConsume("RBRACE");
    return { attrs, blocks, meta };
  }

  /** Variables are configuration inputs, not domain resources; retain only defaults. */
  private parseVariableBody(): HclBody {
    this.consume("LBRACE");
    const attrs: Record<string, HclValue> = {};
    let depth = 1;
    while (!this.at("EOF") && depth > 0) {
      if (depth === 1 && this.at("IDENT") && this.peek().value === "default" && this.peek(1).type === "EQUALS") {
        this.consume("IDENT");
        this.consume("EQUALS");
        attrs.default = this.parseValue();
        continue;
      }
      const token = this.consume();
      if (token.type === "LBRACE") depth++;
      if (token.type === "RBRACE") depth--;
    }
    return { attrs, blocks: [] };
  }

  /** Locals are transient aliases only; complex configuration must not enter resolver state. */
  private parseLocalsBody(): HclBody {
    const body = this.parseBody();
    const attrs = Object.fromEntries(
      Object.entries(body.attrs).filter(([name, value]) => {
        if (isSafeLocalValue(value)) return true;
        this.warnings.push(
          `Configuration ignored: local "${name}" is not a static scalar alias`
        );
        return false;
      })
    );
    return { ...body, attrs };
  }

  private skipBody(): void {
    if (!this.at("LBRACE")) return;
    let depth = 0;
    do {
      const token = this.consume();
      if (token.type === "LBRACE") depth++;
      if (token.type === "RBRACE") depth--;
    } while (!this.at("EOF") && depth > 0);
  }

  private parseValue(): HclValue {
    const t = this.peek();

    if (t.type === "STRING" || t.type === "HEREDOC") {
      this.consume();
      if (t.value.includes("${")) return { __expr: t.value };
      return t.value;
    }
    if (t.type === "NUMBER") {
      this.consume();
      const n = Number(t.value);
      return Number.isFinite(n) ? n : t.value;
    }
    if (t.type === "BOOL") {
      this.consume();
      return t.value === "true";
    }
    if (t.type === "LBRACK") {
      return this.parseList();
    }
    if (t.type === "LBRACE") {
      return this.parseObject();
    }
    if (t.type === "IDENT") {
      if (t.value === "null") {
        this.consume("IDENT");
        return null;
      }
      return this.parseExpression();
    }
    if (t.type === "LPAREN") {
      const start = this.pos;
      const expression = this.captureBalanced("LPAREN", "RPAREN");
      if (this.at("QUESTION") || this.at("OPERATOR")) {
        this.pos = start;
        return { __expr: this.captureExpression() };
      }
      return { __expr: expression };
    }

    this.warnings.push(`Unsupported value at ${t.line}:${t.col} (${t.type})`);
    this.pos++;
    return null;
  }

  private parseList(): HclValue[] {
    this.consume("LBRACK");
    const items: HclValue[] = [];
    while (!this.at("RBRACK") && !this.at("EOF")) {
      items.push(this.parseValue());
      this.tryConsume("COMMA");
    }
    this.tryConsume("RBRACK");
    return items;
  }

  private parseObject(): { [key: string]: HclValue } {
    this.consume("LBRACE");
    const obj: { [key: string]: HclValue } = {};
    while (!this.at("RBRACE") && !this.at("EOF")) {
      let key: string;
      if (this.at("IDENT") || this.at("STRING")) {
        key = this.consume().value;
      } else {
        this.pos++;
        continue;
      }
      // HCL objects use = ; JSON-like : sometimes appears — accept both by skipping
      if (this.at("EQUALS")) this.consume("EQUALS");
      else if (this.peek().value === ":") this.pos++; // unlikely
      obj[key] = this.parseValue();
      this.tryConsume("COMMA");
    }
    this.tryConsume("RBRACE");
    return obj;
  }

  /**
   * Ident expressions: refs (type.name.attr), function calls, var.x, local.x, etc.
   */
  private parseExpression(): HclValue {
    const start = this.pos;
    const startTok = this.peek();

    // function call: ident(
    if (this.at("IDENT") && this.peek(1).type === "LPAREN") {
      const name = this.consume("IDENT").value;
      const inner = this.captureBalanced("LPAREN", "RPAREN");
      if (this.at("QUESTION") || this.at("OPERATOR")) {
        this.pos = start;
        return { __expr: this.captureExpression() };
      }
      return { __expr: `${name}${inner}` };
    }

    // Build dotted / indexed path: azurerm_rg.main.name  or data.azurerm_rg.x.id
    let expr = this.consume("IDENT").value;
    while (this.at("DOT") || this.at("LBRACK")) {
      if (this.at("DOT")) {
        this.consume("DOT");
        if (this.at("IDENT")) {
          expr += "." + this.consume("IDENT").value;
        } else if (this.at("NUMBER")) {
          expr += "." + this.consume("NUMBER").value;
        } else {
          break;
        }
      } else {
        // index [0] or ["key"]
        expr += this.captureBalanced("LBRACK", "RBRACK");
      }
    }

    // Trailing function? uncommon after path
    if (this.at("LPAREN")) {
      expr += this.captureBalanced("LPAREN", "RPAREN");
      return { __expr: expr };
    }

    if (this.at("QUESTION") || this.at("OPERATOR")) {
      this.pos = start;
      return { __expr: this.captureExpression() };
    }

    // Classify simple resource / data references
    if (isSimpleRef(expr)) {
      return { __ref: expr };
    }
    if (
      expr.startsWith("var.") ||
      expr.startsWith("local.") ||
      expr.startsWith("module.") ||
      expr.startsWith("each.") ||
      expr.startsWith("count.") ||
      expr.startsWith("path.") ||
      expr.startsWith("terraform.")
    ) {
      return { __expr: expr };
    }

    // true/false already handled; bare ident — treat as expr
    void start;
    void startTok;
    return { __expr: expr };
  }

  /** Capture unsupported expressions without consuming a list, object, or body delimiter. */
  private captureExpression(): string {
    const parts: string[] = [];
    let depth = 0;
    while (!this.at("EOF")) {
      if (
        depth === 0 &&
        (this.at("COMMA") || this.at("RBRACE") || this.at("RBRACK"))
      ) {
        break;
      }
      if (
        depth === 0 &&
        this.at("IDENT") &&
        this.peek(1).type === "EQUALS"
      ) {
        break;
      }
      const token = this.consume();
      if (token.type === "LPAREN" || token.type === "LBRACK" || token.type === "LBRACE") depth++;
      if (token.type === "RPAREN" || token.type === "RBRACK" || token.type === "RBRACE") depth--;
      parts.push(formatToken(token));
    }
    return parts.join("");
  }

  /** Capture from current open token through matching close, inclusive. */
  private captureBalanced(open: TokenType, close: TokenType): string {
    const parts: string[] = [];
    this.consume(open);
    parts.push(open === "LPAREN" ? "(" : open === "LBRACK" ? "[" : "{");
    let depth = 1;
    while (!this.at("EOF") && depth > 0) {
      const t = this.peek();
      if (t.type === open) depth++;
      if (t.type === close) depth--;
      if (depth === 0) {
        this.consume();
        parts.push(close === "RPAREN" ? ")" : close === "RBRACK" ? "]" : "}");
        break;
      }
      parts.push(formatToken(t));
      this.consume();
    }
    return parts.join("");
  }
}

function formatToken(t: Token): string {
  switch (t.type) {
    case "STRING":
      return JSON.stringify(t.value);
    case "DOT":
      return ".";
    case "QUESTION":
      return "?";
    case "COLON":
      return ":";
    case "OPERATOR":
      return t.value;
    case "COMMA":
      return ",";
    case "EQUALS":
      return " = ";
    case "LBRACE":
      return "{";
    case "RBRACE":
      return "}";
    case "LBRACK":
      return "[";
    case "RBRACK":
      return "]";
    case "LPAREN":
      return "(";
    case "RPAREN":
      return ")";
    default:
      return t.value;
  }
}

const REF_ATTRS = new Set([
  "id",
  "name",
  "location",
  "resource_group_name",
  "login_server",
  "admin_username",
  "principal_id",
  "vault_uri",
  "primary_access_key",
  "connection_string",
  "instrumentation_key",
]);

/** type.name.attr  or  data.type.name.attr */
export function isSimpleRef(expr: string): boolean {
  const parts = expr.split(".");
  if (parts[0] === "data") {
    return (
      parts.length === 4 &&
      /^[a-zA-Z_][\w-]*$/.test(parts[1]) &&
      /^[a-zA-Z_][\w-]*$/.test(parts[2]) &&
      REF_ATTRS.has(parts[3])
    );
  }
  return (
    parts.length === 3 &&
    /^[a-zA-Z_][\w-]*$/.test(parts[0]) &&
    /^[a-zA-Z_][\w-]*$/.test(parts[1]) &&
    REF_ATTRS.has(parts[2])
  );
}

export function parseHcl(source: string, sourceHint?: string): ParseResult {
  const tokens = tokenize(source);
  const parser = new Parser(tokens, sourceHint?.toLowerCase().endsWith(".tfvars"));
  let blocks: ParsedBlock[] = [];
  try {
    blocks = parser.parseFile();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    parser.warnings.push(`Fatal parse error: ${msg}`);
  }
  if (sourceHint) {
    for (const b of blocks) b.sourceHint = sourceHint;
  }
  return { blocks, warnings: parser.warnings };
}

export function parseHclFiles(
  files: { name: string; content: string }[],
  selectedRootProfile?: string
): ParseResult {
  const parsedFiles: Array<{ path: string; blocks: ParsedBlock[] }> = [];
  const warnings: string[] = [];
  const warningUploadIndexes: Array<number | null> = [];
  for (const [sourceIndex, f] of files.entries()) {
    const r = parseHcl(f.content, f.name);
    for (const block of r.blocks) block.sourceIndex = sourceIndex;
    parsedFiles.push({ path: normalizePath(f.name), blocks: r.blocks });
    warnings.push(...r.warnings.map((w) => `${f.name}: ${w}`));
    warningUploadIndexes.push(...r.warnings.map(() => sourceIndex));
  }

  const filesByDirectory = new Map<string, ParsedBlock[]>();
  for (const file of parsedFiles) {
    const directory = pathDirectory(file.path);
    const blocks = filesByDirectory.get(directory) ?? [];
    blocks.push(...file.blocks);
    filesByDirectory.set(directory, blocks);
  }

  const moduleDirectories = new Set<string>();
  for (const file of parsedFiles) {
    for (const block of file.blocks) {
      if (block.kind !== "module") continue;
      const source = block.body.attrs.source;
      if (typeof source !== "string" || !isLocalModuleSource(source)) continue;
      const target = resolveLocalModulePath(pathDirectory(file.path), source);
      if (target !== null && filesByDirectory.has(target)) moduleDirectories.add(target);
    }
  }

  const expanded: ParsedBlock[] = [];
  const rootModuleNameCounts = new Map<string, number>();
  for (const [directory, blocks] of filesByDirectory) {
    if (moduleDirectories.has(directory)) continue;
    for (const block of blocks) {
      if (block.kind === "module") {
        rootModuleNameCounts.set(
          block.name,
          (rootModuleNameCounts.get(block.name) ?? 0) + 1
        );
      }
    }
  }
  for (const [rootDirectory, rootBlocks] of filesByDirectory) {
    if (moduleDirectories.has(rootDirectory)) continue;
    const rootProfilePaths = new Set<string>();
    for (const block of rootBlocks) {
      if (block.kind !== "other" || block.type !== "tfvars") continue;
      if (block.sourceHint) rootProfilePaths.add(normalizePath(block.sourceHint));
    }
    const selectedProfile = selectedRootProfile
      ? normalizePath(selectedRootProfile)
      : undefined;
    const activeRootBlocks = rootBlocks.filter(
      (block) =>
        block.kind !== "other" ||
        block.type !== "tfvars" ||
        (selectedProfile
          ? normalizePath(block.sourceHint ?? "") === selectedProfile
          : rootProfilePaths.size <= 1)
    );
    if (!selectedProfile && rootProfilePaths.size > 1) {
      const rootLabel = rootDirectory || ".";
      warnings.push(
        `${rootLabel}: multiple root .tfvars profiles were found; select one profile to resolve aliases`
      );
      warningUploadIndexes.push(null);
    }
    const rootScope = createStaticValueResolver(activeRootBlocks);
    const rootExpanded: ParsedBlock[] = [];
    const moduleOutputs = new Map<string, HclValue>();
    for (const block of rootBlocks) {
      if (block.kind !== "module") {
        rootExpanded.push(rewriteStaticAliasesInBlock(block, rootScope));
        continue;
      }
      const expandedModule = expandModule(
        block,
        rootDirectory,
        rootModuleNameCounts.get(block.name) === 1
          ? block.name
          : `${rootDirectory.replace(/[^A-Za-z0-9_]/g, "_")}__${block.name}`,
        filesByDirectory,
        new Set(),
        rootScope,
        block.name
      );
      rootExpanded.push(...expandedModule.blocks);
      for (const [name, value] of expandedModule.outputs) {
        moduleOutputs.set(name, value);
      }
    }
    expanded.push(...rootExpanded.map((block) => ({
      ...rewriteModuleOutputsInBlock(block, moduleOutputs),
      sourceRoot: rootDirectory,
    })));
  }
  return {
    blocks: expanded,
    warnings,
    warningUploadIndexes,
    uploadPaths: files.map((file) => file.name),
  };
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function pathDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function isLocalModuleSource(source: string): boolean {
  return source.startsWith("./") || source.startsWith("../");
}

function resolveLocalModulePath(directory: string, source: string): string | null {
  const segments = [...(directory ? directory.split("/") : []), ...source.split("/")];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

interface ExpandedModule {
  blocks: ParsedBlock[];
  outputs: Map<string, HclValue>;
}

type StaticScalar = string | number | boolean | null;

interface StaticValueResolver {
  resolve(value: HclValue): StaticScalar | undefined;
}

function createStaticValueResolver(
  blocks: ParsedBlock[],
  argumentsByName: Record<string, HclValue> = {},
  includeTfvars = true,
  ignoredTfvars = new Set<string>()
): StaticValueResolver {
  const defaults = new Map<string, HclValue>();
  const assignments = new Map<string, HclValue>();
  const locals = new Map<string, HclValue>();

  for (const block of blocks) {
    if (block.kind !== "other") continue;
    if (block.type === "variable" && block.labels[0] && block.body.attrs.default !== undefined) {
      defaults.set(block.labels[0], block.body.attrs.default);
    }
    if (includeTfvars && block.type === "tfvars") {
      for (const [name, value] of Object.entries(block.body.attrs)) {
        if (!ignoredTfvars.has(name)) assignments.set(name, value);
      }
    }
    if (block.type === "locals") {
      for (const [name, value] of Object.entries(block.body.attrs)) locals.set(name, value);
    }
  }

  const variables = new Map(defaults);
  for (const [name, value] of assignments) variables.set(name, value);
  for (const [name, value] of Object.entries(argumentsByName)) variables.set(name, value);
  const resolving = new Set<string>();

  function resolve(value: HclValue): StaticScalar | undefined {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      return value;
    }
    if (!isExpressionValue(value)) return undefined;
    const match = /^(var|local)\.([A-Za-z_][\w-]*)$/.exec(value.__expr);
    if (!match) return undefined;
    const key = `${match[1]}.${match[2]}`;
    if (resolving.has(key)) return undefined;
    const candidate = match[1] === "var" ? variables.get(match[2]) : locals.get(match[2]);
    if (candidate === undefined) return undefined;
    resolving.add(key);
    const resolved = resolve(candidate);
    resolving.delete(key);
    return resolved;
  }

  return { resolve };
}

function expandModule(
  block: ParsedBlock,
  directory: string,
  prefix: string,
  filesByDirectory: Map<string, ParsedBlock[]>,
  visited: Set<string>,
  parentScope?: StaticValueResolver,
  outputPrefix = prefix
): ExpandedModule {
  if (block.body.meta?.hasForEach || block.body.meta?.hasCount) {
    return {
      blocks: [{ ...block, moduleReason: block.body.meta.hasForEach ? "Module calls using for_each are not supported" : "Module calls using count are not supported" }],
      outputs: new Map(),
    };
  }
  const source = block.body.attrs.source;
  if (typeof source !== "string") {
    return {
      blocks: [{ ...block, moduleReason: "Module source must be a static local path" }],
      outputs: new Map(),
    };
  }
  if (!isLocalModuleSource(source)) {
    return {
      blocks: [{ ...block, moduleReason: `Module source \"${source}\" is remote; only uploaded local modules are expanded` }],
      outputs: new Map(),
    };
  }
  const target = resolveLocalModulePath(directory, source);
  if (target === null || !filesByDirectory.has(target)) {
    return {
      blocks: [{ ...block, moduleReason: `Local module source \"${source}\" was not found in the upload` }],
      outputs: new Map(),
    };
  }
  if (visited.has(target)) {
    return {
      blocks: [{ ...block, moduleReason: `Local module source \"${source}\" forms a module cycle` }],
      outputs: new Map(),
    };
  }

  const nextVisited = new Set(visited).add(target);
  const moduleBlocks = filesByDirectory.get(target) ?? [];
  const argumentsByName = Object.fromEntries(
    Object.entries(block.body.attrs).map(([name, value]) => [
      name,
      parentScope?.resolve(value) ?? value,
    ])
  );
  const moduleScope = createStaticValueResolver(moduleBlocks, argumentsByName, false);
  const names = new Map<string, string>();
  for (const child of moduleBlocks) {
    if (child.kind === "resource" || child.kind === "data") {
      names.set(`${child.kind}:${child.type}:${child.name}`, `${prefix}__${child.name}`);
    }
  }

  const result: ParsedBlock[] = [];
  const outputs = new Map<string, HclValue>();
  for (const child of moduleBlocks) {
    if (child.kind === "resource" || child.kind === "data") {
      result.push({
        ...child,
        name: names.get(`${child.kind}:${child.type}:${child.name}`) ?? child.name,
        labels: child.labels.map((label, index) => index === child.labels.length - 1 ? (names.get(`${child.kind}:${child.type}:${child.name}`) ?? label) : label),
        body: rewriteBody(child.body, argumentsByName, names, moduleScope),
        sourceHint: block.sourceHint,
        sourceIndex: block.sourceIndex,
      });
    } else if (child.kind === "module") {
      const nested = {
        ...child,
        body: rewriteBody(child.body, argumentsByName, names, moduleScope),
        sourceHint: block.sourceHint,
        sourceIndex: block.sourceIndex,
      };
      const nestedModule = expandModule(
        nested,
        target,
        `${prefix}__${child.name}`,
        filesByDirectory,
        nextVisited,
        moduleScope,
        `${outputPrefix}__${child.name}`
      );
      result.push(...nestedModule.blocks);
      for (const [name, value] of nestedModule.outputs) {
        outputs.set(name, value);
      }
    } else if (child.kind === "other" && child.type === "output") {
      const value = child.body.attrs.value;
      if (value !== undefined) {
        outputs.set(
          `module.${outputPrefix}.${child.name}`,
          rewriteValue(value, argumentsByName, names, moduleScope)
        );
      }
    }
  }
  return { blocks: result, outputs };
}

function rewriteModuleOutputsInBlock(
  block: ParsedBlock,
  moduleOutputs: Map<string, HclValue>
): ParsedBlock {
  return {
    ...block,
    body: rewriteModuleOutputsInBody(block.body, moduleOutputs),
  };
}

function rewriteModuleOutputsInBody(
  body: HclBody,
  moduleOutputs: Map<string, HclValue>
): HclBody {
  return {
    attrs: Object.fromEntries(
      Object.entries(body.attrs).map(([key, value]) => [
        key,
        rewriteModuleOutputValue(value, moduleOutputs),
      ])
    ),
    blocks: body.blocks.map((block) => ({
      ...block,
      body: rewriteModuleOutputsInBody(block.body, moduleOutputs),
    })),
    meta: body.meta ? { ...body.meta } : undefined,
  };
}

function rewriteModuleOutputValue(
  value: HclValue,
  moduleOutputs: Map<string, HclValue>
): HclValue {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteModuleOutputValue(item, moduleOutputs));
  }
  if (isExpressionValue(value) || isReferenceValue(value)) {
    const output = moduleOutputs.get(
      isExpressionValue(value) ? value.__expr : value.__ref
    );
    return output ? rewriteModuleOutputValue(output, moduleOutputs) : value;
  }
  if (
    value &&
    typeof value === "object" &&
    !isReferenceValue(value) &&
    !("__raw_block" in value)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewriteModuleOutputValue(item, moduleOutputs),
      ])
    );
  }
  return value;
}

function rewriteBody(
  body: HclBody,
  argumentsByName: Record<string, HclValue>,
  names: Map<string, string>,
  staticScope?: StaticValueResolver
): HclBody {
  return {
    attrs: Object.fromEntries(Object.entries(body.attrs).map(([key, value]) => [key, rewriteValue(value, argumentsByName, names, staticScope)])),
    blocks: body.blocks.map((block) => ({
      ...block,
      body: rewriteBody(block.body, argumentsByName, names, staticScope),
    })),
    meta: body.meta ? { ...body.meta } : undefined,
  };
}

function isExpressionValue(value: HclValue): value is { __expr: string } {
  return typeof value === "object" && value !== null && "__expr" in value && typeof value.__expr === "string";
}

function isReferenceValue(value: HclValue): value is { __ref: string } {
  return typeof value === "object" && value !== null && "__ref" in value && typeof value.__ref === "string";
}

function rewriteValue(
  value: HclValue,
  argumentsByName: Record<string, HclValue>,
  names: Map<string, string>,
  staticScope?: StaticValueResolver
): HclValue {
  const staticValue = staticScope?.resolve(value);
  if (staticValue !== undefined) return staticValue;
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, argumentsByName, names, staticScope));
  if (isExpressionValue(value) && /^var\.[A-Za-z_][\w-]*$/.test(value.__expr)) {
    const argument = argumentsByName[value.__expr.slice(4)];
    if (
      isStaticScalar(argument) ||
      isReferenceValue(argument) ||
      isModuleOutputReference(argument)
    ) {
      return argument;
    }
    return value;
  }
  if (isReferenceValue(value)) {
    const parts = value.__ref.split(".");
    const isData = parts[0] === "data";
    const type = isData ? parts[1] : parts[0];
    const name = isData ? parts[2] : parts[1];
    const renamed = names.get(`${isData ? "data" : "resource"}:${type}:${name}`);
    if (renamed) {
      const offset = isData ? 2 : 1;
      parts[offset] = renamed;
      return { __ref: parts.join(".") };
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value) && !("__expr" in value) && !("__ref" in value) && !("__raw_block" in value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteValue(item, argumentsByName, names, staticScope)]));
  }
  return value;
}

function isStaticScalar(value: HclValue | undefined): value is StaticScalar {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function isSafeLocalValue(value: HclValue): boolean {
  return (
    isStaticScalar(value) ||
    (isExpressionValue(value) && /^(var|local)\.[A-Za-z_][\w-]*$/.test(value.__expr))
  );
}

function isModuleOutputReference(
  value: HclValue | undefined
): value is { __expr: string } {
  return (
    value !== undefined &&
    isExpressionValue(value) &&
    /^module\.[A-Za-z_][\w-]*\.[A-Za-z_][\w-]*$/.test(value.__expr)
  );
}

function rewriteStaticAliasesInBlock(
  block: ParsedBlock,
  staticScope?: StaticValueResolver
): ParsedBlock {
  if (!staticScope) return block;
  return {
    ...block,
    body: rewriteBody(block.body, {}, new Map(), staticScope),
  };
}
