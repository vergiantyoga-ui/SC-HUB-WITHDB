import { createApp } from './app.js';
import { migrate, openDatabase } from './db/index.js';
import { startScheduler } from './jobs.js';

const port = Number(process.env.PORT ?? 3001);

openDatabase();
const applied = migrate();
if (applied.length) console.log(`Migrasi dijalankan: ${applied.join(', ')}`);

// `npm run migrate` memakai jalur ini: menjalankan migrasi lalu keluar, tanpa
// menyalakan server. Padanan `supabase db push`.
if (process.argv.includes('--migrate-only')) {
  console.log('Migrasi selesai.');
  process.exit(0);
}

startScheduler();

createApp().listen(port, () => {
  console.log(`Paragon server berjalan di http://localhost:${port}`);
});
