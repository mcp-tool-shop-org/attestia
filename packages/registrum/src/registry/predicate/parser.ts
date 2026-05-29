/**
 * Registrum Predicate Expression Parser
 *
 * Parses RPEG v1 expressions into AST nodes.
 *
 * Grammar (EBNF):
 *   expression     ::= or_expr
 *   or_expr        ::= and_expr ( "||" and_expr )*
 *   and_expr       ::= equality_expr ( "&&" equality_expr )*
 *   equality_expr  ::= relational_expr ( ( "==" | "!=" ) relational_expr )*
 *   relational_expr::= unary_expr ( ( ">" | "<" | ">=" | "<=" ) unary_expr )*
 *   unary_expr     ::= "!" unary_expr | primary
 *   primary        ::= literal | identifier | function_call | "(" expression ")"
 *   literal        ::= "true" | "false" | "null" | integer | string
 *   identifier     ::= name ( "." name )*
 *   function_call  ::= identifier "(" argument_list? ")"
 *   argument_list  ::= expression ( "," expression )*
 */

import type { ASTNode, BinaryOperator } from "./ast.js";
import { literal, identifier, binary, unary, call } from "./ast.js";

/**
 * Token types for lexer.
 */
type TokenType =
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "TRUE"
  | "FALSE"
  | "NULL"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "DOT"
  | "EQ"
  | "NEQ"
  | "GT"
  | "LT"
  | "GTE"
  | "LTE"
  | "AND"
  | "OR"
  | "NOT"
  | "EOF";

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

/**
 * Lexer: converts expression string to tokens.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < input.length) {
    // Skip whitespace
    if (/\s/.test(input[pos]!)) {
      pos++;
      continue;
    }

    const start = pos;
    const char = input[pos]!;

    // Two-character operators
    if (pos + 1 < input.length) {
      const twoChar = input.slice(pos, pos + 2);
      if (twoChar === "==") {
        tokens.push({ type: "EQ", value: "==", position: start });
        pos += 2;
        continue;
      }
      if (twoChar === "!=") {
        tokens.push({ type: "NEQ", value: "!=", position: start });
        pos += 2;
        continue;
      }
      if (twoChar === ">=") {
        tokens.push({ type: "GTE", value: ">=", position: start });
        pos += 2;
        continue;
      }
      if (twoChar === "<=") {
        tokens.push({ type: "LTE", value: "<=", position: start });
        pos += 2;
        continue;
      }
      if (twoChar === "&&") {
        tokens.push({ type: "AND", value: "&&", position: start });
        pos += 2;
        continue;
      }
      if (twoChar === "||") {
        tokens.push({ type: "OR", value: "||", position: start });
        pos += 2;
        continue;
      }
    }

    // Single-character tokens
    if (char === "(") {
      tokens.push({ type: "LPAREN", value: "(", position: start });
      pos++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "RPAREN", value: ")", position: start });
      pos++;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "COMMA", value: ",", position: start });
      pos++;
      continue;
    }
    if (char === ".") {
      tokens.push({ type: "DOT", value: ".", position: start });
      pos++;
      continue;
    }
    if (char === ">") {
      tokens.push({ type: "GT", value: ">", position: start });
      pos++;
      continue;
    }
    if (char === "<") {
      tokens.push({ type: "LT", value: "<", position: start });
      pos++;
      continue;
    }
    if (char === "!") {
      tokens.push({ type: "NOT", value: "!", position: start });
      pos++;
      continue;
    }

    // String literals
    if (char === '"') {
      pos++;
      let str = "";
      while (pos < input.length && input[pos] !== '"') {
        if (input[pos] === "\\") {
          pos++;
          if (pos < input.length) {
            str += input[pos];
            pos++;
          }
        } else {
          str += input[pos];
          pos++;
        }
      }
      if (pos >= input.length) {
        throw new ParseError(`Unterminated string at position ${start}`);
      }
      pos++; // Skip closing quote
      tokens.push({ type: "STRING", value: str, position: start });
      continue;
    }

    // Numbers (integers only)
    if (/\d/.test(char) || (char === "-" && pos + 1 < input.length && /\d/.test(input[pos + 1]!))) {
      let num = "";
      if (char === "-") {
        num = "-";
        pos++;
      }
      while (pos < input.length && /\d/.test(input[pos]!)) {
        num += input[pos];
        pos++;
      }
      tokens.push({ type: "NUMBER", value: num, position: start });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      let ident = "";
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos]!)) {
        ident += input[pos];
        pos++;
      }

      if (ident === "true") {
        tokens.push({ type: "TRUE", value: "true", position: start });
      } else if (ident === "false") {
        tokens.push({ type: "FALSE", value: "false", position: start });
      } else if (ident === "null") {
        tokens.push({ type: "NULL", value: "null", position: start });
      } else {
        tokens.push({ type: "IDENTIFIER", value: ident, position: start });
      }
      continue;
    }

    throw new ParseError(`Unexpected character '${char}' at position ${pos}`);
  }

  tokens.push({ type: "EOF", value: "", position: pos });
  return tokens;
}

/**
 * Parse error class.
 *
 * `code` is the stable identifier `"PREDICATE_PARSE"` from the registrum error
 * vocabulary; callers may rely on it across patch/minor releases.
 */
