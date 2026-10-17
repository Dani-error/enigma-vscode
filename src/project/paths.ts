/**
 * A path of a file as Node and Java write it. VS Code writes the drive letter of a Windows path in lower case
 * (Uri.fsPath), Node in upper case, and the two would not be taken for the same file: not among the recent projects,
 * not as the jar that unsaved changes or tabs belong to.
 */
export const filePath = (value: string, platform: NodeJS.Platform = process.platform): string =>
    platform === 'win32' && /^[a-z]:/.test(value) ? value[0].toUpperCase() + value.slice(1) : value;
