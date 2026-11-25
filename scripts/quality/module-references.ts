import ts from "typescript";

export interface ModuleReference {
  node: ts.Node;
  specifier?: string;
  runtime: boolean;
}

export function moduleReference(node: ts.Node): ModuleReference | undefined {
  const declaration = staticReference(node);
  if (declaration) return declaration;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return reference(node, node.argument.literal, false);
  }
  if (ts.isCallExpression(node) && isModuleLoader(node.expression)) {
    return reference(node, node.arguments[0], true);
  }
}

function staticReference(node: ts.Node): ModuleReference | undefined {
  if (ts.isImportDeclaration(node)) {
    return reference(node, node.moduleSpecifier, !isTypeOnlyImport(node.importClause));
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
    const clause = node.exportClause;
    const typeOnly =
      node.isTypeOnly || (clause && ts.isNamedExports(clause) && allTypeOnly(clause.elements));
    return reference(node, node.moduleSpecifier, !typeOnly);
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return reference(node, node.moduleReference.expression, !node.isTypeOnly);
  }
}

function reference(node: ts.Node, target: ts.Node | undefined, runtime: boolean): ModuleReference {
  return {
    node,
    specifier: target && ts.isStringLiteralLike(target) ? target.text : undefined,
    runtime,
  };
}

function isModuleLoader(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(expression) && expression.text === "require")
  );
}

function isTypeOnlyImport(clause?: ts.ImportClause): boolean {
  if (clause?.isTypeOnly) return true;
  const bindings = clause?.namedBindings;
  return Boolean(
    !clause?.name && bindings && ts.isNamedImports(bindings) && allTypeOnly(bindings.elements),
  );
}

function allTypeOnly(elements: readonly { isTypeOnly: boolean }[]): boolean {
  return elements.length > 0 && elements.every(({ isTypeOnly }) => isTypeOnly);
}
