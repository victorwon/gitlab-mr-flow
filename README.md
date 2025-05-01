
## Features

- Create Merge Requests directly from VS Code and open it in browser.
- Uses git CLI, no API tokens needed.
- Supports multi-root workspace.

## Usage

1. Open the Source Control view in VS Code.
2. Click the "GitLab MR Flow: Create Merge Request" button in the title bar.
3. The extension will 
   1. merge the HEAD of the default branch from remote with the current feature branch
   2. create the MR
   3. open it in browser where you can customize other options such as squash etc.
   4. switch from local feature branch to the default branch
4. Now you can manually delete the feature branch, if wanted.

