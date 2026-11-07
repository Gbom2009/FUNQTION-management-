import { musicalKey } from './keys';

// Playlist exports. Rekordbox XML is the official way into Rekordbox (it shows
// up under "rekordbox xml" and you drag playlists in), and the free Rekordbox
// then builds CDJ sticks. M3U works on almost every player.

export interface ExportTrack {
  id: string;
  absPath: string;
  artist: string;
  title: string;
  mix?: string;
  album?: string;
  genre?: string;
  label?: string;
  year?: number;
  bpm?: number;
  key?: string;          // Camelot
  durationS?: number;
  sizeBytes?: number;
  comment?: string;
  hotCues?: { index: number; atMs: number; name?: string; color?: string }[];
}
export interface ExportPlaylist { name: string; trackIds: string[] }

const x = (s: string | number | undefined) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** file://localhost/Users/gijs/Music/A%20B.mp3 */
export function fileUrl(absPath: string): string {
  const p = absPath.replace(/\\/g, '/');
  const withRoot = /^[A-Za-z]:\//.test(p) ? `/${p}` : p;
  return `file://localhost${withRoot.split('/').map((seg) => encodeURIComponent(seg).replace(/%3A/i, ':')).join('/')}`;
}

const rgb = (hex?: string) => {
  const m = hex ? /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) : null;
  return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : [230, 40, 40];
};

export function rekordboxXml(tracks: ExportTrack[], playlists: ExportPlaylist[], appVersion = '1.0'): string {
  const ids = new Map(tracks.map((t, i) => [t.id, i + 1]));
  const L: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<DJ_PLAYLISTS Version="1.0.0">',
    `  <PRODUCT Name="Funqtion Library" Version="${x(appVersion)}" Company="Team Funqtion"/>`, `  <COLLECTION Entries="${tracks.length}">`];
  for (const t of tracks) {
    const name = t.mix ? `${t.title} (${t.mix})` : t.title;
    const attrs = [
      `TrackID="${ids.get(t.id)}"`, `Name="${x(name)}"`, `Artist="${x(t.artist)}"`, `Album="${x(t.album)}"`, `Genre="${x(t.genre)}"`,
      `Label="${x(t.label)}"`, `Year="${x(t.year)}"`, `Kind="${x((t.absPath.split('.').pop() ?? '').toUpperCase())} File"`,
      `Size="${t.sizeBytes ?? 0}"`, `TotalTime="${Math.round(t.durationS ?? 0)}"`, `AverageBpm="${t.bpm ? t.bpm.toFixed(2) : '0.00'}"`,
      `Tonality="${x(musicalKey(t.key) ?? '')}"`, `Comments="${x(t.comment)}"`, `Location="${x(fileUrl(t.absPath))}"`,
    ];
    const cues = t.hotCues ?? [];
    if (!cues.length) { L.push(`    <TRACK ${attrs.join(' ')}/>`); continue; }
    L.push(`    <TRACK ${attrs.join(' ')}>`);
    for (const c of cues) {
      const [r, g, b] = rgb(c.color);
      L.push(`      <POSITION_MARK Name="${x(c.name)}" Type="0" Start="${(c.atMs / 1000).toFixed(3)}" Num="${c.index}" Red="${r}" Green="${g}" Blue="${b}"/>`);
    }
    L.push('    </TRACK>');
  }
  L.push('  </COLLECTION>', '  <PLAYLISTS>', `    <NODE Type="0" Name="ROOT" Count="1">`, `      <NODE Type="0" Name="Funqtion" Count="${playlists.length}">`);
  for (const p of playlists) {
    const keys = p.trackIds.map((id) => ids.get(id)).filter(Boolean);
    L.push(`        <NODE Name="${x(p.name)}" Type="1" KeyType="0" Entries="${keys.length}">`);
    for (const k of keys) L.push(`          <TRACK Key="${k}"/>`);
    L.push('        </NODE>');
  }
  L.push('      </NODE>', '    </NODE>', '  </PLAYLISTS>', '</DJ_PLAYLISTS>', '');
  return L.join('\n');
}

/** Extended M3U with absolute (or stick-relative) paths. */
export function m3u(tracks: ExportTrack[], relativeTo?: string): string {
  const L = ['#EXTM3U'];
  for (const t of tracks) {
    L.push(`#EXTINF:${Math.round(t.durationS ?? -1)},${t.artist} - ${t.title}${t.mix ? ` (${t.mix})` : ''}`);
    L.push(relativeTo && t.absPath.startsWith(relativeTo) ? t.absPath.slice(relativeTo.length).replace(/^\/+/, '') : t.absPath);
  }
  return L.join('\n') + '\n';
}
