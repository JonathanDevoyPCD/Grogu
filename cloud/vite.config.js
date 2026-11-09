import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || key.startsWith('sb_secret_')) {
    throw new Error('Provide the Supabase URL and publishable key, never a secret key.');
  }
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role !== 'anon') throw new Error('not an anon key');
    } catch { throw new Error('The legacy JWT key must be an anon key, not a service-role key.'); }
  } else if (!key.startsWith('sb_publishable_')) {
    throw new Error('Provide a Supabase publishable or legacy anon key.');
  }
  return {
    root: 'cloud',
    base: '/Grogu/',
    build: { outDir: '../dist', emptyOutDir: true }
  };
});
