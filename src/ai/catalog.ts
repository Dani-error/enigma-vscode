// The tools assistants get, described once. This is plain data, without anything of the editor: it is what
// package.json declares to the editor's own chat ("languageModelTools", written from here by "npm run sync:ai"), what
// the MCP server lists to other assistants, and what tools.ts implements.

export interface ToolDescription {
    name: string;
    /** For people: in the tool picker of the chat, and in the list of an MCP client. */
    title: string;
    summary: string;
    /** For the model. */
    description: string;
    icon: string;
    /** Changes the mappings: the user is asked first. */
    changes?: boolean;
    inputSchema: { type: 'object'; properties: Record<string, object>; required?: string[] };
}

const CLASS = {
    type: 'string',
    description: 'The class, with its package and slashes: com/example/Thing. Either its current name or its name in the jar.',
};

const ENTRY = {
    type: 'object',
    description:
        'What to act on, exactly as given in the "entry" of a result of another tool. Names inside it are the names in the jar (obfuscated), never new ones. ' +
        'A class: {"kind":"class","name":"a/b"}. A field or method: {"kind":"method","owner":"a/b","name":"c","desc":"(I)V"}.',
    properties: { kind: { type: 'string', enum: ['class', 'field', 'method', 'local'] } },
    required: ['kind'],
};

/** Told to an assistant once, before it uses any of the tools. */
export const INSTRUCTIONS = `Enigma is a tool for deobfuscating Java: giving readable names to the classes, methods, fields and variables of a jar whose names were replaced by meaningless ones. These tools work on the jar the user has open in Enigma, in VS Code.

How names work:
- Everything has two names: the one in the jar (obfuscated, never changes) and the current one (what the user sees, which is what you change). Tools accept either for a class, and results give both.
- Classes are written with their package and slashes: com/example/Thing. Inner classes: com/example/Outer$Inner.
- An "entry" identifies one thing to rename or look up. Take it verbatim from a tool result; do not build one by hand, and never put a new name into it.

How to work:
1. enigma_overview first: what jar this is, how far it is named, which packages it has.
2. Read before naming: enigma_read_class shows the decompiled code. A name says what the code does, so do not name what you have not read.
3. Gather evidence when the code alone does not say enough: enigma_references and enigma_callers show how something is used, enigma_callees what it relies on, enigma_hierarchy what it extends and what extends it. String constants, the types involved and library calls are the best clues.
4. Name with enigma_rename, following Java conventions: UpperCamelCase classes, lowerCamelCase methods and fields, UPPER_SNAKE_CASE constants. Renaming a class keeps its package only if the new name includes it. A method that overrides another is renamed together with it, in every class.
5. Prefer certain names over many names. If you cannot tell what something is, leave it, or say what you are unsure about. A wrong name misleads more than an obfuscated one.
6. Use enigma_set_javadoc for what a name cannot carry.

Changes go into the user's mappings and can be undone by them with "Enigma: Undo". Saving the mappings is up to the user.`;

