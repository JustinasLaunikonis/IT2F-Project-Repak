# IT2F Project Repak

## Contributing through pull requests

All changes to `main` must go through a pull request (PR). Reviewer approvals are not required, but asking a teammate to review your PR is encouraged.

Each feature should have its own branch and subsequently a pull request.

Branches allow normal commits and pushes. Work on a separate branch, push it, and open a PR targeting `main`. Merge that PR on GitHub. **DO NOT** merge locally into `main` and try to push it directly.


### 1. Update main, then create and check out a branch

These examples use PowerShell. Change the repository path if your clone is elsewhere, and choose a new branch name for each task.

```powershell
Set-Location "C:\Users\MSI\Desktop\IT2F-Project-Repak"
git status

# Switch to the existing main branch on your computer.
git checkout main

# Download main from GitHub (origin). --ff-only stops if local and remote history have diverged.
git pull --ff-only origin main

git checkout -b docs/update-contribution-guide
```

`git checkout -b` creates the branch and switches to it. To return to an existing local branch later, use:

```powershell
git checkout docs/update-contribution-guide
```

### 2. Edit, commit, and push your branch

After editing the relevant files, review your changes and stage only the files for this task. This example commits a README change:

```powershell
git status
git add README.md
git commit -m "document the pull request contribution workflow"

# Upload this branch to GitHub. -u remembers its remote branch for future git push commands.
git push -u origin docs/update-contribution-guide
```
For later commits on this branch, repeat the review and commit steps, then run `git push`.

### 3. Open and merge the pull request

1. Open the repository's [pull requests page](https://github.com/JustinasLaunikonis/IT2F-Project-Repak/pulls) and select **New pull request**.
2. Choose `main` as the base and `docs/update-contribution-guide` as the compare branch.
3. Review the changes, describe what changed and how you checked it, then create the PR.
4. Resolve any conflicts and address feedback. When the PR is ready, use GitHub merge button and confirm the merge.


Alternatively, install the GitHub CLI (`gh`) and run these commands from the repository directory. If you have not authenticated yet, sign in first:

```powershell
gh auth login
```

Create the PR after pushing your branch:

```powershell
# Open a PR into --base main from your --head branch. Follow the title and description prompts.
gh pr create --base main --head docs/update-contribution-guide
```

After reviewing the PR, resolving conflicts, and addressing feedback, merge it with:

```powershell
# Merge this branch's PR on GitHub. --merge joins its commits into main with a merge commit.
gh pr merge docs/update-contribution-guide --merge
```

### 4. Update main and delete the finished branch

After GitHub confirms that the PR was merged, switch back to `main` and download the merged changes:

```powershell
git checkout main

# Download the merged main from GitHub. --ff-only stops if local and remote history have diverged.
git pull --ff-only origin main
```

While on `main`, check that all your branch's changes reached `main` and that no unmerged work remains. Then delete the finished branch on GitHub and on your computer:

```powershell
# Delete the finished branch on GitHub (origin). This does not delete your local branch.
git push origin --delete docs/update-contribution-guide

# Delete the local feature branch. -d refuses if Git does not consider its commits merged.
git branch -d docs/update-contribution-guide
```

If GitHub already deleted the branch, skip only `git push origin --delete docs/update-contribution-guide`. In that case run the local deletion command.
