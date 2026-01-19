import {
	commands,
	type DebugConfiguration,
	type Disposable,
	debug,
	type ExtensionContext,
	StatusBarAlignment,
	type StatusBarItem,
	type WorkspaceFolder,
	window,
	workspace
} from 'vscode';

interface LaunchConfig {
	name: string;
	config: DebugConfiguration;
	folder: WorkspaceFolder;
}

let selectedConfig: LaunchConfig | undefined;
let configButton: StatusBarItem | undefined;
let runButton: StatusBarItem | undefined;
let debugButton: StatusBarItem | undefined;
let selectConfigDisposable: Disposable | undefined;

export function activate(context: ExtensionContext) {
	console.log('Persistent Run Button extension is now active');

	// Restore last selected configuration
	const lastConfigKey = context.workspaceState.get<string>('lastConfigKey');
	if (lastConfigKey) {
		selectedConfig = getConfigFromKey(lastConfigKey);
	}

	// If no saved config or it's invalid, try to get the first available config
	if (!selectedConfig) {
		const configs = getAllConfigs();
		if (configs.length > 0) {
			selectedConfig = configs[0];
		}
	}

	// Register command to select configuration (dropdown behavior)
	function registerSelectConfigCommand() {
		if (selectConfigDisposable) {
			selectConfigDisposable.dispose();
		}

		selectConfigDisposable = commands.registerCommand('persistentRunButton.selectConfig', async () => {
			const configs = getAllConfigs();

			if (configs.length === 0) {
				const result = await window.showInformationMessage('No debug configurations found.', 'Create Configuration');
				if (result) {
					await commands.executeCommand('workbench.action.debug.configure');
				}
				return;
			}

			const items = configs.map((cfg) => ({
				label: cfg.name,
				description: cfg.config.type,
				detail: cfg.folder.name,
				config: cfg
			}));

			const selected = await window.showQuickPick(items, {
				placeHolder: 'Select a debug configuration'
			});

			if (selected) {
				selectedConfig = selected.config;
				const configKey = getConfigKey(selectedConfig);
				await context.workspaceState.update('lastConfigKey', configKey);
				registerSelectConfigCommand(); // Re-register with new title
				updateStatusBar();
			}
		});

		context.subscriptions.push(selectConfigDisposable);
	}

	// Initial registration
	registerSelectConfigCommand();

	// Register command to run selected configuration without debugging
	const runSelectedCommand = commands.registerCommand('persistentRunButton.runSelected', async () => {
		if (!selectedConfig) {
			await commands.executeCommand('persistentRunButton.selectConfig');
			if (!selectedConfig) {
				return;
			}
		}

		// For compounds, pass the name as a string; for regular configs, pass the config object
		const configToStart = isCompound(selectedConfig.config) ? selectedConfig.config.name : selectedConfig.config;
		await debug.startDebugging(selectedConfig.folder, configToStart, { noDebug: true });
	});

	// Register command to debug selected configuration
	const debugSelectedCommand = commands.registerCommand('persistentRunButton.debugSelected', async () => {
		if (!selectedConfig) {
			await commands.executeCommand('persistentRunButton.selectConfig');
			if (!selectedConfig) {
				return;
			}
		}

		// For compounds, pass the name as a string; for regular configs, pass the config object
		const configToStart = isCompound(selectedConfig.config) ? selectedConfig.config.name : selectedConfig.config;
		await debug.startDebugging(selectedConfig.folder, configToStart);
	});

	context.subscriptions.push(runSelectedCommand, debugSelectedCommand);

	// Initialize status bar items
	updateStatusBarVisibility();

	// Update status bar when workspace folders or configurations change
	context.subscriptions.push(
		workspace.onDidChangeWorkspaceFolders(() => {
			updateStatusBar();
		}),
		workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('launch')) {
				updateStatusBar();
			}
			if (e.affectsConfiguration('persistentRunButton.showInStatusBar')) {
				updateStatusBarVisibility();
			}
			if (e.affectsConfiguration('persistentRunButton.hideBuiltInRunButton')) {
				window.showInformationMessage('Please reload VS Code for the built-in run button setting to take effect.', 'Reload Window').then((selection) => {
					if (selection === 'Reload Window') {
						commands.executeCommand('workbench.action.reloadWindow');
					}
				});
			}
		})
	);

	// Apply CSS to hide built-in run button if configured
	applyBuiltInButtonVisibility(context);
}

