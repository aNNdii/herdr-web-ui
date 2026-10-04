import { common, createLowlight } from "lowlight";
import dockerfile from "highlight.js/lib/languages/dockerfile";

import { pathParts } from "./filePaths.ts";
import { memoizeLast } from "./memoizeLast.ts";

/** What a token means, independent of any theme; CSS maps each role to a token color. */
export type SyntaxRole =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "function"
  | "type"
  | "variable"
  | "meta"
  | "inserted"
  | "deleted";

export interface Token {
  text: string;
  /** `null` is plain text. */
  role: SyntaxRole | null;
  emphasis?: "em" | "strong";
}

export interface HighlightResult {
  /**
   * One array of tokens per source line, without the line break. Never has a trailing empty line
   * (a final "\n" ends the last line, it does not start another) and always has at least one line;
   * an empty line is an empty array. A multi-line construct (comment, template string) keeps its
   * role on every line it spans.
   */
  lines: Token[][];
  /** The code is in a registered language but longer than `limit`, so `lines` is plain text. */
  tooLong: boolean;
}

/** Code blocks in chat are highlighted up to this many characters (`limit` counts characters). */
export const CHAT_HIGHLIGHT_LIMIT = 100 * 1024;

const lowlight = createLowlight(common);
lowlight.register({ dockerfile });

// a fence word or a file extension to its registered language
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  sh: "bash", zsh: "bash",
  yml: "yaml",
  py: "python",
  rs: "rust",
  md: "markdown", mkd: "markdown", mdown: "markdown", mkdn: "markdown",
  toml: "ini",
  html: "xml", svg: "xml",
  docker: "dockerfile",
};

// `plaintext` and its highlight.js aliases are registered, but they are no language: a request for
// one must come out as `null`, or a long .txt would be reported "too long to highlight".
const PLAIN_TEXT = new Set(["plaintext", "text", "txt"]);

/** The registered language a lowercase word names (a fence word, an extension), or `null`. */
function languageForWord(word: string): string | null {
  if (!word || PLAIN_TEXT.has(word)) return null;
  const alias = LANGUAGE_ALIASES[word];
  if (alias) return alias;
  return lowlight.registered(word) ? word : null;
}

/**
 * The registered language for a Markdown fence's info string ("ts", "TSX title=x"): only its first
 * word counts, case-insensitively. `null` for an empty, plain-text or unknown one.
 */
export function languageForFence(info: string): string | null {
  return languageForWord(info.trim().split(/\s+/)[0]?.toLowerCase() ?? "");
}

/**
 * The registered language for a file path (either separator), from its name alone, or `null` when
 * there is none. This is the only place that maps file names to languages: "is this file Markdown"
 * is `languageForPath(path) === "markdown"`.
 */
export function languageForPath(path: string): string | null {
  const { stem, extension } = pathParts(path.toLowerCase());
  const name = stem + extension;
  // before the name rules: Dockerfile.md is a document about a Dockerfile
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (name.startsWith("dockerfile")) return "dockerfile";
  if (name === "makefile" || name === "gnumakefile" || name.endsWith(".mk")) return "makefile";
  if ([".bashrc", ".zshrc", ".profile"].includes(name) || name.endsWith(".sh") || name.endsWith(".zsh")) return "bash";
  if (name.startsWith(".env") || name === ".gitignore" || name === ".editorconfig" || name.endsWith(".toml")) return "ini";
  return languageForWord(extension.slice(1));
}

// highlight.js class (without "hljs-") to role. "char" stands for the char.escape scope, which
// highlight.js emits as `hljs-char escape_`.
const CLASS_ROLES: Record<string, SyntaxRole> = {
  keyword: "keyword", built_in: "keyword", literal: "keyword", "selector-tag": "keyword", doctag: "keyword",
  string: "string", regexp: "string", char: "string", "selector-attr": "string", "selector-pseudo": "string", code: "string",
  number: "number", symbol: "number",
  comment: "comment", quote: "comment",
  title: "function", section: "function", name: "function",
  type: "type", class: "type", tag: "type", "selector-class": "type", "selector-id": "type",
  variable: "variable", params: "variable", attr: "variable", attribute: "variable", property: "variable",
  "template-variable": "variable", bullet: "variable", link: "variable",
  meta: "meta",
  addition: "inserted",
  deletion: "deleted",
};

// highlight.js refines `hljs-title` with an unprefixed modifier class.
const MODIFIER_ROLES: Record<string, SyntaxRole> = { function_: "function", class_: "type" };

interface Style {
  role: SyntaxRole | null;
  emphasis?: "em" | "strong";
}

function elementStyle(classes: string[], inherited: Style): Style {
  let role: SyntaxRole | null = null;
  let emphasis = inherited.emphasis;
  for (const name of classes) {
    if (!name.startsWith("hljs-")) continue;
    const base = name.slice(5);
    if (base === "emphasis") emphasis = "em";
    else if (base === "strong") emphasis = "strong";
    else if (role === null) role = CLASS_ROLES[base] ?? null;
  }
  for (const name of classes) {
    const refined = MODIFIER_ROLES[name];
    if (refined && role !== null) role = refined;
  }
  return { role: role ?? inherited.role, emphasis };
}

type HastNode = ReturnType<typeof lowlight.highlight>["children"][number];

function plainLines(code: string): Token[][] {
  return code.split("\n").map((line) => (line === "" ? [] : [{ text: line, role: null }]));
}

function tokenize(code: string, language: string): Token[][] {
  const lines: Token[][] = [[]];
  const append = (text: string, style: Style) => {
    text.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part === "") return;
      const line = lines[lines.length - 1]!;
      const last = line[line.length - 1];
      if (last && last.role === style.role && last.emphasis === style.emphasis) last.text += part;
      else line.push(style.emphasis ? { text: part, role: style.role, emphasis: style.emphasis } : { text: part, role: style.role });
    });
  };
  const walk = (node: HastNode, inherited: Style) => {
    if (node.type === "text") append(node.value, inherited);
    else if (node.type === "element") {
      const className = node.properties?.className;
      const style = Array.isArray(className) ? elementStyle(className.map(String), inherited) : inherited;
      for (const child of node.children) walk(child, style);
    }
  };
  for (const node of lowlight.highlight(language, code).children) walk(node, { role: null });
  return lines;
}

/**
 * Code in `language` that `highlightLines` leaves plain for its length: a registered language above
 * `limit` characters. A host that says "too long" itself (the file viewer, in its header) asks this.
 */
export function tooLongToHighlight(code: string, language: string | null, limit: number): boolean {
  return language !== null && lowlight.registered(language) && code.length > limit;
}

/**
 * Tokenize `code` per line. `limit` counts characters (`code.length`, the raw text with any "\r"),
 * not bytes. Never throws: a null, unknown or unregistered language, code above `limit` (`tooLong`)
 * and any highlighter error all give plain lines. "\r\n" is treated as "\n".
 *
 * The last call is remembered (`memoizeLast`): a file toggled from its Preview to the source and
 * back mounts its code view anew, and tokenizing a megabyte again would cost a quarter second.
 */
export const highlightLines = memoizeLast(function highlightLines(code: string, language: string | null, limit: number): HighlightResult {
  const source = code.replace(/\r\n/g, "\n").replace(/\n$/, "");
  if (language === null || !lowlight.registered(language)) return { lines: plainLines(source), tooLong: false };
  if (tooLongToHighlight(code, language, limit)) return { lines: plainLines(source), tooLong: true };
  try {
    return { lines: tokenize(source, language), tooLong: false };
  } catch {
    return { lines: plainLines(source), tooLong: false };
  }
});
