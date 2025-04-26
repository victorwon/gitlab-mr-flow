// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
// NOTE: execa is imported dynamically below as it's an ESM module
const fs = require('fs').promises; // Use promises version of fs
const path = require('path');
// const vscode = require('vscode'); // Removed duplicate require

// Output channel for logging
let outputChannel;

/**
 * Helper function to run git commands.
 * @param {string[]} args - Array of arguments for the git command.
 * @param {string} cwd - The working directory for the command.
 * @param {string} commandDesc - Description of the command for logging.
 * @returns {Promise<{stdout: string, stderr: string, exitCode?: number | null}>} - exitCode might be null if process killed
 */
async function runGitCommand(args, cwd, commandDesc) {
    const commandString = `git ${args.join(' ')}`;
    outputChannel.appendLine(`Running: ${commandString} in ${cwd}`);
    try {
        // Dynamically import execa as it's an ESM module
        const { execa } = await import('execa');
        const result = await execa('git', args, { cwd, reject: false }); // reject: false to get stderr even on failure
        outputChannel.appendLine(`Finished: ${commandString}`);
        outputChannel.appendLine(`Exit Code: ${result.exitCode}`);
        if (result.stdout) {
            outputChannel.appendLine(`Stdout:\n${result.stdout}`);
        }
        if (result.stderr) {
            outputChannel.appendLine(`Stderr:\n${result.stderr}`);
        }
        return result;
    } catch (error) {
        outputChannel.appendLine(`Error running ${commandString}: ${error}`);
        vscode.window.showErrorMessage(`Failed to run git command: ${commandDesc}. Check Output channel for details.`);
        // Re-throw a simplified error or return a specific structure
        throw new Error(`Git command failed: ${commandDesc}`);
    }
}

/**
 * Reads .git/config and returns the URL for the 'origin' remote.
 * Prompts the user if multiple origin URLs are found.
 * @param {string} workspaceRoot - The root path of the workspace.
 * @returns {Promise<string>} The selected origin URL.
 * @throws {Error} If no origin URL is found, config is unreadable, or user cancels selection.
 */
async function getOriginUrl(workspaceRoot) {
    const configPath = path.join(workspaceRoot, '.git', 'config');
    outputChannel.appendLine(`Reading git config: ${configPath}`);
    let configContent;
    try {
        configContent = await fs.readFile(configPath, 'utf-8');
    } catch (error) {
        outputChannel.appendLine(`Error reading git config: ${error}`);
        throw new Error('Could not read .git/config file.');
    }

    const originUrls = [];
    // Regex to find remote "origin" sections and their url
    // Handles potential variations in spacing and comments
    const remoteOriginRegex = /\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\s#]+)/g;
    let match;
    while ((match = remoteOriginRegex.exec(configContent)) !== null) {
        originUrls.push(match[1]);
    }

    if (originUrls.length === 0) {
        outputChannel.appendLine('No remote "origin" URL found in .git/config.');
        throw new Error('No remote "origin" URL found in .git/config.');
    }

    if (originUrls.length === 1) {
        outputChannel.appendLine(`Found single origin URL: ${originUrls[0]}`);
        return originUrls[0];
    }

    // Multiple origins found, prompt user
    outputChannel.appendLine(`Multiple origin URLs found: ${originUrls.join(', ')}`);
    const selectedUrl = await vscode.window.showQuickPick(originUrls, {
        placeHolder: 'Multiple "origin" remotes found. Please select the one to use.',
        ignoreFocusOut: true // Keep open even if focus moves
    });

    if (!selectedUrl) {
        outputChannel.appendLine('User cancelled origin selection.');
        throw new Error('Origin selection cancelled by user.');
    }

    outputChannel.appendLine(`User selected origin URL: ${selectedUrl}`);
    return selectedUrl;
}