function isCompound(config: DebugConfiguration): boolean {
	// Compounds have a 'configurations' property instead of a 'type' property
	return 'configurations' in config && !('type' in config);
}

function getAllConfigs(): LaunchConfig[] {
	const configs: LaunchConfig[] = [];
	const workspaceFolders = workspace.workspaceFolders;

	if (!workspaceFolders) {
		return configs;
	}

	for (const folder of workspaceFolders) {
		const launchConfig = workspace.getConfiguration('launch', folder.uri);
		const configurations = launchConfig.get<DebugConfiguration[]>('configurations') || [];
		const compoundConfigs = launchConfig.get<DebugConfiguration[]>('compounds') || [];

		for (const config of [configurations, compoundConfigs].flat()) {
			configs.push({
				name: config.name,
				config: config,
				folder: folder
			});
		}
	}

	return configs;
}

function getConfigKey(cfg: LaunchConfig): string {
	return `${cfg.folder.name}:${cfg.name}`;
}

function getConfigFromKey(key: string): LaunchConfig | undefined {
	const [folderName, configName] = key.split(':');
	const configs = getAllConfigs();
	return configs.find((cfg) => cfg.folder.name === folderName && cfg.name === configName);
}

function updateStatusBarVisibility() {
	const config = workspace.getConfiguration('persistentRunButton');
	const shouldShow = config.get<boolean>('showInStatusBar', true);

	if (shouldShow) {
		// Create status bar items if they don't exist
		if (!configButton) {
			configButton = window.createStatusBarItem(StatusBarAlignment.Right, 1);
			configButton.command = 'persistentRunButton.selectConfig';
			configButton.tooltip = 'Select Debug Configuration';
		}

		if (!debugButton) {
			debugButton = window.createStatusBarItem(StatusBarAlignment.Right, 1);
			debugButton.command = 'persistentRunButton.debugSelected';
			debugButton.text = '$(debug-alt)';
			debugButton.tooltip = 'Start Debugging';
		}

		if (!runButton) {
			runButton = window.createStatusBarItem(StatusBarAlignment.Right, 1);
			runButton.command = 'persistentRunButton.runSelected';
			runButton.text = '$(run)';
			runButton.tooltip = 'Run Without Debugging';
		}

		configButton.show();
		runButton.show();
		debugButton.show();

		updateStatusBar();
	} else {
		// Hide status bar items
		if (configButton) {
			configButton.hide();
		}
		if (runButton) {
			runButton.hide();
		}
		if (debugButton) {
			debugButton.hide();
		}
	}
}

function applyBuiltInButtonVisibility(_context: ExtensionContext) {
	const config = workspace.getConfiguration('persistentRunButton');
	const hideBuiltIn = config.get<boolean>('hideBuiltInRunButton', false);

	if (hideBuiltIn) {
		// Set context to hide built-in run button
		commands.executeCommand('setContext', 'persistentRunButton.hideBuiltIn', true);
	}
}

function updateStatusBar() {
	if (!configButton) {
		return;
	}

	// Validate that selected config still exists
	if (selectedConfig) {
		const configs = getAllConfigs();
		const currentFolder = selectedConfig.folder.name;
		const currentName = selectedConfig.name;
		const stillExists = configs.some((cfg) => cfg.folder.name === currentFolder && cfg.name === currentName);
		if (!stillExists) {
			selectedConfig = configs.length > 0 ? configs[0] : undefined;
		}
	}

	if (selectedConfig) {
		configButton.text = `$(debug-configure) ${selectedConfig.name}`;
	} else {
		configButton.text = '$(debug-configure) No Config';
	}
}

export function deactivate() {
	// Cleanup is handled by context.subscriptions
}
