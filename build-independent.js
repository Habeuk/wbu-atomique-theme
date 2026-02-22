// build-independent.js
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

// Configuration
const CONFIG = {
  maxMemoryMB: 2048,
  batchSize: 10, // Nombre de fichier generer durant un processus.
  maxConcurrent: 1, // Nombre de processus "node" en concurrence.
  nodeOptions: `--max-old-space-size=${Math.floor(2048 * 0.8)}`,
};

// Charger les entrées
const entriesPath = path.resolve(__dirname, "auto_generate_entries.json");
if (!fs.existsSync(entriesPath)) {
  console.error("❌ Fichier auto_generate_entries.json introuvable");
  process.exit(1);
}

const allEntries = JSON.parse(fs.readFileSync(entriesPath, "utf-8"));
const entryNames = Object.keys(allEntries);
console.log(`📊 ${entryNames.length} entrées détectées`);

// ------------------------------------------------------
// 1. Génération Config Webpack - MULTI-ENTRÉES
// ------------------------------------------------------
function createMultiEntryWebpackConfig(entriesObject) {
  // entriesObject: { [entryName]: entryPath, ... }
  const entryStrings = Object.entries(entriesObject)
    .map(
      ([name, entryPath]) =>
        `'${name}': '${path.resolve(__dirname, entryPath)}'`,
    )
    .join(",\n        ");

  return `
    const MiniCssExtractPlugin = require('mini-css-extract-plugin');
    const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
    const TerserPlugin = require('terser-webpack-plugin');
    const path = require('path');

    const devMode = process.env.NODE_ENV !== "production";

    module.exports = {
      mode: devMode ? "development" : "production",

      entry: {
        ${entryStrings}
      },

      output: {
        path: '${path.resolve(__dirname, "../")}',
        filename: './js/[name].js',
      },

      devtool: devMode ? "inline-source-map" : false,

      cache: {
        type: "memory",
      },

      module: {
        rules: [
          {
            test: /\\.js$/,
            exclude: /node_modules/,
            use: {
              loader: 'babel-loader',
              options: {
                presets: ['@babel/preset-env']
              }
            }
          },
          // fichiers SCSS / CSS
          {
            test: /\\.(sa|sc|c)ss$/,
            use: [
              MiniCssExtractPlugin.loader,
              {
                loader: 'css-loader',
                options: { importLoaders: 1, url: false } 
              },
              {
                loader: 'postcss-loader',
                options: {
                  sourceMap: devMode,
                  postcssOptions: {
                    plugins: [
                      require("autoprefixer")
                    ]
                  }
                }
              },
              {
                loader: 'sass-loader',
                options: { sourceMap: devMode }
              }
            ]
          },

          {
            test: /\\.(gif|png|jpe?g)$/i,
            type: "asset/resource",
            generator: {
              filename: "images/[name][ext]"
            }
          },

          {
            test: /\\.svg$/i,
            type: "asset/resource",
            generator: {
              filename: "icons/[name][ext]"
            }
          },

          {
            test: /\\.(eot|ttf|woff|woff2)$/i,
            type: "asset/resource",
            generator: {
              filename: "fonts/[name][ext]"
            }
          }
        ]
      },

      plugins: [
        new MiniCssExtractPlugin({
          filename: "./css/[name].css"
        })
      ],

      optimization: {
        minimize: !devMode,
        minimizer: [
          new CssMinimizerPlugin(),
          new TerserPlugin()
        ],
        splitChunks: {
          cacheGroups: {
            vendor: {
              test: /[\\\\/]node_modules[\\\\/]/,
              name: 'vendors',
              chunks: 'all',
              minChunks: 2,
            },
            // styles: {
            //   test: /\\.css$/,
            //   name: 'styles',
            //   chunks: 'all',
            //   enforce: true,
            // },
          },
        },
      },

      performance: { 
        hints: false,
        maxEntrypointSize: 512000,
        maxAssetSize: 512000
      },
      
      stats: {
        colors: true,
        modules: false,
        children: false,
        chunks: false,
        chunkModules: false,
        entrypoints: false
      }
    };
  `;
}

