// dev-optimized.js
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
console.log("🚀 Mode développement optimisé lancé...\n");

// ===========================
// 1. Variables globales
// ===========================
let isBuilding = false;
let pendingBuild = null;
let debounceTimer = null;
var customFiles = "";
// Les entres de fichiers à generer.
var entries = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "auto_generate_entries.json")),
);
const fileToEntries = {};
// ===========================
// 2. Construit les elements
// ===========================
if (process.argv.includes("--custom")) {
  const customIndex = process.argv.indexOf("--custom");
  customFiles = process.argv[customIndex + 1];
  if (!customFiles || customFiles.startsWith("--")) {
    console.error("❌ Usage: node build-independent.js --custom entry1,entry2");
    process.exit(1);
  }
  const names = customFiles
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name);
  const customEntries = {};

  names.forEach((name) => {
    if (entries[name]) {
      customEntries[name] = entries[name];
    } else {
      console.warn(`⚠️  Entrée inconnue: ${name}`);
    }
  });
  if (Object.keys(customEntries).length === 0) {
    console.error("❌ Aucune entrée valide spécifiée");
    process.exit(1);
  }
  entries = customEntries;
  Object.entries(entries).forEach(([entryName, entryPath]) => {
    fileToEntries[path.resolve(entryPath)] = [entryName];
  });
} else {
  // ===================
  // On construit les chemins complet.
  // ===================
  Object.entries(entries).forEach(([entryName, entryPath]) => {
    fileToEntries[path.resolve(entryPath)] = [entryName];
  });
}

// ===========================
// 2. Fonction pour lancer un build
// ===========================
function runBuild(entryList) {
  // Si un build tourne déjà → on sauvegarde le prochain
  if (isBuilding) {
    pendingBuild = entryList;
    return;
  }

  isBuilding = true;

  console.log(`\n⚙️  Build déclenché : ${entryList}`);

  const build = spawn("node", ["build-independent.js", "--custom", entryList], {
    stdio: "inherit",
    shell: true,
  });

  build.on("close", (code) => {
    isBuilding = false;

    if (code === 0) {
      console.log(`\n✅ Build terminé : ${entryList}`);
    } else {
      console.log(`\n❌ Build échoué : ${entryList}`);
    }

    // Si un build était en attente, on le lance maintenant
    if (pendingBuild) {
      const next = pendingBuild;
      pendingBuild = null;
      runBuild(next);
    }
  });
}

// ===========================
// 3. Démarrer le watcher
// ===========================
function startWatcher() {
  const baseList = ["global-style", "vendor-style", "mail-style"].join(",");
  const watcher = chokidar.watch("./src", {
    ignored: /node_modules/,
    ignoreInitial: true,
    persistent: true,
  });
  watcher.on("change", (filePath) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const abs = path.resolve(filePath);
      console.log("\n🔍 Fichier modifié :", abs);
      if (fileToEntries[abs]) {
        // Reconstruction ciblée
        const list = fileToEntries[abs].join(",");
        runBuild(list);
      } else {
        // Fichier partagé → rebuild styles de base
        runBuild(baseList);
      }
    }, 200); // DEBOUNCE = 200ms
  });
  console.log("👁️  Watcher prêt.");
}

//
// 4. Build initial puis lancement du watcher
//
let config = ["build-independent.js"];
if (process.argv.includes("--custom")) {
  config = ["build-independent.js", "--custom", customFiles];
}
const initial = spawn("node", config, {
  stdio: "inherit",
  shell: true,
});

initial.on("close", (code) => {
  if (code === 0) {
    console.log("🎉 Build initial OK\n");
    startWatcher();
  } else {
    console.log("❌ Échec du build initial");
    process.exit(code);
  }
});

