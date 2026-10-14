import * as vscode from 'vscode';
import { Backend } from './engine/backend';
import { ClassIndex } from "./documents/classIndex";

export interface Enigma {
    context: vscode.ExtensionContext;
    output: vscode.LogOutputChannel;
    backend: Backend;
    index: ClassIndex;
}