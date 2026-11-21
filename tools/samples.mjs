// Les discussions factices des tests ne sont pas dans Git (samples/ est ignoré) : on les fabrique
// au premier lancement. Il suffit d'importer ce module : import './samples.mjs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../samples/', import.meta.url);
if (!existsSync(new URL('WhatsApp Chat - Les Potes (avec médias).zip', root)) || !existsSync(new URL('WhatsApp Chat with The Crew.txt', root))) {
  console.log('Discussions de test absentes : fabrication (tools/make-sample.mjs)…');
  execFileSync(process.execPath, [fileURLToPath(new URL('./make-sample.mjs', import.meta.url))], { stdio: 'inherit' });
}
