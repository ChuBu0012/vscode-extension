import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // 1. Register Command
  const helloCommand = vscode.commands.registerCommand('starterExtension.helloWorld', () => {
    vscode.window.showInformationMessage('Hello from Starter Extension!');
  });
  context.subscriptions.push(helloCommand);

  // 2. Register Status Bar Item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'starterExtension.helloWorld';
  statusBarItem.text = '$(zap) Starter Ext';
  statusBarItem.tooltip = 'Click to run Starter Extension command';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate() {
  // All subscriptions are automatically disposed by VS Code
}