/**
 * Determines the target branch for the merge request.
 * Tries to find the default branch using 'git remote show origin'.
 * Falls back to prompting the user with a list from 'git branch -r'.
 * @param {string} workspaceRoot - The root path of the workspace.
 * @returns {Promise<string>} The selected target branch name.
 * @throws {Error} If the target branch cannot be determined or user cancels selection.
 */
async function getTargetBranch(workspaceRoot) {
    outputChannel.appendLine('Determining target branch...');

    // Attempt 1: Use 'git remote show origin'
    try {
        const remoteShowResult = await runGitCommand(['remote', 'show', 'origin'], workspaceRoot, 'show remote origin');
        if (remoteShowResult.exitCode === 0 && remoteShowResult.stdout) {
            const headBranchMatch = remoteShowResult.stdout.match(/HEAD branch:\s*(\S+)/);
            if (headBranchMatch && headBranchMatch[1]) {
                const defaultBranch = headBranchMatch[1];
                // Verify it's not '(unknown)' which sometimes happens
                if (defaultBranch !== '(unknown)') {
                    outputChannel.appendLine(`Found default remote branch via 'remote show': ${defaultBranch}`);
                    return defaultBranch;
                } else {
                     outputChannel.appendLine(`'git remote show origin' reported HEAD branch as '(unknown)'.`);
                }
            } else {
                 outputChannel.appendLine(`Could not parse HEAD branch from 'git remote show origin' output.`);
            }
        } else {
             outputChannel.appendLine(`'git remote show origin' failed or produced no output. Exit code: ${remoteShowResult.exitCode}`);
        }
    } catch (error) {
        // Log error from runGitCommand but continue to fallback
        outputChannel.appendLine(`Error running 'git remote show origin': ${error.message}. Falling back to 'git branch -r'.`);
    }

    // Attempt 2: Fallback to 'git branch -r' and prompt user
    outputChannel.appendLine("Falling back to 'git branch -r' to list remote branches.");
    let remoteBranches = [];
    try {
        const branchRResult = await runGitCommand(['branch', '-r'], workspaceRoot, 'list remote branches');
        if (branchRResult.exitCode === 0 && branchRResult.stdout) {
            const lines = branchRResult.stdout.split('\n');
            const originBranchRegex = /^\s*origin\/(\S+)/; // Match branches starting with 'origin/'
            lines.forEach(line => {
                // Skip lines pointing to HEAD -> origin/branch
                if (line.includes('->')) return;
                const match = line.match(originBranchRegex);
                if (match && match[1]) {
                    remoteBranches.push(match[1]);
                }
            });
        } else {
             outputChannel.appendLine(`'git branch -r' failed or produced no output. Exit code: ${branchRResult.exitCode}`);
             throw new Error("Could not list remote branches using 'git branch -r'.");
        }

        if (remoteBranches.length === 0) {
            outputChannel.appendLine('No remote branches found for origin.');
            throw new Error('No remote branches found for origin.');
        }

        outputChannel.appendLine(`Found remote branches: ${remoteBranches.join(', ')}`);
        const selectedBranch = await vscode.window.showQuickPick(remoteBranches, {
            placeHolder: "Could not automatically determine default branch. Please select the target branch for the Merge Request.",
            ignoreFocusOut: true
        });

        if (!selectedBranch) {
            outputChannel.appendLine('User cancelled target branch selection.');
            throw new Error('Target branch selection cancelled by user.');
        }

        outputChannel.appendLine(`User selected target branch: ${selectedBranch}`);
        return selectedBranch;

    } catch (error) {
        // Log or handle error from runGitCommand or QuickPick
        outputChannel.appendLine(`Error during fallback branch selection: ${error.message}`);
        // Re-throw if it's not already a user cancellation
        if (error.message.includes('cancelled by user')) {
             throw error;
        }
        throw new Error('Failed to determine target branch.');
    }
}

/**
 * Gets the current Git branch name.
 * @param {string} workspaceRoot - The root path of the workspace.
 * @returns {Promise<string>} The current branch name.
 * @throws {Error} If the branch name cannot be determined.
 */
