# Enigma for VS Code

[Enigma](https://github.com/QuiltMC/enigma), the tool for deobfuscating Java bytecode, as a VS Code extension.

<img src=".github/assets/showcase.png" alt="Enigma in VS Code: a jar being deobfuscated" width="900">

Unofficial port, not affiliated with the Quilt Project.

## Features

- Rename classes, methods, fields and parameters by typing over them in the decompiled code
- Enigma's class trees, Identifier, Structure, and Inheritance and Calls panes
- All of Enigma's mapping formats, with undo, package renames and statistics
- Vineflower, CFR and Procyon decompilers
- Collaboration through Enigma servers
- Tools for AI assistants, in VS Code's chat and over MCP

## Usage

Requires Java 17 or newer, which is found automatically.

Run **Enigma: Open Jar...**, open a class from the Enigma side bar, and type over a highlighted name. Save with
**Enigma: Save Mappings As...**.

For assistants outside VS Code, such as Claude Code, run **Enigma: Connect an Assistant over MCP...**.

## Building

Requires [bun](https://bun.sh) and JDK 17 or newer.

```bash
git clone --recursive https://github.com/Dani-error/enigma-vscode.git
cd enigma-vscode
bun install
bun run package
```

The extension is written to `build/enigma-vscode-<version>.vsix`.

## Contributing

Run `bun run check`, `bun run test:backend` and `bun run test` before opening a pull request. Translations are in
`l10n/`.

## License

[LGPL-3.0-or-later](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled libraries.
