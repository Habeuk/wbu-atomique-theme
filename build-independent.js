// build-independent.js
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

// Configuration
const CONFIG = {
  maxMemoryMB: 2048,
  batchSize: 50,
  maxConcurrent: 5,
  nodeOptions: `--max-old-space-size=${Math.floor(2048 * 0.8)}`, // Réserver 20% pour le parent
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
// 1. Génération Config Webpack
// ------------------------------------------------------
function createMinimalWebpackConfig(entryName, entryPath) {
  return `
    const MiniCssExtractPlugin = require('mini-css-extract-plugin');
    const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
    const TerserPlugin = require('terser-webpack-plugin');
    const path = require('path');

    const devMode = process.env.NODE_ENV !== "production";

    module.exports = {
      mode: devMode ? "development" : "production",

      entry: {
        '${entryName}': '${path.resolve(__dirname, entryPath)}'
      },

      output: {
        path: '${path.resolve(__dirname, "../")}',
        filename: './js/[name].js',
      },

      devtool: devMode ? "inline-source-map" : false,

      cache: {
        type: "filesystem",
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
        minimize: !devMode, // Seulement en production
        minimizer: [
          new CssMinimizerPlugin(),
          new TerserPlugin()
        ],
      },

      performance: { hints: false },
      stats: 'errors-only'
    };
  `;
}


// ------------------------------------------------------
// 2. Build d'une entrée
// ------------------------------------------------------
function buildSingleEntry(entryName, entryPath, index, total) {
  return new Promise((resolve) => {
    console.log(`[${index + 1}/${total}] 🔨 ${entryName}`);

    const configContent = createMinimalWebpackConfig(entryName, entryPath);
    const tempId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const configPath = path.join(__dirname, `.temp-config-${tempId}.js`);

    fs.writeFileSync(configPath, configContent, "utf8");

    const childMemory = Math.floor(CONFIG.maxMemoryMB * 0.8);
    const webpackProcess = spawn(
      "node",
      [
        `--max-old-space-size=${childMemory}`,
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
          NODE_OPTIONS: `--max-old-space-size=${childMemory}`,
        },
      }
    );

    let errorOutput = "";
    let stdOutput = "";

    webpackProcess.stdout.on("data", (data) => {
      stdOutput += data.toString();
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
          `⚠️ Impossible de supprimer ${configPath}: ${cleanupError.message}`
        );
      }

      if (code === 0) {
        console.log(`   ✅ ${entryName} terminé`);
        resolve({ entryName, success: true });
      } else {
        const errorPreview =
          errorOutput.length > 0
            ? errorOutput.substring(0, 500)
            : stdOutput.substring(0, 500);
        console.log(`   ❌ ${entryName} échoué (code: ${code})`);
        console.log(`      ${errorPreview.replace(/\n/g, "\n      ")}`);
        if (errorOutput.length > 500) {
          console.log(
            `      ... (${errorOutput.length - 500} caractères supplémentaires)`
          );
        }
        resolve({
          entryName,
          success: false,
          error: errorOutput || stdOutput,
          exitCode: code,
        });
      }
    });

    webpackProcess.on("error", (err) => {
      console.log(`   ❌ ${entryName} - erreur de lancement: ${err.message}`);
      resolve({
        entryName,
        success: false,
        error: err.message,
      });
    });
  });
}

// ------------------------------------------------------
// 3. Gestionnaire de file d'attente
// ------------------------------------------------------
class QueueManager {
  constructor(entries, maxConcurrent) {
    this.entries = entries;
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.completed = 0;
    this.succeeded = 0;
    this.failed = [];
    this.total = entries.length;
  }

  async run() {
    console.log(`🚀 Démarrage avec ${this.maxConcurrent} processus parallèles`);

    const chunks = [];
    for (let i = 0; i < this.entries.length; i += CONFIG.batchSize) {
      chunks.push(this.entries.slice(i, i + CONFIG.batchSize));
    }

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];

      console.log(
        `\n📦 Lot ${chunkIndex + 1}/${chunks.length} (${chunk.length} entrées)`
      );

      await this.processChunk(chunk);

      if (chunkIndex < chunks.length - 1) {
        console.log("⏸️  Pause entre les lots…");
        await new Promise((res) => setTimeout(res, 1000));
      }
    }

    return {
      total: this.total,
      succeeded: this.succeeded,
      failed: this.failed.length,
      failedEntries: this.failed,
    };
  }

  async processChunk(chunk) {
    const promises = [];

    for (const [chunkIndex, entry] of chunk.entries()) {
      const globalIndex = this.completed + chunkIndex;

      // Attendre qu'un slot se libère
      while (this.running >= this.maxConcurrent) {
        await new Promise((res) => setTimeout(res, 100));
      }

      this.running++;

      const promise = buildSingleEntry(
        entry.name,
        entry.path,
        globalIndex,
        this.total
      )
        .then((result) => {
          this.running--;
          this.completed++;

          if (result.success) {
            this.succeeded++;
          } else {
            this.failed.push(result);
          }

          return result;
        })
        .catch((error) => {
          this.running--;
          this.completed++;
          const failedResult = {
            entryName: entry.name,
            success: false,
            error: error.message,
          };
          this.failed.push(failedResult);
          return failedResult;
        });

      promises.push(promise);

      // Petit délai entre le lancement des processus
      await new Promise((res) => setTimeout(res, 100));
    }

    await Promise.allSettled(promises);
  }
}

// ------------------------------------------------------
// 4. Construction complète
// ------------------------------------------------------
async function main() {
  console.log("🏗️  Construction des entrées…");

  const entriesArray = Object.entries(allEntries).map(([name, path]) => ({
    name,
    path,
  }));

  const cpuCount = Math.max(1, os.cpus().length - 1); // Laisser un CPU libre
  const maxConcurrent = Math.min(cpuCount, CONFIG.maxConcurrent);

  console.log(
    `💻 CPUs disponibles: ${os.cpus().length} (utilisés: ${maxConcurrent})`
  );

  const queue = new QueueManager(entriesArray, maxConcurrent);
  const startTime = Date.now();

  const result = await queue.run();
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(50));
  console.log("📊 RAPPORT FINAL");
  console.log("=".repeat(50));
  console.log(`⏱️  Durée totale: ${duration}s`);
  console.log(`✅ Réussies : ${result.succeeded}`);
  console.log(`❌ Échouées : ${result.failed}`);
  console.log(`📊 Total traité : ${result.total}`);

  if (result.failed > 0) {
    console.log("\n📋 Détail des échecs :");
    result.failedEntries.forEach((fail, idx) => {
      console.log(
        `  ${idx + 1}. ${fail.entryName}: ${fail.error?.substring(0, 100)}...`
      );
    });
    process.exit(1);
  }

  process.exit(0);
}

// ------------------------------------------------------
// 5. buildCustom() pour dev-optimized.js
// ------------------------------------------------------
async function buildCustom(customEntries) {
  console.log(
    "\n🎯 Build personnalisé pour:",
    Object.keys(customEntries).join(", ")
  );

  const entries = Object.entries(customEntries).map(([name, path]) => ({
    name,
    path,
  }));
  const queue = new QueueManager(entries, 2); // Limiter à 2 en parallèle pour les builds custom
  const result = await queue.run();

  if (result.failed > 0) {
    console.error("❌ Certains builds ont échoué");
    process.exit(1);
  }

  console.log("✅ Build personnalisé terminé avec succès");
  process.exit(0);
}

// ------------------------------------------------------
// 6. Support CLI
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
