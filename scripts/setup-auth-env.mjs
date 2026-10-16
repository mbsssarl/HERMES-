// Crée les deux clés de connexion (JWT_PRIVATE_KEY et JWKS) sur le déploiement Convex sélectionné dans .env.local.
// Usage :  node scripts/setup-auth-env.mjs            (déploiement de développement)
//          node scripts/setup-auth-env.mjs --prod     (déploiement de production)
//          node scripts/setup-auth-env.mjs --dry-run  (génère les clés sans rien envoyer, affiche seulement leur taille)
//          node scripts/setup-auth-env.mjs --file     (écrit les clés dans .env.convex-auth, à coller dans le tableau de bord Convex,
//                                                      Settings > Environment Variables ; fichier ignoré par git, à supprimer ensuite)
// Les clés ne sont jamais affichées. Les relancer remplace les clés : tous les utilisateurs devront se reconnecter.
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");
const prod = process.argv.includes("--prod");
const toFile = process.argv.includes("--file");
const cli = path.resolve("node_modules/convex/bin/main.js");

const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const privatePem = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });

if (toFile) {
  fs.writeFileSync(".env.convex-auth", `JWT_PRIVATE_KEY="${privatePem}"
JWKS=${jwks}
`);
  console.log("Clés écrites dans .env.convex-auth (non envoyées). Collez-les dans le tableau de bord Convex, puis supprimez ce fichier.");
  process.exit(0);
}

let failed = false;
for (const [name, value] of [["JWT_PRIVATE_KEY", privatePem], ["JWKS", jwks]]) {
  if (dryRun) {
    console.log(`${name} : générée (${value.length} caractères), non envoyée (--dry-run)`);
    continue;
  }
  const args = [cli, "env", "set", ...(prod ? ["--prod"] : []), name, "--", value];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.status === 0) console.log(`${name} : définie`);
  else {
    failed = true;
    console.error(`${name} : échec\n${(result.stderr || result.stdout).trim().split("\n").slice(0, 3).join("\n")}`);
  }
}
if (failed) process.exit(1);
if (!dryRun) console.log("Terminé. Vérifiez avec : npx convex env list");
