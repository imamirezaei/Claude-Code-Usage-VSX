const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.cwd();
const TARGETS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "release-targets.json"), "utf8")
);
const basePackage = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
);

const targetArg = process.argv[2];
const targets = targetArg === "all" ? Object.keys(TARGETS) : [targetArg];

if (!targetArg || targets.some((target) => !TARGETS[target])) {
  console.error("Usage: node scripts/package-marketplace.js <openvsx|vscode|all>");
  process.exit(1);
}

execFileSync("npm", ["run", "build"], {
  cwd: ROOT,
  stdio: "inherit",
});

for (const targetName of targets) {
  const target = TARGETS[targetName];
  const stageDir = path.join(ROOT, target.outputDir, "staging");
  const outputFile = path.join(
    ROOT,
    target.outputDir,
    `${target.name}-${basePackage.version}.vsix`
  );

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(stageDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(stageDir, "dist"), { recursive: true });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const stagedPackage = {
    ...basePackage,
    name: target.name,
    displayName: target.displayName,
    publisher: target.publisher,
    files: [...(basePackage.files || []), "LICENSE.txt"],
  };

  delete stagedPackage.scripts;
  delete stagedPackage.devDependencies;

  fs.writeFileSync(
    path.join(stageDir, "package.json"),
    `${JSON.stringify(stagedPackage, null, 2)}\n`
  );
  fs.copyFileSync(path.join(ROOT, "README.md"), path.join(stageDir, "README.md"));
  fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(stageDir, "LICENSE.txt"));
  fs.copyFileSync(
    path.join(ROOT, "assets", "icon.png"),
    path.join(stageDir, "assets", "icon.png")
  );
  fs.copyFileSync(
    path.join(ROOT, "dist", "extension.js"),
    path.join(stageDir, "dist", "extension.js")
  );
  fs.copyFileSync(
    path.join(ROOT, "dist", "extension.js.map"),
    path.join(stageDir, "dist", "extension.js.map")
  );

  execFileSync(
    "npx",
    ["vsce", "package", "--no-dependencies", "--out", outputFile],
    {
      cwd: stageDir,
      stdio: "inherit",
    }
  );

  fs.rmSync(stageDir, { recursive: true, force: true });
}
