// Genera web/js/config.js a partir de variables de entorno (Vercel) o de .env.local.
// Uso: node tools/build-config.js   — si no hay variables, deja el archivo como está.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const env = Object.assign({}, process.env);
const local = path.join(root, '.env.local');
if (fs.existsSync(local)) {
  fs.readFileSync(local, 'utf8').split(/\r?\n/).forEach(function(line) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || '';
const key = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
if (!url || !key) {
  console.log('build-config: sin SUPABASE_URL / SUPABASE_ANON_KEY; se usa web/js/config.js tal cual.');
  process.exit(0);
}
const out = '/* Generado por tools/build-config.js — no editar a mano en Vercel. */\n' +
  'window.MISNOTAS_CONFIG = {\n' +
  '    supabaseUrl: ' + JSON.stringify(url.replace(/\/+$/, '')) + ',\n' +
  '    supabaseAnonKey: ' + JSON.stringify(key) + '\n};\n';
fs.writeFileSync(path.join(root, 'web/js/config.js'), out);
console.log('build-config: web/js/config.js generado para ' + url);
