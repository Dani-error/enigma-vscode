import * as vscode from 'vscode';
import { Backend } from './engine/backend';

export interface Enigma {
    context: vscode.ExtensionContext;
    output: vscode.LogOutputChannel;
    backend: Backend;
}