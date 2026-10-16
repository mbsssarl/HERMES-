// Configure les clés de signature des sessions (JWT_PRIVATE_KEY + JWKS) sur le déploiement Convex.
// Sans elles, toute connexion échoue côté serveur (le navigateur n'affiche qu'une « Server Error »).
//
//   npm run auth:setup              -> déploiement de dev (celui de `npx convex dev`)
//   npm run auth:setup -- --prod    -> déploiement de production
//   npm run auth:setup -- --force   -> régénère les clés même si elles existent (déconnecte tout le monde)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';

const args = process.argv.slice(2);
const target = args.includes('--prod') ? ['--prod'] : [];
const force = args.includes('--force');

// On lance la CLI Convex directement avec Node, SANS shell : sous Windows un shell découperait la clé
// (qui contient des espaces) en plusieurs arguments.
const convexDir = join(process.cwd(), 'node_modules', 'convex');
const pkg = JSON.parse(readFileSync(join(convexDir, 'package.json'), 'utf8'));
const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.convex;
const convexCli = join(convexDir, bin);
const convex = (...a) =>
  execFileSync(process.execPath, [convexCli, ...a, ...target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function has(name) {
  try {
    return convex('env', 'get', name).trim().length > 0;
  } catch {
    return false;
  }
}

if (!force && has('JWT_PRIVATE_KEY') && has('JWKS')) {
  console.log('JWT_PRIVATE_KEY et JWKS sont déjà définis. Rien à faire (utilisez --force pour les régénérer).');
  process.exit(0);
}

const keys = await generateKeyPair('RS256', { extractable: true });
const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, ' ');
const jwks = JSON.stringify({ keys: [{ use: 'sig', ...(await exportJWK(keys.publicKey)) }] });

// « -- » : la clé commence par des tirets, la CLI ne doit pas la prendre pour une option.
convex('env', 'set', 'JWT_PRIVATE_KEY', '--', privateKey);
convex('env', 'set', 'JWKS', '--', jwks);
console.log(`Clés d'authentification enregistrées sur le déploiement Convex ${target.length ? '(production)' : '(dev)'}.`);
