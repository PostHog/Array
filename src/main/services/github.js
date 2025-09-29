// Stub GitHub service for future use
// In the future we can add: listBranches, createBranch, createPR, getRepoInfo, etc.

async function listBranches() {
  return [];
}

async function createPullRequest() {
  return { url: '' };
}

module.exports = {
  listBranches,
  createPullRequest,
};


