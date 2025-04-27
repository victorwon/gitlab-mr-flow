
## Features

- Create Merge Requests directly from VS Code.
- Uses git CLI, no API tokens needed.
- Supports multi-root workspace.

## Usage

1. Open the Source Control view in VS Code.
2. Click the "GitLab MR Flow: Create Merge Request" button in the title bar.
3. The extension will merge the HEAD of the default branch from remote with the current feature branch, then create the MR and open it in browser.
4. Finally the extension will switch local branch back to the default branch, allowing user to delete the feature branch, if wanted.