async function getCurrentBranch(workspaceRoot) {
    outputChannel.appendLine('Determining current branch...');
    try {
        const { stdout, exitCode } = await runGitCommand(['branch', '--show-current'], workspaceRoot, 'get current branch');
        if (exitCode === 0 && stdout) {
            const currentBranch = stdout.trim();
            if (currentBranch) {
                outputChannel.appendLine(`Current branch is: ${currentBranch}`);
                return currentBranch;
            } else {
                 outputChannel.appendLine('`git branch --show-current` returned empty output.');
                 // This might happen in detached HEAD state, though less common with --show-current
                 throw new Error('Could not determine current branch (empty output). Possibly in detached HEAD state?');
            }
        } else {
            outputChannel.appendLine(`'git branch --show-current' failed. Exit code: ${exitCode}`);
            // Attempt fallback for older Git versions? `git rev-parse --abbrev-ref HEAD` is an alternative
            // For now, just error out based on the plan.
            throw new Error('Failed to get current branch name.');
        }
    } catch (error) {
        outputChannel.appendLine(`Error getting current branch: ${error.message}`);
        // Re-throw the specific error
        throw new Error(`Failed to determine current branch: ${error.message}`);
    }
}


// This method is called when your extension is activated
/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) { // Restored async

    // Create output channel
    outputChannel = vscode.window.createOutputChannel("GitLab MR Flow");
    outputChannel.appendLine('Activating GitLab MR Flow extension...'); // Restored original message

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('gitlab-mr-flow.createMergeRequest', async function () {
        // The code you place here will be executed every time your command is executed
        outputChannel.appendLine('Command "gitlab-mr-flow.createMergeRequest" triggered.');
        vscode.window.showInformationMessage('Starting GitLab MR Flow...'); // Placeholder

        try {
            // --- Step 1: Get Workspace Root & Check for .git ---
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder open.');
                outputChannel.appendLine('Error: No workspace folder open.');
                return;
            }
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            outputChannel.appendLine(`Workspace root: ${workspaceRoot}`);

            try {
                await fs.access(path.join(workspaceRoot, '.git'));
                outputChannel.appendLine('Found .git directory.');
            } catch (error) {
                vscode.window.showErrorMessage('Current workspace is not a Git repository.');
                outputChannel.appendLine('Error: .git directory not found.');
                return;
            }

            // --- Step 3: Remote Origin Identification ---
            const originUrl = await getOriginUrl(workspaceRoot);
            outputChannel.appendLine(`Using origin URL: ${originUrl}`); // Note: originUrl isn't directly used by git commands here, but good to have logged.

            // --- Step 4: Target Branch Determination ---
            const targetBranch = await getTargetBranch(workspaceRoot);
            outputChannel.appendLine(`Target branch set to: ${targetBranch}`);

            // --- Step 5: Current Branch Identification ---
            const currentBranch = await getCurrentBranch(workspaceRoot);
            outputChannel.appendLine(`Current branch identified as: ${currentBranch}`);

            // --- Step 6: Fetch and Merge Remote Changes ---
            outputChannel.appendLine(`Fetching updates from origin...`);
            const fetchResult = await runGitCommand(['fetch', 'origin'], workspaceRoot, 'fetch origin');
            if (fetchResult.exitCode !== 0) {
                outputChannel.appendLine(`Git fetch failed with exit code ${fetchResult.exitCode}.`);
                vscode.window.showErrorMessage(`Git fetch from origin failed. Check Output channel for details.`);
                return; // Stop execution
            }
            outputChannel.appendLine('Fetch successful.');

            outputChannel.appendLine(`Attempting to merge origin/${targetBranch} into ${currentBranch}...`);
            // Use --no-commit --no-ff to allow inspection/resolution before commit, though git push handles the MR creation.
            // Standard merge is likely fine here as the push command handles the MR options. Let's stick to a standard merge.
            const mergeResult = await runGitCommand(['merge', `origin/${targetBranch}`], workspaceRoot, `merge origin/${targetBranch}`);

            // Check for conflicts or other errors during merge
            if (mergeResult.exitCode !== 0) {
                const errorOutput = mergeResult.stderr || mergeResult.stdout || ''; // Combine outputs for checking
                // Check specifically for merge conflict indicators
                if (errorOutput.includes('Merge conflict') || errorOutput.includes('Automatic merge failed; fix conflicts and then commit the result.')) {
                    outputChannel.appendLine('Merge conflict detected.');
                    vscode.window.showErrorMessage('Merge conflicts detected. Please resolve them manually (e.g., using VS Code\'s Source Control view), commit the merge, and then run the command again.');
                    return; // Stop execution
                } else if (errorOutput.includes('fatal: Need to specify how to reconcile divergent branches.')) {
                    // This specific error shouldn't happen with fetch + merge, but handle defensively
                    outputChannel.appendLine('Error: Divergent branches detected during merge attempt.');
                    vscode.window.showErrorMessage('Error: Divergent branches. This shouldn\'t happen with fetch+merge. Check Git status and Output channel.');
                    return; // Stop execution
                }
                else {
                    outputChannel.appendLine(`Git merge failed with exit code ${mergeResult.exitCode}.`);
                    vscode.window.showErrorMessage(`Git merge of origin/${targetBranch} failed. Check Output channel for details.`);
                    return; // Stop execution
                }
            }
            outputChannel.appendLine('Merge successful.');

            // --- Step 7: Push and Create Merge Request ---
            outputChannel.appendLine(`Attempting to push ${currentBranch} to origin and create MR targeting ${targetBranch}...`);
            const pushArgs = [
                'push',
                'origin',
                currentBranch, // Push the current branch
                '-o', `merge_request.create`,
                '-o', `merge_request.target=${targetBranch}`
            ];
            const pushResult = await runGitCommand(pushArgs, workspaceRoot, 'push and create merge request');

            if (pushResult.exitCode === 0) {
                outputChannel.appendLine('Push and MR creation command successful.');
                // Check stdout/stderr for GitLab's confirmation message if needed, but a success code is usually enough
                vscode.window.showInformationMessage(`Successfully pushed ${currentBranch} and initiated Merge Request creation targeting ${targetBranch}.`);
            } else {
                outputChannel.appendLine(`Push and MR creation command failed. Exit code: ${pushResult.exitCode}`);
                vscode.window.showErrorMessage(`Failed to push or create Merge Request. Exit Code: ${pushResult.exitCode}. Check Output channel for details.`);
                // No return here, let the function finish
            }

        } catch (error) {
            outputChannel.appendLine(`Unhandled error: ${error.message || error}`);
            vscode.window.showErrorMessage(`GitLab MR Flow failed: ${error.message || 'Unknown error'}. Check Output channel.`);
        }
    });

    // Register the test command - REMOVED
    // let helloWorldDisposable = vscode.commands.registerCommand('gitlab-mr-flow.helloWorld', () => {
    //     vscode.window.showInformationMessage('Hello World from GitLab MR Flow!');
    //     outputChannel.appendLine('Command "gitlab-mr-flow.helloWorld" triggered.');
    // });

    context.subscriptions.push(disposable); // Push the original command
    // context.subscriptions.push(helloWorldDisposable); // REMOVED
    context.subscriptions.push(outputChannel); // Add channel to subscriptions for disposal
    outputChannel.appendLine('GitLab MR Flow extension activated successfully.'); // Restored original message
}

// This method is called when your extension is deactivated
function deactivate() {
    // Ensure outputChannel exists before trying to use it
    if (outputChannel) {
        outputChannel.appendLine('Deactivating GitLab MR Flow extension.');
    } else {
        console.log('Deactivating GitLab MR Flow extension (output channel not initialized).'); // Keep console log for safety
    }
}

module.exports = {
    activate,
    deactivate
}
