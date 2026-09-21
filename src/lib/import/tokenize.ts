/**
 * Lightweight HCL-ish tokenizer for Terraform resource/data blocks.
 * Not a full HCL2 lexer — enough for simple azurerm roots.
 */

export type TokenType =
  | "IDENT"
  | "STRING"
  | "NUMBER"
  | "BOOL"
  | "EQUALS"
  | "LBRACE"
  | "RBRACE"
  | "LBRACK"
  | "RBRACK"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "DOT"
  | "QUESTION"
  | "COLON"
  | "OPERATOR"
  | "HEREDOC"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const peek = (n = 0) => input[i + n] ?? "";
  const advance = () => {
    const ch = input[i++];
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  const push = (type: TokenType, value: string, startLine: number, startCol: number) => {
    tokens.push({ type, value, line: startLine, col: startCol });
  };

  while (i < input.length) {
    const startLine = line;
    const startCol = col;
    const ch = peek();

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Line comment #
    if (ch === "#") {
      while (i < input.length && peek() !== "\n") advance();
      continue;
    }

    // Line / block comments // and /* */
    if (ch === "/" && peek(1) === "/") {
      advance();
      advance();
      while (i < input.length && peek() !== "\n") advance();
      continue;
    }
    if (ch === "/" && peek(1) === "*") {
      advance();
      advance();
      while (i < input.length && !(peek() === "*" && peek(1) === "/")) advance();
      if (peek() === "*") {
        advance();
        advance();
      }
      continue;
    }

    // Heredoc <<-?WORD ... WORD
    if (ch === "<" && peek(1) === "<") {
      advance();
      advance();
      let strip = false;
      if (peek() === "-") {
        strip = true;
        advance();
      }
      let marker = "";
      while (/[A-Za-z0-9_]/.test(peek())) marker += advance();
      if (!marker) {
        // treat << as unknown — skip one char already consumed; push orphan
        push("IDENT", "<<", startLine, startCol);
        continue;
      }
      // consume rest of line
      while (i < input.length && peek() !== "\n") advance();
      if (peek() === "\n") advance();
      let body = "";
      while (i < input.length) {
        const lineStart = i;
        let curLine = "";
        while (i < input.length && peek() !== "\n") curLine += advance();
        if (peek() === "\n") advance();
        const compare = strip ? curLine.replace(/^\s+/, "") : curLine;
        if (compare === marker) break;
        body += (body ? "\n" : "") + curLine;
        void lineStart;
      }
      push("HEREDOC", body, startLine, startCol);
      continue;
    }

    // String
    if (ch === '"') {
      advance();
      let value = "";
      while (i < input.length && peek() !== '"') {
        if (peek() === "\\" && i + 1 < input.length) {
          advance();
          const esc = advance();
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === '"') value += '"';
          else if (esc === "\\") value += "\\";
          else value += esc;
        } else {
          value += advance();
        }
      }
      if (peek() === '"') advance();
      push("STRING", value, startLine, startCol);
      continue;
    }

    // Number (incl. negative / float)
    if (
      (ch >= "0" && ch <= "9") ||
      (ch === "-" && peek(1) >= "0" && peek(1) <= "9")
    ) {
      let value = "";
      if (ch === "-") value += advance();
      while ((peek() >= "0" && peek() <= "9") || peek() === ".") value += advance();
      push("NUMBER", value, startLine, startCol);
      continue;
    }

    // Ident / bool / keywords
    if (/[A-Za-z_]/.test(ch)) {
      let value = "";
      while (/[A-Za-z0-9_-]/.test(peek())) value += advance();
      if (value === "true" || value === "false") {
        push("BOOL", value, startLine, startCol);
      } else {
        push("IDENT", value, startLine, startCol);
      }
      continue;
    }

    // Operators must remain tokens so unsupported expressions can be skipped intact.
    const operator = [">=", "<=", "==", "!=", "&&", "||"].find((candidate) => input.startsWith(candidate, i));
    if (operator) {
      for (let index = 0; index < operator.length; index++) advance();
      push("OPERATOR", operator, startLine, startCol);
      continue;
    }
    if ("+-*/%<>!".includes(ch)) {
      advance();
      push("OPERATOR", ch, startLine, startCol);
      continue;
    }

    // Single-char tokens
    const singles: Record<string, TokenType> = {
      "=": "EQUALS",
      "{": "LBRACE",
      "}": "RBRACE",
      "[": "LBRACK",
      "]": "RBRACK",
      "(": "LPAREN",
      ")": "RPAREN",
      ",": "COMMA",
      ".": "DOT",
      "?": "QUESTION",
      ":": "COLON",
    };
    if (singles[ch]) {
      advance();
      push(singles[ch], ch, startLine, startCol);
      continue;
    }

    // Skip unknown characters.
    advance();
  }

  push("EOF", "", line, col);
  return tokens;
}
