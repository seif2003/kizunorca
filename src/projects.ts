import type { Net } from './net';
import type { Mode } from './App';

/** Projets enregistrés dans le navigateur de l'appli (localStorage) — pas de compte, pas de serveur. */
export type Project = { id: string; name: string; mode: Mode; net: Net; updated: number };
const KEY = 'kizunaqua.projects'; // nom d'avant le renommage en KizunOrca, gardé pour ne pas perdre les projets enregistrés

export function listProjects(): Project[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
export function saveProject(p: Project): Project[] {
  const all = [{ ...p, updated: Date.now() }, ...listProjects().filter((x) => x.id !== p.id)];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { alert('Stockage plein : exportez le projet en .inp'); }
  return all;
}
export function deleteProject(id: string): Project[] {
  const all = listProjects().filter((x) => x.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}
export const newProject = (name: string, mode: Mode, net: Net): Project => ({ id: crypto.randomUUID(), name, mode, net, updated: Date.now() });
