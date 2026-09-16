/** Menjalankan seluruh pemeriksaan: transisi status lalu render halaman. */
import { execFileSync } from 'node:child_process';

function run(label, command, args) {
  console.log(`\n── ${label} ──`);
  execFileSync(command, args, { stdio: 'inherit' });
}

try {
  run('Transisi status & validasi', process.execPath, ['scripts/flow-check.mjs']);

  execFileSync(
    'npx',
    [
      'esbuild',
      'scripts/registration-e2e.jsx',
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--jsx=automatic',
      '--outfile=scripts/.e2e.built.cjs',
      '--loader:.css=empty',
    ],
    { stdio: 'ignore' },
  );
  run('Registrasi end-to-end lewat store', process.execPath, ['scripts/.e2e.built.cjs']);
  run('Mesin questionnaire', process.execPath, ['scripts/questionnaire-check.mjs']);
  run('Kualifikasi pemasok', process.execPath, ['scripts/qualification-check.mjs']);
  run('Master data Data Umum', process.execPath, ['scripts/masterdata-check.mjs']);

  execFileSync(
    'npx',
    [
      'esbuild',
      'scripts/render-check.jsx',
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--jsx=automatic',
      '--outfile=scripts/.render-check.built.cjs',
      '--loader:.css=empty',
    ],
    { stdio: 'ignore' },
  );
  run('Render halaman & guard akses', process.execPath, ['scripts/.render-check.built.cjs']);

  console.log('\nSemua pemeriksaan lolos.\n');
} catch {
  console.error('\nAda pemeriksaan yang gagal.\n');
  process.exit(1);
}
