import type ts from "typescript";

export interface StaticDiagnostic {
  file: string;
  line: number;
  rule: string;
  message: string;
}

export function diagnostic(node: ts.Node, rule: string, message: string): StaticDiagnostic {
  const source = node.getSourceFile();
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName, line: line + 1, rule, message };
}
