// Compatibility entrypoint: this now packages files without rendering games.
import { main } from './package-site.mjs';
main().catch(error => { console.error(error.message); process.exitCode = 1; });
