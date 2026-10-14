import { Backend } from '../engine/backend';
import { ClassIndex } from '../documents/classIndex';
import { EntryRef } from '../engine/protocol';

/** Where an entry is declared, if it is part of the jar. Asking decompiles its class. */
export const declarationOf = async (backend: Backend, index: ClassIndex, entry: EntryRef) => {
    const location = await backend.request('nav/declaration', { entry });
    return location ? index.location(location) : undefined;
}