export const TOOLS: ToolDescription[] = [
    {
        name: 'enigma_overview',
        title: 'Enigma: Overview',
        icon: '$(info)',
        summary: 'What jar is open in Enigma and how far it is named.',
        description:
            'Describes the jar open in Enigma: its file, the mappings in use, how many classes are named, and its packages with their numbers of classes. Call this first. It also explains how to work with the other Enigma tools.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'enigma_list_classes',
        title: 'Enigma: List Classes',
        icon: '$(symbol-class)',
        summary: 'Lists the classes of the jar open in Enigma.',
        description:
            'Lists classes of the jar open in Enigma: for each its name in the jar (obfuscatedName), its current name, its kind and whether it was named already. Ask for one package at a time in a large jar.',
        inputSchema: {
            type: 'object',
            properties: {
                package: { type: 'string', description: 'Only classes in this package (and below), like com/example.' },
                onlyUnnamed: { type: 'boolean', description: 'Only classes that have no readable name yet.' },
                limit: { type: 'number', description: 'At most this many (400 at most).' },
            },
        },
    },
    {
        name: 'enigma_read_class',
        title: 'Enigma: Read Class',
        icon: '$(file-code)',
        summary: 'Reads the decompiled source of a class.',
        description:
            'Returns the decompiled Java source of a class of the jar open in Enigma, with the names given so far. Read a class before naming it or its members. A long class comes in parts: the answer says how many lines there are, and "fromLine" continues.',
        inputSchema: {
            type: 'object',
            properties: {
                class: CLASS,
                fromLine: { type: 'number', description: 'The first line to return, counting from 1. For continuing a long class.' },
            },
            required: ['class'],
        },
    },
    {
        name: 'enigma_list_members',
        title: 'Enigma: List Members',
        icon: '$(symbol-method)',
        summary: 'Lists the fields and methods of a class.',
        description:
            'Lists the fields, methods, constructors and inner classes of a class of the jar open in Enigma, each with the "entry" the other tools need to act on it, and whether it was named already.',
        inputSchema: { type: 'object', properties: { class: CLASS }, required: ['class'] },
    },
    {
        name: 'enigma_search',
        title: 'Enigma: Search',
        icon: '$(search)',
        summary: 'Searches classes, methods and fields by name.',
        description:
            'Searches the jar open in Enigma for classes, methods and fields by name (current or obfuscated). Each result has its "entry".',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Part of a name.' },
                kinds: {
                    type: 'array',
                    items: { type: 'string', enum: ['class', 'method', 'field'] },
                    description: 'Only these kinds; all if left out.',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'enigma_describe',
        title: 'Enigma: Describe',
        icon: '$(symbol-property)',
        summary: 'Details of a class, method or field.',
        description:
            'Describes one entry of the jar open in Enigma: both of its names, its modifiers, its type or signature, its javadoc, where it is declared, and for a class what it extends and implements.',
        inputSchema: { type: 'object', properties: { entry: ENTRY }, required: ['entry'] },
    },
    {
        name: 'enigma_references',
        title: 'Enigma: References',
        icon: '$(references)',
        summary: 'Where a class, method or field is used.',
        description:
            'Lists where in the jar a class, method or field is used: the methods that call a method, read or write a field, or create or mention a class. How something is used is evidence for what it is.',
        inputSchema: { type: 'object', properties: { entry: ENTRY }, required: ['entry'] },
    },
    {
        name: 'enigma_callers',
        title: 'Enigma: Callers',
        icon: '$(call-incoming)',
        summary: 'The methods that call a method.',
        description:
            'Lists the methods of the jar that call a method, each with its "entry", so that they can be read or followed further.',
        inputSchema: { type: 'object', properties: { entry: ENTRY }, required: ['entry'] },
    },
    {
        name: 'enigma_callees',
        title: 'Enigma: Callees',
        icon: '$(call-outgoing)',
        summary: 'What a method calls and accesses.',
        description:
            'Lists what a method of the jar calls and which fields it accesses, including those of libraries. What a method relies on is evidence for what it does.',
        inputSchema: { type: 'object', properties: { entry: ENTRY }, required: ['entry'] },
    },
    {
        name: 'enigma_hierarchy',
        title: 'Enigma: Hierarchy',
        icon: '$(type-hierarchy)',
        summary: 'What a class extends and what extends it.',
        description:
            'For a class of the jar open in Enigma: the classes and interfaces it extends or implements, and those in the jar that extend or implement it. Related classes are often named after each other.',
        inputSchema: { type: 'object', properties: { class: CLASS }, required: ['class'] },
    },
    {
        name: 'enigma_rename',
        title: 'Enigma: Rename',
        icon: '$(edit)',
        changes: true,
        summary: 'Renames a class, method, field or variable in the mappings. Asks first.',
        description:
            'Gives a class, method, field, parameter or local variable of the jar open in Enigma a new name, everywhere it is used. Only rename what you have read the code of. The new name of a class is its full name with package and slashes (com/example/Thing): to keep it in its package, keep the package. A method that overrides another is renamed together with it. The result says whether the name was accepted, and why not.',
        inputSchema: {
            type: 'object',
            properties: {
                entry: ENTRY,
                newName: { type: 'string', description: 'The new name. For a class, with its package and slashes.' },
            },
            required: ['entry', 'newName'],
        },
    },
    {
        name: 'enigma_set_javadoc',
        title: 'Enigma: Write Javadoc',
        icon: '$(comment)',
        changes: true,
        summary: 'Writes the javadoc of a class, method or field into the mappings. Asks first.',
        description:
            'Sets the javadoc of a class, method or field of the jar open in Enigma, replacing what it had; an empty text removes it. Plain text of the comment, without the comment markers.',
        inputSchema: {
            type: 'object',
            properties: { entry: ENTRY, javadoc: { type: 'string', description: 'The text of the comment, without /** and */.' } },
            required: ['entry', 'javadoc'],
        },
    },
];

/** What package.json declares to the chat of the editor for these tools. */
export const manifestTools = (): object[] => {
    return TOOLS.map(tool => ({
        name: tool.name,
        displayName: tool.title,
        toolReferenceName: tool.name.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
        icon: tool.icon,
        canBeReferencedInPrompt: true,
        userDescription: tool.summary,
        modelDescription: tool.description,
        inputSchema: tool.inputSchema,
    }));
};
