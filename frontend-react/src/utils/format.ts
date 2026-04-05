/** Format an ISO timestamp → "12 Jun 2025, 02:30 PM" */
export function formatDt(ts: string | null | undefined): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${date}, ${time}`;
  } catch {
    return ts;
  }
}

/** Get eye side from AI result — backend may return 'eye' or 'eye_side' */
export function getEyeSide(result: Record<string, unknown>): string {
  return ((result['eye_side'] ?? result['eye']) as string ?? '').toLowerCase();
}

/** Format confidence score (0-1 float → "87.3%") */
export function fmtConfidence(score: number | null | undefined): string {
  if (score == null) return '-';
  return score <= 1 ? `${(score * 100).toFixed(1)}%` : `${score.toFixed(1)}%`;
}

/** Shorten a UUID for display */
export function shortId(id: string | undefined): string {
  if (!id) return '-';
  return id.slice(0, 8) + '...';
}
