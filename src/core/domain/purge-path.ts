export function isRepositoryFilePath(path: string): boolean {
  return (
    !path.includes("\0") &&
    !/^[A-Za-z]:[\\/]/.test(path) &&
    !path.startsWith("\\\\") &&
    path
      .split("/")
      .every((component) => component !== "" && component !== "." && component !== "..")
  );
}
