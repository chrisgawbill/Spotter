/** Converts a glob (`**`, `*`, `?`, `{a,b}`) to an anchored RegExp over POSIX paths. */
export function globToRegExp(glob) {
  let pattern = '';
  let braceDepth = 0;
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      pattern += glob[index + 2] === '/' ? '(?:.*/)?' : '.*';
      index += glob[index + 2] === '/' ? 2 : 1;
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else if (char === '{') {
      braceDepth += 1;
      pattern += '(?:';
    } else if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
      pattern += ')';
    } else if (char === ',' && braceDepth > 0) pattern += '|';
    else pattern += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

/** True when the path matches any of the globs (a single glob string is accepted). */
export function matchesAnyGlob(filePath, globs) {
  return [globs].flat().some((glob) => globToRegExp(glob).test(filePath));
}
