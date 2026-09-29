export function providerErrorMessage(error) {
  const raw = String(error?.message || error || 'Erreur inconnue');
  const status = Number(error?.response?.status || error?.status || raw.match(/\bstatus (\d{3})\b/i)?.[1]);
  if (status === 429) return 'Replicate reçoit trop de demandes (429). Réessayez dans quelques instants ; les images déjà prêtes seront réutilisées.';
  if (status >= 500 && status < 600) return `Replicate est temporairement indisponible (${status}). Relancez la génération ; les images déjà prêtes seront réutilisées.`;
  if (/<(?:!doctype|html|head|body)\b/i.test(raw)) return 'Le service de génération a renvoyé une page d’erreur. Réessayez dans quelques instants.';
  return raw.slice(0, 500);
}
