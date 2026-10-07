/**
 * Reads a subscriptions export:
 *  - Google Takeout (YouTube and YouTube Music → subscriptions/subscriptions.csv):
 *    "Channel Id,Channel Url,Channel Title" (header names vary by language, so
 *    columns are found by content).
 *  - NewPipe's export (subscriptions.json): { subscriptions: [{ url, name }] }.
 * Pure, so it's unit-tested.
 */
import type { Subscription } from './types';

const CHANNEL_ID = /UC[A-Za-z0-9_-]{22}/;

export function parseSubscriptionsExport(text: string): Subscription[] {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) return [];
  const parsed = trimmed.startsWith('{') || trimmed.startsWith('[') ? fromJson(trimmed) : fromCsv(trimmed);
  const seen = new Set<string>();
  return parsed.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

function fromJson(text: string): Subscription[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : (data as { subscriptions?: unknown })?.subscriptions;
  if (!Array.isArray(list)) return [];
  const result: Subscription[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (e.service_id !== undefined && e.service_id !== 0) continue; // NewPipe: 0 is YouTube.
    const id = String(e.url ?? e.channelId ?? e.id ?? '').match(CHANNEL_ID)?.[0];
    if (!id) continue;
    result.push({ id, title: String(e.name ?? e.title ?? id) });
  }
  return result;
}

function fromCsv(text: string): Subscription[] {
  const rows = text.split(/\r?\n/).map(parseCsvLine).filter((r) => r.length > 0);
  const result: Subscription[] = [];
  for (const row of rows) {
    const idCell = row.findIndex((cell) => CHANNEL_ID.test(cell));
    if (idCell === -1) continue; // Header or blank line.
    const id = row[idCell].match(CHANNEL_ID)![0];
    // The title is the last cell that isn't the id or a URL.
    const title = [...row].reverse().find((cell) => cell && !CHANNEL_ID.test(cell) && !/^https?:\/\//i.test(cell));
    result.push({ id, title: title?.trim() || id });
  }
  return result;
}

/** One CSV line with quoted fields ("a, b" and "" escapes). */
export function parseCsvLine(line: string): string[] {
  if (!line.trim()) return [];
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}
