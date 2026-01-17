# WBU Atomique Theme

## Installation

1. Clonez le dépôt principal :

   ```bash
   git clone -b 2x https://github.com/habeuk/wbu-atomique
   cd wbu-atomique
   npm install
   ```

2. Clonez ce dépôt :
   ```bash
   git clone <url-de-ce-repository>
   cd <nom-du-repertoire-clone>
   npm install {chemin-vers-wbu-atomique}
   ```

## Configuration

1. Copiez le répertoire `theme_src` dans le projet où il doit être utilisé.
2. Modifiez le fichier `config.json` :
   - `inDir` doit pointer vers `theme_src`.
   - `outDir` doit pointer vers le répertoire où les fichiers générés seront placés (ce répertoire sera créé automatiquement s'il n'existe pas).

## Utilisation

1. Ouvrez le fichier `auto_generate_entries.json`.
2. Configurez les fichiers à générer :
   - La clé représente le nom du fichier de sortie (par exemple, `vendor` => `vendor.{js,css}` dans `outDir`).
   - La valeur représente le fichier source à compiler depuis `inDir`.
   - lancer la commande `npm run build` pour compiler ou `npm run Prod` pour watch les modifications des fichiers configuré dans `auto_generate_entries.json`
