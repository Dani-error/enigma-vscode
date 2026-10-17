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

Requires Node.js 22 or newer and JDK 17 or newer.

```bash
git clone --recursive https://github.com/Dani-error/enigma-vscode.git
cd enigma-vscode
npm install
npm run package
```

The extension is written to `build/enigma-vscode-<version>.vsix`.

## Contributing

Run `npm run check`, `npm run test:backend` and `npm test` before opening a pull request. Both test runs fail when
they cover less than they do now; their reports are in `build/coverage/e2e` and `backend/build/reports/jacoco`.
Translations are in `l10n/`.

CI runs all of it on Linux, macOS and Windows, and on the oldest VS Code supported. Pushing a tag such as `v1.0.0`
releases that version: the `.vsix` is attached to a GitHub release, and published to the Marketplace and Open VSX when
the repository has the `VSCE_PAT` and `OVSX_PAT` secrets.

## License

[LGPL-3.0-or-later](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled libraries.