// ------------------------------------------------------
// 2. Build d'un LOT d'entrées
// ------------------------------------------------------
function buildEntryChunk(chunkEntries, chunkIndex, totalChunks, totalEntries) {
  return new Promise((resolve) => {
    const entryNames = Object.keys(chunkEntries);
    console.log(
      `[Lot ${chunkIndex + 1}/${totalChunks}] 🔨 ${entryNames.length} entrées: ${entryNames.join(", ")}`,
    );

    const configContent = createMultiEntryWebpackConfig(chunkEntries);
    const tempId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const configPath = path.join(__dirname, `.temp-config-${tempId}.js`);

    fs.writeFileSync(configPath, configContent, "utf8");

    // Calcul mémoire adaptative selon la taille du lot
    const chunkMemory = Math.min(
      CONFIG.maxMemoryMB,
      Math.floor(CONFIG.maxMemoryMB * 0.6 + entryNames.length * 50), // Base + 50MB par entrée
    );

    const webpackProcess = spawn(
      "node",
      [
        `--max-old-space-size=${chunkMemory}`,
        require.resolve("webpack/bin/webpack.js"),
        "--config",
        configPath,
        "--color",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        env: {
          ...process.env,
          NODE_OPTIONS: `--max-old-space-size=${chunkMemory}`,
        },
      },
    );

    let errorOutput = "";
    let stdOutput = "";
    let progressData = "";

    webpackProcess.stdout.on("data", (data) => {
      const output = data.toString();
      stdOutput += output;

      // Afficher la progression Webpack
      if (output.includes("%")) {
        process.stdout.write(`\r${output.trim()}`);
      }
    });

    webpackProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    webpackProcess.on("close", (code) => {
      // Nettoyage sécurisé
      try {
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
        }
      } catch (cleanupError) {
        console.warn(
          `⚠️ Impossible de supprimer ${configPath}: ${cleanupError.message}`,
        );
      }

      if (code === 0) {
        console.log(
          `\n   ✅ Lot ${chunkIndex + 1} terminé (${entryNames.length} entrées)`,
        );
        resolve({
          success: true,
          entries: entryNames,
          chunkIndex,
        });
      } else {
        console.log(`\n   ❌ Lot ${chunkIndex + 1} échoué`);

        // Essayer d'extraire les erreurs spécifiques
        const errorLines = errorOutput.split("\n");
        const entryErrors = {};

        entryNames.forEach((entryName) => {
          const entryError = errorLines.find(
            (line) =>
              line.includes(entryName) &&
              (line.includes("Error") ||
                line.includes("error") ||
                line.includes("Failed")),
          );
          if (entryError) {
            entryErrors[entryName] = entryError.substring(0, 200);
          }
        });

        resolve({
          success: false,
          entries: entryNames,
          chunkIndex,
          error:
            errorOutput.length > 0
              ? errorOutput.substring(0, 1000)
              : stdOutput.substring(0, 1000),
          entryErrors: Object.keys(entryErrors).length > 0 ? entryErrors : null,
          exitCode: code,
        });
      }
    });

    webpackProcess.on("error", (err) => {
      console.log(
        `   ❌ Lot ${chunkIndex + 1} - erreur de lancement: ${err.message}`,
      );
      resolve({
        success: false,
        entries: entryNames,
        chunkIndex,
        error: err.message,
      });
    });
  });
}

// ------------------------------------------------------
// 3. Gestionnaire de file d'attente optimisé
// ------------------------------------------------------
class OptimizedQueueManager {
  constructor(entries, maxConcurrent, batchSize) {
    this.allEntries = entries;
    this.maxConcurrent = maxConcurrent;
    this.batchSize = batchSize;
    this.running = 0;
    this.completedChunks = 0;
    this.succeededEntries = 0;
    this.failedEntries = [];
    this.totalEntries = entries.length;

    // Créer les chunks
    this.chunks = this.createChunks();
    this.totalChunks = this.chunks.length;
  }

