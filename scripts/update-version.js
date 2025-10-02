const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageJson = require(packageJsonPath);

const gitTag = execSync('git describe --tags').toString().trim();
packageJson.version = gitTag;

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`Updated version to ${gitTag}`);
