const esbuild = require('esbuild');

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

async function main() {
  const extCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: isProduction,
    sourcemap: !isProduction,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  const webviewCtx = await esbuild.context({
    entryPoints: ['src/ui/webview/client.ts', 'src/ui/webview/styles.css'],
    bundle: true,
    minify: isProduction,
    sourcemap: !isProduction,
    sourcesContent: false,
    platform: 'browser',
    target: 'es2022',
    outdir: 'dist',
    entryNames: 'webview',
    logLevel: 'info',
  });

  if (isWatch) {
    await Promise.all([extCtx.watch(), webviewCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([extCtx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), webviewCtx.dispose()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
