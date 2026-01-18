import * as vscode from "vscode";

interface LaunchConfig {
	name: string;
	config: vscode.DebugConfiguration;
	folder: vscode.WorkspaceFolder;
}

let selectedConfig: LaunchConfig | undefined;
let configButton: vscode.StatusBarItem | undefined;
let runButton: vscode.StatusBarItem | undefined;
let debugButton: vscode.StatusBarItem | undefined;
let selectConfigDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
	console.log("Persistent Run Button extension is now active");

	// Restore last selected configuration
	const lastConfigKey = context.workspaceState.get<string>("lastConfigKey");
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

		selectConfigDisposable = vscode.commands.registerCommand(
			"persistentRunButton.selectConfig",
			async () => {
				const configs = getAllConfigs();

				if (configs.length === 0) {
					const result = await vscode.window.showInformationMessage(
						"No debug configurations found.",
						"Create Configuration",
					);
					if (result) {
						await vscode.commands.executeCommand(
							"workbench.action.debug.configure",
						);
					}
					return;
				}

				const items = configs.map((cfg) => ({
					label: cfg.name,
					description: cfg.config.type,
					detail: cfg.folder.name,
					config: cfg,
				}));

				const selected = await vscode.window.showQuickPick(items, {
					placeHolder: "Select a debug configuration",
				});

				if (selected) {
					selectedConfig = selected.config;
					const configKey = getConfigKey(selectedConfig);
					await context.workspaceState.update("lastConfigKey", configKey);
					registerSelectConfigCommand(); // Re-register with new title
					updateStatusBar();
				}
			},
		);

		context.subscriptions.push(selectConfigDisposable);
	}

	// Initial registration
	registerSelectConfigCommand();

	// Register command to run selected configuration without debugging
	const runSelectedCommand = vscode.commands.registerCommand(
		"persistentRunButton.runSelected",
		async () => {
			if (!selectedConfig) {
				await vscode.commands.executeCommand(
					"persistentRunButton.selectConfig",
				);
				if (!selectedConfig) {
					return;
				}
			}

			await vscode.debug.startDebugging(
				selectedConfig.folder,
				selectedConfig.config,
				{ noDebug: true },
			);
		},
	);

	// Register command to debug selected configuration
	const debugSelectedCommand = vscode.commands.registerCommand(
		"persistentRunButton.debugSelected",
		async () => {
			if (!selectedConfig) {
				await vscode.commands.executeCommand(
					"persistentRunButton.selectConfig",
				);
				if (!selectedConfig) {
					return;
				}
			}

			await vscode.debug.startDebugging(
				selectedConfig.folder,
				selectedConfig.config,
			);
		},
	);

	context.subscriptions.push(runSelectedCommand, debugSelectedCommand);

	// Initialize status bar items
	updateStatusBarVisibility();

	// Update status bar when workspace folders or configurations change
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			updateStatusBar();
		}),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("launch")) {
				updateStatusBar();
			}
			if (e.affectsConfiguration("persistentRunButton.showInStatusBar")) {
				updateStatusBarVisibility();
			}
			if (e.affectsConfiguration("persistentRunButton.hideBuiltInRunButton")) {
				vscode.window
					.showInformationMessage(
						"Please reload VS Code for the built-in run button setting to take effect.",
						"Reload Window",
					)
					.then((selection) => {
						if (selection === "Reload Window") {
							vscode.commands.executeCommand("workbench.action.reloadWindow");
						}
					});
			}
		}),
	);

	// Apply CSS to hide built-in run button if configured
	applyBuiltInButtonVisibility(context);
}

function getAllConfigs(): LaunchConfig[] {
	const configs: LaunchConfig[] = [];
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders) {
		return configs;
	}

	for (const folder of workspaceFolders) {
		const launchConfig = vscode.workspace.getConfiguration(
			"launch",
			folder.uri,
		);
		const configurations =
			launchConfig.get<vscode.DebugConfiguration[]>("configurations") || [];

		for (const config of configurations) {
			configs.push({
				name: config.name,
				config: config,
				folder: folder,
			});
		}
	}

	return configs;
}

function getConfigKey(cfg: LaunchConfig): string {
	return `${cfg.folder.name}:${cfg.name}`;
}

function getConfigFromKey(key: string): LaunchConfig | undefined {
	const [folderName, configName] = key.split(":");
	const configs = getAllConfigs();
	return configs.find(
		(cfg) => cfg.folder.name === folderName && cfg.name === configName,
	);
}

function updateStatusBarVisibility() {
	const config = vscode.workspace.getConfiguration("persistentRunButton");
	const shouldShow = config.get<boolean>("showInStatusBar", true);

	if (shouldShow) {
		// Create status bar items if they don't exist
		if (!configButton) {
			configButton = vscode.window.createStatusBarItem(
				vscode.StatusBarAlignment.Right,
				1,
			);
			configButton.command = "persistentRunButton.selectConfig";
			configButton.tooltip = "Select Debug Configuration";
		}

		if (!debugButton) {
			debugButton = vscode.window.createStatusBarItem(
				vscode.StatusBarAlignment.Right,
				1,
			);
			debugButton.command = "persistentRunButton.debugSelected";
			debugButton.text = "$(debug-alt)";
			debugButton.tooltip = "Start Debugging";
		}

		if (!runButton) {
			runButton = vscode.window.createStatusBarItem(
				vscode.StatusBarAlignment.Right,
				1,
			);
			runButton.command = "persistentRunButton.runSelected";
			runButton.text = "$(run)";
			runButton.tooltip = "Run Without Debugging";
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

function applyBuiltInButtonVisibility(_context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("persistentRunButton");
	const hideBuiltIn = config.get<boolean>("hideBuiltInRunButton", false);

	if (hideBuiltIn) {
		// Set context to hide built-in run button
		vscode.commands.executeCommand(
			"setContext",
			"persistentRunButton.hideBuiltIn",
			true,
		);
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
		const stillExists = configs.some(
			(cfg) => cfg.folder.name === currentFolder && cfg.name === currentName,
		);
		if (!stillExists) {
			selectedConfig = configs.length > 0 ? configs[0] : undefined;
		}
	}

	if (selectedConfig) {
		configButton.text = `$(debug-configure) ${selectedConfig.name}`;
	} else {
		configButton.text = "$(debug-configure) No Config";
	}
}

export function deactivate() {
	// Cleanup is handled by context.subscriptions
}
