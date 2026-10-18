# Licensing and third-party notices

## This project

Enigma VSCode is distributed under the **GNU Lesser General Public License v3.0 or later** (see [LICENSE](LICENSE)).

That choice follows from Enigma's own licence. The backend links Enigma, ships it in the same jar, and contains two
pieces adapted from it:

- `backend/src/main/java/dev/danibcastro/enigmavscode/backend/search/` — `SearchUtil` and `SearchEntry`, copied from
  `enigma-swing` with only the package declaration changed.
- `backend/src/main/java/dev/danibcastro/enigmavscode/backend/util/PackageRenamePlanner.java` — a port of `enigma-swing`'s
  `PackageRenamer`.

Licensing the whole project under the LGPL keeps that simple: the combined work can be distributed under one licence,
and anyone can replace the bundled Enigma (it is a composite Gradle build of `vendor/enigma`).

## Enigma

`vendor/enigma/` is an unmodified copy of [Enigma](https://github.com/QuiltMC/enigma) 2.7.2.

> Copyright (c) 2022 The Quilt Project. Original work copyright (c) 2015 Jeff Martin.
> Made available under the terms of the GNU Lesser General Public License v3.0.

Its `LICENSE`, `COPYING.md` and `CHANGES.md` are kept in that directory.

## Libraries bundled in `server/enigma-backend.jar`

All of these are dependencies of Enigma itself, in the versions of its version catalog. Every licence below permits
redistribution as part of an LGPL-3.0 work. Licences were read from each artifact's published POM on 2026-10-11, except
where noted. The licence and notice files shipped inside the libraries are preserved in the jar under `META-INF/`.

| Library                                                                | Version             | Licence                                                              |
| ---------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| [Vineflower](https://github.com/Vineflower/vineflower)                 | 1.11.1              | Apache-2.0                                                           |
| [CFR](https://github.com/FabricMC/cfr), FabricMC's fork                | 0.2.2               | MIT (from the repository's licence file; the POM declares none)      |
| [Procyon](https://github.com/mstrobel/procyon) compiler tools and core | 0.6.0               | Apache-2.0                                                           |
| [ASM](https://asm.ow2.io/) (asm, commons, tree, util, analysis)        | 9.9                 | BSD-3-Clause                                                         |
| [Guava](https://github.com/google/guava), failureaccess                | 33.5.0-jre, 1.0.3   | Apache-2.0                                                           |
| [Gson](https://github.com/google/gson)                                 | 2.13.2              | Apache-2.0                                                           |
| [JavaParser](https://javaparser.org/)                                  | 3.27.0              | LGPL or Apache-2.0, at the recipient's choice                        |
| [Quilt Config](https://github.com/QuiltMC/quilt-config)                | 1.3.2               | Apache-2.0 (from the licence file in the jar; the POM declares none) |
| [tinylog](https://tinylog.org/) api and impl                           | 2.7.0               | Apache-2.0                                                           |
| [jopt-simple](https://github.com/jopt-simple/jopt-simple)              | 6.0-alpha-3         | MIT                                                                  |
| [JSpecify](https://jspecify.dev/)                                      | 1.0.0               | Apache-2.0                                                           |
| Error Prone annotations, J2ObjC annotations, JetBrains annotations     | 2.41.0, 3.1, 23.0.0 | Apache-2.0                                                           |

Not bundled, although they are part of `enigma-swing`: FlatLaf, syntaxpain, swing-dpi, fontchooser. The Swing module is
not used.

## Libraries bundled in `dist/extension.js`

| Library                                                                   | Version | Licence |
| ------------------------------------------------------------------------- | ------- | ------- |
| [vscode-jsonrpc](https://github.com/microsoft/vscode-languageserver-node) | 8.2.1   | MIT     |

## Libraries bundled in `dist/pages/`

| Library                                                      | Version | Licence |
| ------------------------------------------------------------ | ------- | ------- |
| [Preact](https://github.com/preactjs/preact), with its hooks | 11.0.1  | MIT     |

## Files bundled in `dist/` and `resources/`

| File                                                                            | Origin                                                                                                                                                                                                                                                                           | Licence                                      |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `dist/codicons/codicon.css`, `codicon.ttf`, `graph-light.svg`, `graph-dark.svg` | [@vscode/codicons](https://github.com/microsoft/vscode-codicons), the icons of VS Code, used by the panes and the statistics tab. Copied from the package when the extension is built, in the version `package.json` asks for; the SVGs only coloured for light and dark themes. | Icons: CC BY 4.0. Code: MIT.                 |
| `resources/icons/*.svg`                                                         | The icons of classes, methods and fields in the trees, by Elior "Mallowigi" Boukhobza (Material Theme UI), as shipped with Enigma's Swing interface. Unchanged.                                                                                                                  | MIT; the licence is at the top of each file. |
