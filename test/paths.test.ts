// Unit tests of how the extension writes paths (src/project/paths.ts).
// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filePath } from '../src/project/paths';

describe('paths', () => {
    it('writes the drive letter of a Windows path as Node does, so that one file has one path', () => {
        assert.equal(filePath('c:\\Users\\me\\game.jar', 'win32'), 'C:\\Users\\me\\game.jar');
        assert.equal(filePath('C:\\Users\\me\\game.jar', 'win32'), 'C:\\Users\\me\\game.jar');
        assert.equal(filePath('\\\\server\\share\\game.jar', 'win32'), '\\\\server\\share\\game.jar');
    });

    it('leaves the paths of other systems as they are', () => {
        assert.equal(filePath('/home/me/game.jar', 'linux'), '/home/me/game.jar');
        assert.equal(filePath('c:/not/a/drive', 'darwin'), 'c:/not/a/drive');
    });
});