export class ParseError extends Error {
  /** Stable error code: `"PREDICATE_PARSE"`. */
  readonly code = "PREDICATE_PARSE" as const;

  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * Parser class.
 */
class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private current(): Token {
    return this.tokens[this.pos] ?? { type: "EOF", value: "", position: -1 };
  }

  private advance(): Token {
    const token = this.current();
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new ParseError(
        `Expected ${type} but got ${token.type} at position ${token.position}`
      );
    }
    return this.advance();
  }

  parse(): ASTNode {
    const ast = this.parseOrExpr();
    if (this.current().type !== "EOF") {
      throw new ParseError(
        `Unexpected token '${this.current().value}' at position ${this.current().position}`
      );
    }
    return ast;
  }

  private parseOrExpr(): ASTNode {
    let left = this.parseAndExpr();
    while (this.current().type === "OR") {
      this.advance();
      const right = this.parseAndExpr();
      left = binary("||", left, right);
    }
    return left;
  }

  private parseAndExpr(): ASTNode {
    let left = this.parseEqualityExpr();
    while (this.current().type === "AND") {
      this.advance();
      const right = this.parseEqualityExpr();
      left = binary("&&", left, right);
    }
    return left;
  }

  private parseEqualityExpr(): ASTNode {
    let left = this.parseRelationalExpr();
    while (this.current().type === "EQ" || this.current().type === "NEQ") {
      const op: BinaryOperator = this.current().type === "EQ" ? "==" : "!=";
      this.advance();
      const right = this.parseRelationalExpr();
      left = binary(op, left, right);
    }
    return left;
  }

  private parseRelationalExpr(): ASTNode {
    let left = this.parseUnaryExpr();
    while (
      this.current().type === "GT" ||
      this.current().type === "LT" ||
      this.current().type === "GTE" ||
      this.current().type === "LTE"
    ) {
      let op: BinaryOperator;
      switch (this.current().type) {
        case "GT":
          op = ">";
          break;
        case "LT":
          op = "<";
          break;
        case "GTE":
          op = ">=";
          break;
        case "LTE":
          op = "<=";
          break;
        default:
          throw new ParseError("Unexpected operator");
      }
      this.advance();
      const right = this.parseUnaryExpr();
      left = binary(op, left, right);
    }
    return left;
  }

  private parseUnaryExpr(): ASTNode {
    if (this.current().type === "NOT") {
      this.advance();
      const operand = this.parseUnaryExpr();
      return unary("!", operand);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    const token = this.current();

    // Literals
    if (token.type === "TRUE") {
      this.advance();
      return literal(true);
    }
    if (token.type === "FALSE") {
      this.advance();
      return literal(false);
    }
    if (token.type === "NULL") {
      this.advance();
      return literal(null);
    }
    if (token.type === "NUMBER") {
      this.advance();
      return literal(parseInt(token.value, 10));
    }
    if (token.type === "STRING") {
      this.advance();
      return literal(token.value);
    }

    // Parenthesized expression
    if (token.type === "LPAREN") {
      this.advance();
      const expr = this.parseOrExpr();
      this.expect("RPAREN");
      return expr;
    }

    // Identifier or function call
    if (token.type === "IDENTIFIER") {
      return this.parseIdentifierOrCall();
    }

    throw new ParseError(
      `Unexpected token '${token.value}' at position ${token.position}`
    );
  }

  private parseIdentifierOrCall(): ASTNode {
    // Build up the identifier path (e.g., registry.contains_state)
    const path: string[] = [];
    path.push(this.expect("IDENTIFIER").value);

    while (this.current().type === "DOT") {
      this.advance();
      path.push(this.expect("IDENTIFIER").value);
    }

    // Check if this is a function call
    if (this.current().type === "LPAREN") {
      this.advance();
      const args: ASTNode[] = [];

      if (this.current().type !== "RPAREN") {
        args.push(this.parseOrExpr());
        while (this.current().type === "COMMA") {
          this.advance();
          args.push(this.parseOrExpr());
        }
      }

      this.expect("RPAREN");
      return call(path.join("."), args);
    }

    return identifier(path);
  }
}

/**
 * Parse a predicate expression string into an AST.
 */
export function parsePredicate(expression: string): ASTNode {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  return parser.parse();
}
