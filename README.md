# LOLOCHAT

Messagerie privée sur invitation : pseudo + mot de passe (sans adresse mail), messages en temps réel, images PNG/GIF.

## Prérequis
- Node.js 20 ou plus récent
- npm

## Installation en local

1. Décompresse le projet et ouvre un terminal dans le dossier `lolochat`.
2. Installe les dépendances :

   ```bash
   npm install
   ```

3. Définis une clé de session longue et aléatoire.

   macOS / Linux :
   ```bash
   export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
   ```

   Windows PowerShell :
   ```powershell
   $env:SESSION_SECRET = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

4. Crée un code d'invitation à usage unique :

   ```bash
   npm run invite
   ```

5. Lance le serveur :

   ```bash
   npm start
   ```

6. Ouvre http://localhost:3000 dans ton navigateur. Transmets le code d'invitation à ton ami en privé. Chaque code ne peut servir qu'une fois.

Pour inviter d'autres amis, relance `npm run invite` pendant que le serveur est arrêté ou depuis un autre terminal dans le même dossier.

## Mettre le site en ligne

Il faut héberger l'application sur un service qui accepte Node.js et conserver les dossiers `data/` et `uploads/` entre les redémarrages (disque persistant / volume). Configure `SESSION_SECRET` dans les variables d'environnement de l'hébergeur et `NODE_ENV=production`. Utilise impérativement HTTPS en production.

Ne publie pas le code d'invitation dans un endroit public. Ne partage pas le fichier de base de données : il contient les comptes et les messages. Les mots de passe sont stockés sous forme de hachages bcrypt, jamais en clair.

## Notes
- Les messages texte sont limités à 2 000 caractères.
- Les images PNG/GIF sont limitées à 5 Mo.
- Les comptes et messages restent stockés dans SQLite.
- Cette version est un salon commun : tous les membres invités voient les messages du salon.
- Prévois des sauvegardes régulières du dossier `data/` et de `uploads/`.
