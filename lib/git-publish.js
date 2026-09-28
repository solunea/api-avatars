// Deux administrations locales peuvent pousser le même commit presque simultanément.
// Si l'autre push a déjà réussi, la publication est accomplie malgré l'erreur Git.
export async function pushPublishedHead(runGit, options) {
  const git = args => runGit('git', args, options);
  try {
    await git(['push', 'origin', 'HEAD:main']);
    return;
  } catch (originalError) {
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const remote = (await git(['ls-remote', 'origin', 'refs/heads/main'])).stdout.trim().split(/\s+/)[0];
    if (remote === head) return;

    // Un autre push peut avoir avancé main sans contenir encore notre commit.
    // Retenter uniquement si l'historique distant est un ancêtre du nôtre.
    await git(['fetch', 'origin', 'main']);
    try { await git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD']); }
    catch { throw new Error('Le dépôt distant contient des changements différents. Synchronisez le catalogue avant de publier.'); }
    try { await git(['push', 'origin', 'HEAD:main']); }
    catch { throw originalError; }
  }
}