  // Créer des chunks intelligents (regrouper par similarité de chemin)
  createChunks() {
    const chunks = [];
    const entriesArray = Object.entries(this.allEntries);

    // Trier les entrées par chemin pour regrouper les fichiers similaires
    entriesArray.sort((a, b) => a[1].localeCompare(b[1]));

    for (let i = 0; i < entriesArray.length; i += this.batchSize) {
      const chunkSlice = entriesArray.slice(i, i + this.batchSize);
      const chunkObject = {};
      chunkSlice.forEach(([name, path]) => {
        chunkObject[name] = path;
      });
      chunks.push(chunkObject);
    }

    console.log(
      `📦 Création de ${chunks.length} lots (max ${this.batchSize} entrées par lot)`,
    );
    return chunks;
  }

  async run() {
    console.log(`🚀 Démarrage avec ${this.maxConcurrent} processus parallèles`);
    console.log(
      `📊 Total: ${this.totalEntries} entrées en ${this.totalChunks} lots`,
    );

    const results = [];

    // Traiter les chunks avec limite de concurrence
    for (let i = 0; i < this.chunks.length; i += this.maxConcurrent) {
      const chunkBatch = this.chunks.slice(i, i + this.maxConcurrent);

      console.log(
        `\n⚡ Lot ${i + 1}-${Math.min(i + this.maxConcurrent, this.chunks.length)}/${this.chunks.length}`,
      );

      const batchPromises = chunkBatch.map((chunk, batchIndex) => {
        const chunkIndex = i + batchIndex;
        return this.processChunk(chunk, chunkIndex);
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);

      // Pause entre les batches pour éviter la surcharge
      if (i + this.maxConcurrent < this.chunks.length) {
        console.log("⏸️  Pause entre les batches...");
        await new Promise((res) => setTimeout(res, 2000));
      }
    }

    // Compiler les résultats
    return this.compileResults(results);
  }

  async processChunk(chunk, chunkIndex) {
    // Attendre qu'un slot se libère
    while (this.running >= this.maxConcurrent) {
      await new Promise((res) => setTimeout(res, 100));
    }

    this.running++;

    try {
      const result = await buildEntryChunk(
        chunk,
        chunkIndex,
        this.totalChunks,
        this.totalEntries,
      );

      this.running--;
      this.completedChunks++;

      // Mettre à jour les statistiques
      const entryCount = Object.keys(chunk).length;
      if (result.success) {
        this.succeededEntries += entryCount;
      } else {
        Object.keys(chunk).forEach((entryName) => {
          this.failedEntries.push({
            entryName,
            error: result.entryErrors?.[entryName] || result.error,
            chunkIndex,
          });
        });
      }

      return result;
    } catch (error) {
      this.running--;
      this.completedChunks++;

      // En cas d'erreur inattendue, marquer toutes les entrées du chunk comme échouées
      Object.keys(chunk).forEach((entryName) => {
        this.failedEntries.push({
          entryName,
          error: error.message,
          chunkIndex,
        });
      });

      return {
        success: false,
        entries: Object.keys(chunk),
        chunkIndex,
        error: error.message,
      };
    }
  }

  compileResults(results) {
    const failedChunks = results.filter(
      (r) =>
        r.status === "rejected" ||
        (r.status === "fulfilled" && !r.value.success),
    ).length;

    return {
      total: this.totalEntries,
      succeeded: this.succeededEntries,
      failed: this.failedEntries.length,
      totalChunks: this.totalChunks,
      failedChunks,
      failedEntries: this.failedEntries,
    };
  }
}

// ------------------------------------------------------
// 4. Construction complète optimisée
// ------------------------------------------------------
async function main() {
  console.log("🏗️  Construction des entrées en mode optimisé...");

  const cpuCount = Math.max(1, os.cpus().length - 1);
  const maxConcurrent = Math.min(cpuCount, CONFIG.maxConcurrent);

  console.log(
    `💻 CPUs disponibles: ${os.cpus().length} (utilisés: ${maxConcurrent})`,
  );
  console.log(`🧠 Mémoire max par processus: ${CONFIG.maxMemoryMB}MB`);

  const queue = new OptimizedQueueManager(
    allEntries,
    maxConcurrent,
    CONFIG.batchSize,
  );

  const startTime = Date.now();
  const result = await queue.run();
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("📊 RAPPORT FINAL - MODE OPTIMISÉ");
  console.log("=".repeat(60));
  console.log(`⏱️  Durée totale: ${duration}s`);
  console.log(`📦 Lots traités: ${result.totalChunks}`);
  console.log(`✅ Entrées réussies : ${result.succeeded}`);
  console.log(`❌ Entrées échouées : ${result.failed}`);
  console.log(`📊 Total traité : ${result.total}`);
  console.log(
    `🏎️  Performance: ${(result.total / duration).toFixed(2)} entrées/seconde`,
  );

  if (result.failed > 0) {
    console.log("\n📋 Détail des échecs :");

    // Grouper par chunk
    const failedByChunk = {};
    result.failedEntries.forEach((fail) => {
      if (!failedByChunk[fail.chunkIndex]) {
        failedByChunk[fail.chunkIndex] = [];
      }
      failedByChunk[fail.chunkIndex].push(fail);
    });

    Object.entries(failedByChunk).forEach(([chunkIndex, fails]) => {
      console.log(`  Lot ${parseInt(chunkIndex) + 1}:`);
      fails.forEach((fail, idx) => {
        console.log(
          `    ${idx + 1}. ${fail.entryName}: ${fail.error?.substring(0, 100)}...`,
        );
      });
    });

    console.log(
      "\n💡 Conseil: Essayez de réduire CONFIG.batchSize ou d'augmenter CONFIG.maxMemoryMB",
    );
    process.exit(1);
  }

  console.log("\n🎉 Toutes les entrées ont été construites avec succès!");
  process.exit(0);
}

// ------------------------------------------------------
// 5. buildCustom() optimisé
// ------------------------------------------------------
async function buildCustom(customEntries) {
  console.log(
    "\n🎯 Build personnalisé pour:",
    Object.keys(customEntries).join(", "),
  );

  // Si peu d'entrées, utiliser un seul chunk
  const batchSize =
    Object.keys(customEntries).length <= 5
      ? Object.keys(customEntries).length
      : 3;

  const queue = new OptimizedQueueManager(customEntries, 1, batchSize);
  const result = await queue.run();

  if (result.failed > 0) {
    console.error("❌ Certains builds ont échoué");
    process.exit(1);
  }
  console.log("✅ Build personnalisé terminé avec succès");
  process.exit(0);
}

// ------------------------------------------------------
// 6. Support CLI amélioré
// ------------------------------------------------------
if (process.argv.includes("--custom")) {
  const customIndex = process.argv.indexOf("--custom");
  const listArg = process.argv[customIndex + 1];

  if (!listArg || listArg.startsWith("--")) {
    console.error("❌ Usage: node build-independent.js --custom entry1,entry2");
    process.exit(1);
  }

  const names = listArg
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name);
  const customEntries = {};
  names.forEach((name) => {
    if (allEntries[name]) {
      customEntries[name] = allEntries[name];
    } else {
      console.warn(`⚠️  Entrée inconnue: ${name}`);
    }
  });

  if (Object.keys(customEntries).length === 0) {
    console.error("❌ Aucune entrée valide spécifiée");
    process.exit(1);
  }
  buildCustom(customEntries);
} else if (process.argv.includes("--help")) {
  console.log(`
Usage: node build-independent.js [options]

Options:
  --custom entry1,entry2  Build seulement les entrées spécifiées
  --help                  Affiche cette aide

Configuration dans le fichier:
  batchSize: ${CONFIG.batchSize} (entrées par lot)
  maxConcurrent: ${CONFIG.maxConcurrent} (processus parallèles)
  maxMemoryMB: ${CONFIG.maxMemoryMB} (mémoire par processus)
  `);
  process.exit(0);
} else {
  main();
}

// Gestion des signaux d'arrêt
process.on("SIGINT", () => {
  console.log("\n\n⚠️  Build interrompu par l'utilisateur");
  process.exit(130);
});

process.on("SIGTERM", () => {
  console.log("\n\n⚠️  Build terminé par le système");
  process.exit(143);
});

