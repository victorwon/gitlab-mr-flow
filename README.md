## Features

- Create Merge Requests directly from VS Code and open it in browser
- Uses git CLI, no API tokens needed - works right out of the box!
- Supports multi-root workspace
- Handles feature branches (prefix: `feat`) and fix branches (prefix: `fix`) 
- Manages merge conflicts gracefully
- Streamlined workflow with automatic branch switching

## Usage

1. Open the Source Control view in VS Code.
2. Click the "GitLab MR Flow: Create Merge Request" button in the title bar.
3. For feature/fix branches (starting with `feat` or `fix`), the extension will:
   1. Merge the HEAD of the default branch from remote with your current feature/fix branch
   2. Create the Merge Request in GitLab
   3. Open it in your browser where you can customize options such as squash, assignees, etc.
   4. Switch from your local feature/fix branch back to the default branch
4. For other branches, the extension will simply open the Merge Requests page in GitLab
5. After MR creation, you can manually delete the feature branch if desired

## How It Works

The extension works seamlessly with your existing GitLab workflow:

- No configuration needed - works with your existing Git repository setup
- Automatically detects your GitLab remote URL
- Intelligently determines the default target branch
- Uses standard Git commands behind the scenes with proper error handling
- Provides detailed logs in the Output panel (GitLab MR Flow channel)

## Requirements

- VS Code 1.60.0 or higher
- Git installed on your system
- A GitLab repository with push access

