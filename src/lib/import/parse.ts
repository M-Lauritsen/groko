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
}

export interface ParseResult {
  blocks: ParsedBlock[];
  warnings: string[];
}

class Parser {
  private tokens: Token[];
  private pos = 0;
  warnings: string[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
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
        `Expected ${type} at ${t.line}:${t.col}, got ${t.type} (${t.value})`
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
            ["resource", "data", "module", "locals", "variable", "output", "terraform", "provider"].includes(
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
        this.parseBody();
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

  private parseValue(): HclValue {
    const t = this.peek();

    if (t.type === "STRING" || t.type === "HEREDOC") {
      this.consume();
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
      return this.parseExpression();
    }
    if (t.type === "LPAREN") {
      // parenthesized expression — capture raw
      return { __expr: this.captureBalanced("LPAREN", "RPAREN") };
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
  const parser = new Parser(tokens);
  let blocks: ParsedBlock[] = [];
  try {
    blocks = parser.parseFile();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    parser.warnings.push(`Fatal parse error${sourceHint ? ` in ${sourceHint}` : ""}: ${msg}`);
  }
  if (sourceHint) {
    for (const b of blocks) b.sourceHint = sourceHint;
  }
  return { blocks, warnings: parser.warnings };
}

export function parseHclFiles(
  files: { name: string; content: string }[]
): ParseResult {
  const all: ParsedBlock[] = [];
  const warnings: string[] = [];
  for (const f of files) {
    const r = parseHcl(f.content, f.name);
    all.push(...r.blocks);
    warnings.push(...r.warnings.map((w) => `${f.name}: ${w}`));
  }
  return { blocks: all, warnings };
}
