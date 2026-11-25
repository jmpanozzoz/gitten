import ts from "typescript";

const restricted = new Set(["only", "skip", "todo", "skipIf", "todoIf", "if", "failing"]);

export function assertUnfilteredSuite(path: string, source: string): void {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    const name = restrictedMember(node);
    if (name?.text && restricted.has(name.text)) {
      const { line } = file.getLineAndCharacterOfPosition(name.getStart(file));
      throw new Error(
        `${path}:${line + 1}: ${name.text} can omit required tests or invert their results.`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
}

function restrictedMember(node: ts.Node): ts.Identifier | ts.StringLiteralLike | undefined {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return node.name;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression;
  }
}
