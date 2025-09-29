const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function getCurrentBranch(cwd) {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

module.exports = {
  getCurrentBranch,
};


