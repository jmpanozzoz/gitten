import ts from "typescript";
import { diagnostic, type StaticDiagnostic } from "./static-diagnostic";

const limits = {
  "function-lines": 50,
  "class-lines": 200,
  complexity: 10,
  depth: 3,
  parameters: 4,
} as const;

export function findCodeLimitViolations(source: ts.SourceFile): StaticDiagnostic[] {
  const violations: StaticDiagnostic[] = [];

  function check(node: ts.Node, rule: keyof typeof limits, measured: number): void {
    const limit = limits[rule];
    if (measured > limit) {
      violations.push(diagnostic(node, rule, `Measured ${measured}; maximum ${limit}.`));
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isClassLike(node)) check(node, "class-lines", codeLines(node, source));
    const body = functionBody(node);
    if (body && ts.isFunctionLike(node)) {
      const { complexity, depth } = measureControl(body);
      check(node, "function-lines", codeLines(node, source));
      check(node, "parameters", node.parameters.length);
      check(node, "complexity", complexity);
      check(node, "depth", depth);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

function functionBody(node: ts.Node): ts.Node | undefined {
  if (!ts.isFunctionLike(node) || !("body" in node)) return;
  return (node as ts.FunctionLikeDeclaration).body;
}

function codeLines(node: ts.Node, source: ts.SourceFile): number {
  const lines = new Set<number>();

  function collect(current: ts.Node): void {
    if (ts.isJSDoc(current) || current.getWidth(source) === 0) return;
    const children = current.getChildren(source);
    if (children.length > 0) {
      for (const child of children) collect(child);
      return;
    }
    const first = source.getLineAndCharacterOfPosition(current.getStart(source)).line;
    const last = source.getLineAndCharacterOfPosition(current.getEnd() - 1).line;
    for (let line = first; line <= last; line++) lines.add(line);
  }

  collect(node);
  return lines.size;
}

function measureControl(body: ts.Node): { complexity: number; depth: number } {
  let complexity = 1;
  let depth = 0;

  function visit(node: ts.Node, nesting: number): void {
    if (ts.isFunctionLike(node)) return;
    if (isDecision(node)) complexity++;
    const nested = nesting + (nestsControl(node) && !isElseIf(node) ? 1 : 0);
    depth = Math.max(depth, nested);
    ts.forEachChild(node, (child) => visit(child, nested));
  }

  visit(body, 0);
  return { complexity, depth };
}

function isElseIf(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) &&
    node.parent !== undefined &&
    ts.isIfStatement(node.parent) &&
    node.parent.elseStatement === node
  );
}

function nestsControl(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isConditionalExpression(node) ||
    ts.isIterationStatement(node, false) ||
    ts.isSwitchStatement(node) ||
    ts.isCatchClause(node)
  );
}

const shortCircuit = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function isDecision(node: ts.Node): boolean {
  return (
    (nestsControl(node) && !ts.isSwitchStatement(node)) ||
    ts.isCaseClause(node) ||
    (ts.isOptionalChain(node) &&
      "questionDotToken" in node &&
      node.questionDotToken !== undefined) ||
    (ts.isBinaryExpression(node) && shortCircuit.has(node.operatorToken.kind))
  );
}
