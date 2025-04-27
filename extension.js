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
 * Reads .git/config and returns the URL and name for a remote.
 * Prompts the user if multiple remotes are found.
 * @param {string} workspaceRoot - The root path of the workspace.
 * @returns {Promise<{remoteName: string, remoteUrl: string}>} The selected remote's name and URL.
 * @throws {Error} If no remote URL is found, config is unreadable, or user cancels selection.
 */
async function getOrigin(workspaceRoot) {
    const configPath = path.join(workspaceRoot, '.git', 'config');
    outputChannel.appendLine(`Reading git config: ${configPath}`);
    let configContent;
    try {
        configContent = await fs.readFile(configPath, 'utf-8');
    } catch (error) {
        outputChannel.appendLine(`Error reading git config: ${error}`);
        throw new Error('Could not read .git/config file.');
    }

    const originRemotes = [];
    // Regex to find remote "origin" sections and their url
    const remoteOriginRegex = /\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\s#]+)/g;
    let match;
    while ((match = remoteOriginRegex.exec(configContent)) !== null) {
        originRemotes.push({ remoteName: 'origin', remoteUrl: match[1] });
    }

    if (originRemotes.length === 0) {
        outputChannel.appendLine('No remote "origin" URL found in .git/config. Trying to use any remote...');
        // Try to find any remote URL
        const remoteRegex = /\[remote\s+"(\S+)"\][^\[]*?url\s*=\s*([^\s#]+)/g;
        let remoteMatch;
        const allRemotes = [];
        while ((remoteMatch = remoteRegex.exec(configContent)) !== null) {
            allRemotes.push({ remoteName: remoteMatch[1], remoteUrl: remoteMatch[2] });
        }

        if (allRemotes.length === 0) {
            outputChannel.appendLine('No remote URLs found in .git/config.');
            throw new Error('No remote URLs found in .git/config.');
        } else if (allRemotes.length === 1) {
            outputChannel.appendLine(`Found single remote URL: ${allRemotes[0].remoteUrl}`);
            return allRemotes[0];
        } else {
            // Multiple remotes found, prompt user
            outputChannel.appendLine(`Multiple remote URLs found: ${allRemotes.map(r => r.remoteName + ': ' + r.remoteUrl).join(', ')}`);
            const selectedRemote = await vscode.window.showQuickPick(allRemotes.map(r => ({ label: r.remoteName, description: r.remoteUrl })), {
                placeHolder: 'Multiple remotes found. Please select the one to use.',
                ignoreFocusOut: true // Keep open even if focus moves
            });

            if (!selectedRemote) {
                outputChannel.appendLine('User cancelled remote selection.');
                throw new Error('Remote selection cancelled by user.');
            }

            const selected = allRemotes.find(r => r.remoteName === selectedRemote.label);
            outputChannel.appendLine(`User selected remote URL: ${selected.remoteUrl}`);
            return selected;
        }
    } else if (originRemotes.length === 1) {
        outputChannel.appendLine(`Found single origin URL: ${originRemotes[0].remoteUrl}`);
        return originRemotes[0];
    } else {
        // Multiple origins found, prompt user
        outputChannel.appendLine(`Multiple origin URLs found: ${originRemotes.map(r => r.remoteName + ': ' + r.remoteUrl).join(', ')}`);
        const selectedRemote = await vscode.window.showQuickPick(originRemotes.map(r => ({ label: r.remoteName, description: r.remoteUrl })), {
            placeHolder: 'Multiple "origin" remotes found. Please select the one to use.',
            ignoreFocusOut: true // Keep open even if focus moves
        });

        if (!selectedRemote) {
            outputChannel.appendLine('User cancelled origin selection.');
            throw new Error('Origin selection cancelled by user.');
        }

        const selected = originRemotes.find(r => r.remoteName === selectedRemote.label);
        outputChannel.appendLine(`User selected origin URL: ${selected.remoteUrl}`);
        return selected;
    }
}

/**
 * Determines the target branch for the merge request.
 * Tries to find the default branch using 'git remote show origin'.
 * Falls back to prompting the user with a list from 'git branch -r'.
 * @param {string} workspaceRoot - The root path of the workspace.
 * @returns {Promise<string>} The selected target branch name.
 * @throws {Error} If the target branch cannot be determined or user cancels selection.
 */
async function getTargetBranch(workspaceRoot, remoteName) {
    outputChannel.appendLine('Determining target branch...');

    // Attempt 1: Use 'git remote show'
    try {
        const remoteShowResult = await runGitCommand(['remote', 'show', remoteName], workspaceRoot, `show remote ${remoteName}`);
        if (remoteShowResult.exitCode === 0 && remoteShowResult.stdout) {
            const headBranchMatch = remoteShowResult.stdout.match(/HEAD branch:\s*(\S+)/);
            if (headBranchMatch && headBranchMatch[1]) {
                const defaultBranch = headBranchMatch[1];
                // Verify it's not '(unknown)' which sometimes happens
                if (defaultBranch !== '(unknown)') {
                    outputChannel.appendLine(`Found default remote branch via 'remote show': ${defaultBranch}`);
                    return defaultBranch;
                } else {
                     outputChannel.appendLine(`'git remote show ${remoteName}' reported HEAD branch as '(unknown)'.`);
                }
            } else {
                 outputChannel.appendLine(`Could not parse HEAD branch from 'git remote show ${remoteName}' output.`);
            }
        } else {
             outputChannel.appendLine(`'git remote show ${remoteName}' failed or produced no output. Exit code: ${remoteShowResult.exitCode}`);
        }
    } catch (error) {
        // Log error from runGitCommand but continue to fallback
        outputChannel.appendLine(`Error running 'git remote show ${remoteName}': ${error.message}. Falling back to 'git branch -r'.`);
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
    let disposable = vscode.commands.registerCommand('gitlab-mr-flow.createMergeRequest', async function (repository) {
        // The code you place here will be executed every time your command is executed
        outputChannel.appendLine(`Command "gitlab-mr-flow.createMergeRequest" triggered ${repository.rootUri}.`);
        vscode.window.showInformationMessage('Starting GitLab MR Flow...'); // Placeholder

        // --- Step 1: Get Workspace Root & Check for .git ---
        let workspaceRoot = '';
        if (repository && repository.rootUri) {
            workspaceRoot = repository.rootUri.fsPath;
            outputChannel.appendLine(`Workspace folder provided: ${workspaceRoot}`);
        } else {
            if (vscode.window.activeTextEditor) {
                let activeFile = vscode.window.activeTextEditor.document.uri.fsPath;
                outputChannel.appendLine(`Active file: ${activeFile}`);

                let dir = path.dirname(activeFile);
                while (dir !== path.dirname(dir)) { // Prevent infinite loop
                    try {
                        await fs.access(path.join(dir, '.git'));
                        workspaceRoot = dir;
                        outputChannel.appendLine(`Found Git root: ${workspaceRoot}`);
                        break;
                    } catch (err) {
                        dir = path.dirname(dir);
                    }
                }
            }

            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No Git repository found.');
                outputChannel.appendLine('Error: No Git repository found.');
                return;
            }
        }
        outputChannel.appendLine(`Workspace root: ${workspaceRoot}`);

        // --- Step 0: Check current branch name ---
        const currentBranch = await getCurrentBranch(workspaceRoot);
        if (!currentBranch.startsWith('feat')) {
            vscode.window.showErrorMessage('Merge Requests can only be created from feature branches with the "feat" prefix. e.g. feature/abc');
            outputChannel.appendLine(`Error: Current branch "${currentBranch}" does not start with "feat".`);
            return; // Stop execution
        } else {
            try {
                // --- Step 2: Check for .git directory ---
                try {
                    await fs.access(path.join(workspaceRoot, '.git'));
                    outputChannel.appendLine('Found .git directory.');
                } catch (error) {
                    vscode.window.showErrorMessage('Current workspace is not a Git repository.');
                    outputChannel.appendLine('Error: .git directory not found.');
                    return;
                }

                // --- Step 3: Remote Origin Identification ---
                const origin = await getOrigin(workspaceRoot);
                outputChannel.appendLine(`Using origin URL: ${origin.remoteUrl}`); // Note: originUrl isn't directly used by git commands here, but good to have logged.

                // --- Step 4: Target Branch Determination ---
                const targetBranch = await getTargetBranch(workspaceRoot, origin.remoteName);
                outputChannel.appendLine(`Target branch set to: ${targetBranch}`);

                // --- Step 5: Current Branch Identification ---
                // const currentBranch = await getCurrentBranch(workspaceRoot); // Already got it above
                outputChannel.appendLine(`Current branch identified as: ${currentBranch}`);

                // --- Step 6: Fetch and Merge Remote Changes ---
                outputChannel.appendLine(`Fetching updates from ${origin.remoteName}...`);
                const fetchResult = await runGitCommand(['fetch', origin.remoteName], workspaceRoot, `fetch ${origin.remoteName}`);
                if (fetchResult.exitCode !== 0) {
                    outputChannel.appendLine(`Git fetch failed with exit code ${fetchResult.exitCode}.`);
                    vscode.window.showErrorMessage(`Git fetch from origin failed. Check Output channel for details.`);
                    return; // Stop execution
                }
                outputChannel.appendLine('Fetch successful.');

                outputChannel.appendLine(`Attempting to merge ${origin.remoteName}/${targetBranch} into ${currentBranch}...`);
                // Use --no-commit --no-ff to allow inspection/resolution before commit, though git push handles the MR creation.
                // Standard merge is likely fine here as the push command handles the MR options. Let's stick to a standard merge.
                const mergeResult = await runGitCommand(['merge', `${origin.remoteName}/${targetBranch}`], workspaceRoot, `merge ${origin.remoteName}/${targetBranch}`);

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
                        vscode.window.showErrorMessage(`Error: Divergent branches. This shouldn't happen with fetch+merge. Check Git status and Output channel.`);
                        return; // Stop execution
                    }
                    else {
                        outputChannel.appendLine(`Git merge failed with exit code ${mergeResult.exitCode}.`);
                        vscode.window.showErrorMessage(`Git merge of ${origin.remoteName}/${targetBranch} failed. Check Output channel for details.`);
                        return; // Stop execution
                    }
                }
                outputChannel.appendLine('Merge successful.');

                // --- Step 7: Push and Create Merge Request ---
                outputChannel.appendLine(`Attempting to push ${currentBranch} to ${origin.remoteName} and create MR targeting ${targetBranch}...`);
                const pushArgs = [
                    'push',
                    origin.remoteName,
                    currentBranch, // Push the current branch
                    '-o', `merge_request.create`,
                    '-o', `merge_request.target=${targetBranch}`,
                    '-o', `merge_request.remove_source_branch=false`, // Add option to keep source branch
                    '-o', `merge_request.title=${currentBranch}` // Use feature branch name as MR name
                ];
                const pushResult = await runGitCommand(pushArgs, workspaceRoot, 'push and create merge request');

                if (pushResult.exitCode === 0) {
                    outputChannel.appendLine('Push and MR creation command successful.');

                    // --- Step 8: Parse MR URL and Open in Browser ---
                    let mrUrl = null;
                    const output = `${pushResult.stdout}\n${pushResult.stderr}`; // Combine stdout and stderr
                    const urlRegex = /remote:\s+(https?:\/\/[^\s]+)/i;
                    const match = output.match(urlRegex);

                    if (match && match[1]) {
                        mrUrl = match[1];
                        outputChannel.appendLine(`Found MR URL: ${mrUrl}`);
                        try {
                            await vscode.env.openExternal(vscode.Uri.parse(mrUrl));
                            outputChannel.appendLine(`Opened MR URL in browser.`);
                            vscode.window.showInformationMessage(`Successfully created Merge Request targeting ${targetBranch} and opened it in your browser.`);
                        } catch (openError) {
                            outputChannel.appendLine(`Error opening URL ${mrUrl}: ${openError}`);
                            // Show original success message if opening fails
                            vscode.window.showInformationMessage(`Successfully pushed ${currentBranch} and initiated Merge Request creation targeting ${targetBranch}. Failed to open URL.`);
                        }
                    } else {
                        outputChannel.appendLine('Could not find MR URL in push output. Attempting to construct MR URL from origin...');
                        try {
                            const origin = await getOrigin(workspaceRoot); // Reuse existing function
                            const baseUrl = origin.remoteUrl.endsWith('.git') ? origin.remoteUrl.slice(0, -4) : origin.remoteUrl; // Remove .git if present
                            const constructedMrUrl = `${baseUrl}/-/merge_requests`;

                            outputChannel.appendLine(`Constructed MR URL: ${constructedMrUrl}`);
                            await vscode.env.openExternal(vscode.Uri.parse(constructedMrUrl));
                            vscode.window.showInformationMessage(`Successfully pushed ${currentBranch} and navigated to Merge Requests page in your browser. Local branch remains ${currentBranch}.`);

                        } catch (constructError) {
                            outputChannel.appendLine(`Error constructing or opening MR URL: ${constructError.message}`);
                            vscode.window.showErrorMessage(`Push successful, but could not confirm Merge Request creation or open MR page. Please check GitLab manually. Local branch remains ${currentBranch}.`);
                        }
                        return; // Stop execution here, do not switch branch
                    }

                    // --- Step 9: Switch back to target branch locally ---
                    // This code will only be reached if the MR URL was found and opened (or failed to open)
                    outputChannel.appendLine(`Attempting to switch local branch to ${targetBranch}...`);
                    try {
                        const checkoutResult = await runGitCommand(['checkout', targetBranch], workspaceRoot, `checkout ${targetBranch}`);
                        if (checkoutResult.exitCode === 0) {
                            outputChannel.appendLine(`Successfully switched local branch to ${targetBranch}.`);
                            vscode.window.showInformationMessage(`Switched local branch to ${targetBranch}.`);
                        } else {
                            outputChannel.appendLine(`Failed to switch local branch to ${targetBranch}. Exit code: ${checkoutResult.exitCode}`);
                            // Show a warning, but don't treat it as a fatal error for the overall MR flow
                            vscode.window.showWarningMessage(`Merge request created, but failed to switch local branch back to ${targetBranch}. Check Output channel.`);
                        }
                    } catch (checkoutError) {
                        // Catch errors specifically from the checkout command
                        outputChannel.appendLine(`Error during checkout to ${targetBranch}: ${checkoutError.message}`);
                        vscode.window.showWarningMessage(`Merge request created, but encountered an error switching local branch back to ${targetBranch}. Check Output channel.`);
                    }

                } else {
                    outputChannel.appendLine(`Push and MR creation command failed. Exit code: ${pushResult.exitCode}`);
                    vscode.window.showErrorMessage(`Failed to push or create Merge Request. Exit Code: ${pushResult.exitCode}. Check Output channel for details.`);
                    // No return here, let the function finish
                }

            } catch (error) {
                outputChannel.appendLine(`Unhandled error: ${error.message || error}`);
                vscode.window.showErrorMessage(`GitLab MR Flow failed: ${error.message || 'Unknown error'}. Check Output channel.`);
            }
        }
    });

    context.subscriptions.push(disposable); // Push the original command
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
