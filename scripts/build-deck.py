# Pitch KizunOrca (6 min) : 9 diapositives + film, sources vérifiables sur chaque preuve, annexes ensuite.
# Reprend l'en-tête du modèle HTML (polices, moteur de diaporama) ; le modèle lui-même n'est pas modifié.
# Usage (depuis hackthon/) : python -I kizunorca/scripts/build-deck.py
import base64, io, json, os, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'Optimisation des réseaux d’eau potable.html')
OUT = os.path.join(ROOT, 'KizunOrca-pitch.html')
K = os.path.join(ROOT, 'kizunorca')
BM = os.path.join(K, 'cases', 'benchmarks')
VIDEO = os.path.join(ROOT, 'presentation', 'out', 'intro.mp4')

tpl = open(SRC, encoding='utf8').read()
head = tpl[:tpl.index('<section class="deck-slide"')]
tail = tpl[tpl.index('</main>'):]
old = {int(m.group(1)): m.group(0) for m in re.finditer(r'<section class="deck-slide" id="(\d+)".*?</section>', tpl, re.S)}

def fr(x, d=0):
    return f'{x:,.{d}f}'.replace(',', ' ').replace('.', ',')
def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
def jpg(path, crop=None, w=1400):
    im = Image.open(path).convert('RGB')
    if crop: k = im.size[0] / 1512; im = im.crop(tuple(round(c * k) for c in crop))
    im.thumbnail((w, w)); b = io.BytesIO(); im.save(b, 'JPEG', quality=82)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

# ── charte : fond nuit, une couleur d'accent par idée ──
BG, INK, MUTED, CYAN, CORAL, GOLD, SAGE, CARD = '#071c29', '#f3f8fa', '#9fbccb', '#6cc4ee', '#ec5a61', '#e3b65b', '#7fc79a', 'rgba(255,255,255,.05)'
G = "'Space Grotesk', Arial, sans-serif"; I = "Inter, Arial, sans-serif"
def T(t, size, w=400, c=INK, f=I, extra=''):
    return f'<div style="font-family:{f};font-size:{size}px;font-weight:{w};line-height:1.15;color:{c};{extra}">{t}</div>'
def kicker(t, c=CYAN):
    return T(t, 26, 600, c, I, 'letter-spacing:4px;text-transform:uppercase;margin-bottom:18px')
def source(t):
    return f'<div style="position:absolute;left:110px;right:200px;bottom:40px;font-family:{I};font-size:19px;color:#6f8fa0;line-height:1.35">Source : {t}</div>'

slides = []
def slide(label, notes, inner, bg=BG):
    slides.append(f'<section class="deck-slide" id="x" aria-roledescription="slide" data-document-role="page" data-label="{esc(label)}" data-speaker-notes="{esc(notes)}">'
                  f'<div class="deck-fit"><div class="deck-scaler"><div class="slide" data-canvas-width="1920" data-canvas-height="1080" style="width:1920px;height:1080px;position:relative;overflow:clip;contain:paint;background:{bg}">'
                  f'{inner}<div class="pnum" style="position:absolute;right:110px;bottom:40px;font-family:{I};font-size:22px;color:#4f7184">#</div></div></div></div></section>')

# ── dessin d'un réseau .inp, conduites colorées / épaissies selon le diamètre optimisé ──
def inp_geom(path):
    s = open(path, encoding='utf8', errors='replace').read() + '\n['
    sec = lambda n: [l.split(';')[0].split() for l in (re.search(rf'\[{n}\](.*?)(?=\n\s*\[)', s, re.S) or [None, ''])[1].splitlines() if l.strip() and not l.strip().startswith(';')]
    xy = {r[0]: (float(r[1]), float(r[2])) for r in sec('COORDINATES') if len(r) >= 3}
    pipes = [(r[0], r[1], r[2]) for r in sec('PIPES') if len(r) >= 3]
    res = {r[0] for r in sec('RESERVOIRS')}
    return xy, pipes, res
def net_svg(path, diam, w, h, pad=40):
    xy, pipes, res = inp_geom(path)
    xs = [p[0] for p in xy.values()]; ys = [p[1] for p in xy.values()]
    k = min((w - 2 * pad) / (max(xs) - min(xs) or 1), (h - 2 * pad) / (max(ys) - min(ys) or 1))
    ox = (w - k * (max(xs) - min(xs))) / 2; oy = (h - k * (max(ys) - min(ys))) / 2
    P = lambda n: (ox + (xy[n][0] - min(xs)) * k, h - oy - (xy[n][1] - min(ys)) * k)
    ds = sorted(set(diam.values())); lo, hi = ds[0], ds[-1]
    def col(d):
        t = (d - lo) / ((hi - lo) or 1); a, b = (108, 196, 238), (236, 90, 97)
        return 'rgb(%d,%d,%d)' % tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    out = [f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" style="display:block">']
    for pid, a, b in pipes:
        if a in xy and b in xy:
            (x1, y1), (x2, y2) = P(a), P(b); d = diam.get(pid, lo)
            out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{col(d)}" stroke-width="{3 + 9 * (d - lo) / ((hi - lo) or 1):.1f}" stroke-linecap="round"/>')
    for n in xy:
        x, y = P(n)
        out.append(f'<rect x="{x - 13:.1f}" y="{y - 13:.1f}" width="26" height="26" rx="5" fill="{GOLD}"/>' if n in res else f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{INK}"/>')
    out.append('</svg>')
    legend = f'<div style="display:flex;gap:10px;align-items:center;justify-content:center;font-family:{I};font-size:18px;color:{MUTED};margin-top:8px"><span>Ø {lo}"</span><i style="display:inline-block;width:160px;height:8px;border-radius:4px;background:linear-gradient(90deg,{col(lo)},{col(hi)})"></i><span>Ø {hi}"</span><span style="margin-left:14px;color:{GOLD}">■</span><span>réservoir</span></div>'
    return ''.join(out), legend

han = json.load(open(os.path.join(BM, 'hanoi-result.json'), encoding='utf8'))
tln = json.load(open(os.path.join(BM, 'tln-result.json'), encoding='utf8'))
mod = json.load(open(os.path.join(BM, 'modena-result.json'), encoding='utf8'))
tun = json.load(open(os.path.join(K, 'cases', 'tunis-result.json'), encoding='utf8'))
big = lambda v, l, c: f'<div>{T(v, 96, 700, c, G)}{T(l, 28, 400, MUTED, I, "margin-top:6px")}</div>'

# 1 · couverture
cover_net, _ = net_svg(os.path.join(BM, 'HAN.inp'), han['diameters'], 1000, 820, 60)
slide('KizunOrca', 'Une phrase : on calcule le réseau d’eau le moins cher qui respecte vitesse et pression. Puis on lance le film.',
      f'<div style="position:absolute;right:-40px;top:130px;opacity:.6">{cover_net}</div>'
      f'<div style="position:absolute;inset:0;background:linear-gradient(90deg,{BG} 45%,rgba(7,28,41,0) 85%)"></div>'
      f'<div style="position:absolute;left:110px;top:300px;width:1050px">{kicker("Kizuna 2026 · Hackathon")}'
      + T('Kizun<span style="color:' + CYAN + '">Orca</span>', 170, 700, INK, G, 'letter-spacing:-4px')
      + T('Le réseau d’eau le moins cher qui respecte la vitesse et la pression. Calculé, pas deviné.', 46, 500, INK, I, 'margin-top:28px;line-height:1.25')
      + '</div>')

# 2 · film
if os.path.exists(VIDEO):
    v = base64.b64encode(open(VIDEO, 'rb').read()).decode()
    slide('Film', 'Film de 45 s : il se lance seul. Ne rien dire pendant le film.',
          f'<video class="intro-film" src="data:video/mp4;base64,{v}" muted playsinline preload="auto" style="width:100%;height:100%;object-fit:cover;cursor:pointer" aria-label="Film d’animation : un ingénieur face à 10 puissance 3 591 réseaux possibles"></video>', '#000')

# 3 · problème
chip = lambda t, c: f'<div style="border:2px solid {c};color:{c};border-radius:999px;padding:14px 30px;font-family:{I};font-size:34px;font-weight:600">{t}</div>'
slide('Le problème', '14 diamètres possibles par conduite, 3 133 conduites (réseau de Kairouan, données de l’équipe) : 14^3133 ≈ 10^3591 combinaisons. À 10 ms par test, 10^3581 ans. Et trois exigences qui se contredisent.',
      f'<div style="position:absolute;left:110px;top:120px;right:110px">{kicker("Le problème", CORAL)}'
      + T('10<sup style="font-size:.55em;color:' + CORAL + '">3 591</sup>', 300, 700, INK, G, 'letter-spacing:-6px')
      + T('réseaux possibles pour une ville de 3 133 conduites. Impossible à tester, même par ordinateur.', 44, 400, MUTED, I, 'margin-top:10px;max-width:1500px;line-height:1.25')
      + f'<div style="display:flex;gap:24px;margin-top:64px">{chip("Vitesse 0,3 – 1,2 m/s", CYAN)}{chip("Pression ≥ 20 m", SAGE)}{chip("Coût minimal", GOLD)}</div>'
      + T('Un tuyau plus large ralentit l’eau… et coûte plus cher. Aujourd’hui : quelques variantes, à la main.', 32, 400, INK, I, 'margin-top:34px')
      + '</div>' + source('14 diamètres commerciaux par conduite × 3 133 conduites (réseau de Kairouan, données de l’équipe) : 14^3133 = 10^3591.'))

# 4 · solution
shot = os.path.join(K, 'cases', 'shots', 'tunis-apres.jpg')
slide('La solution', 'Montrer l’écran : importer un fichier EPANET, cliquer Optimiser, la courbe du coût descend en direct, le rapport prouve que vitesse et pression sont respectées.',
      f'<div style="position:absolute;left:110px;top:130px;width:620px">{kicker("La solution")}'
      + T('Le moteur propriétaire ORCADEEP teste des milliers de réseaux et garde le meilleur.', 54, 700, INK, G, 'line-height:1.1')
      + T('Logique d’optimisation : propriété exclusive d’ORCADEEP SARL.', 24, 500, MUTED, I, 'margin-top:14px')
      + ''.join(f'<div style="display:flex;gap:22px;align-items:baseline;margin-top:38px"><span style="font-family:{G};font-size:44px;font-weight:700;color:{c}">{n}</span>{T(t, 32, 500, INK)}</div>'
                for n, t, c in [('1', 'Importer le fichier EPANET', CYAN), ('2', '⚡ Optimiser : la courbe du coût descend en direct', GOLD), ('3', 'Rapport : vitesse, pression, coût', SAGE)])
      + f'</div><img src="{jpg(shot, (50, 45, 1150, 785))}" style="position:absolute;right:110px;top:130px;width:1000px;border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,.5)" alt="Capture de KizunOrca : courbe de convergence et réseau optimisé">')

# 5 · preuve sur les réseaux de référence publiés
def proof_card(r, inp, title, sub):
    gap = r['gapPct']
    badge = 'record égalé' if abs(gap) < 0.005 else f'+{fr(gap, 1)} % du record'
    cur = r.get('currency', '$')
    unit = (lambda x: fr(x / 1e6, 3) + ' M' + cur) if r['bestKnown'] > 1e6 else (lambda x: fr(x) + ' ' + cur)
    drawing, legend = net_svg(os.path.join(BM, inp), r['diameters'], 470, 280, 20)
    return (f'<div style="flex:1;min-width:0;background:{CARD};border:1px solid rgba(255,255,255,.08);border-radius:28px;padding:26px 28px;display:flex;flex-direction:column;gap:6px">'
            + T(title, 36, 700, INK, G) + T(sub, 22, 400, MUTED)
            + f'<div style="display:flex;flex-direction:column;align-items:center;margin:10px 0">{drawing}{legend}</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:8px 26px;align-items:flex-end;margin-top:6px">'
            + f'<div>{T("Record publié", 20, 500, MUTED, I, "white-space:nowrap")}{T(unit(r["bestKnown"]), 34, 700, GOLD, G, "white-space:nowrap")}</div>'
            + f'<div>{T("KizunOrca", 20, 500, MUTED, I, "white-space:nowrap")}{T(unit(r["best"]), 34, 700, CYAN, G, "white-space:nowrap")}</div>'
            + f'<div style="background:{SAGE if abs(gap) < 1 else GOLD};color:{BG};border-radius:999px;padding:8px 16px;font-family:{I};font-weight:700;font-size:22px;white-space:nowrap">{badge}</div></div>'
            + T(f'{fr(r["secondsPerRun"], 0)} s/départ · {r["runs"]} départ(s) · P min {fr(r["pmin"], 1)} m · V max {fr(r["vmax"], 1)} m/s', 19, 400, MUTED, I, 'margin-top:10px') + '</div>')
slide('Preuve : réseaux de référence', f'Ce ne sont pas nos réseaux : ce sont les problèmes de référence mondiaux, avec leurs règles officielles (barème, pression minimale, et vitesse ≤ 2 m/s pour Modena). Modena est le réseau réel de la ville de Modène (Italie), publié par Bragalli et al. et l’Université du Kentucky : KizunOrca est à {fr(mod["gapPct"], 1)} % du meilleur résultat publié en 6 minutes, toutes contraintes respectées. Two-Loop : record égalé exactement. Hanoi : meilleur de {han["runs"]} départs à {fr(han["gapPct"], 1)} % du meilleur résultat publié (médiane {fr(han["median"] / 1e6, 3)} M$). Dire « à x % du record », jamais « optimum garanti ». Les .inp optimisés sont réexportés : vérifiables dans EPANET.',
      f'<div style="position:absolute;left:110px;top:90px;right:110px">{kicker("Preuve · réseaux publiés", SAGE)}'
      + T('Comparé aux meilleurs résultats de la recherche', 60, 700, INK, G, 'margin-bottom:30px')
      + f'<div style="display:flex;gap:26px">{proof_card(mod, "MOD.inp", "Modène, Italie", "réseau réel · 317 conduites · V ≤ 2 m/s")}{proof_card(han, "HAN.inp", "Hanoi, Vietnam", "réseau maître planifié · 34 conduites")}{proof_card(tln, "TLN.inp", "Two-Loop", "réseau d’école · 8 conduites")}</div></div>'
      + source('fichiers .inp et barèmes officiels : github.com/WaterFutures/WaterBenchmarkHub · Modène : Bragalli et al. 2008 (IBM RC24495), Univ. Kentucky uknowledge.uky.edu/wdst_international/5, record : front de Pareto Univ. Exeter · Hanoi : Fujiwara &amp; Khang 1990, Water Resources Research 26(4) · Two-Loop : Alperovits &amp; Shamir 1977, WRR 13(6) · records : Kambalame et al. 2025, World Water Policy, doi:10.1002/wwp2.12238'))

# 6 · démo en direct
b, a = tun['before'], tun['after']
slide('Démo en direct', f'Basculer sur l’application : ★ Démo complète puis ⚡ Optimiser. Réseau de démonstration : rues réelles de Tunis (OpenStreetMap), diamètres de départ surdimensionnés volontairement — ce n’est pas un réseau exploité, le dire si on le demande. Mesuré : {fr(tun["seconds"], 0)} s.',
      f'<div style="position:absolute;left:110px;top:130px;right:110px">{kicker("Démo en direct", GOLD)}'
      + T('Tunis : de 1,78 M à 313 k TND, en quelques secondes', 64, 700, INK, G)
      + f'<div style="display:flex;gap:100px;margin-top:50px">{big("−" + fr((1 - a["cost"] / b["cost"]) * 100) + " %", "coût des conduites", CYAN)}{big("0 / " + str(a["pipes"]), "conduite au-dessus de 1,2 m/s", SAGE)}{big(fr(a["pmin"], 0) + " m", "pression minimale (≥ 20 m)", GOLD)}{big(str(b["slowV"]) + " → " + str(a["slowV"]), "conduites à eau lente", CORAL)}</div>'
      + '<div style="display:flex;gap:40px;margin-top:56px">' + ''.join(f'<div style="flex:1;position:relative"><img src="{jpg(os.path.join(K, "cases", "shots", f), (50, 45, 1150, 785), 1100)}" style="width:100%;height:400px;object-fit:cover;border-radius:22px;display:block" alt="{l}"><div style="position:absolute;left:18px;top:16px;background:{BG};color:{c};border-radius:999px;padding:6px 18px;font-family:{I};font-weight:700;font-size:24px">{l}</div></div>' for f, l, c in [('tunis-avant.jpg', 'Avant · 1,78 M TND', CORAL), ('tunis-apres.jpg', 'Après · 313 k TND', SAGE)]) + '</div>'
      + '</div>' + source('réseau de démonstration posé sur les rues réelles de Tunis (© contributeurs OpenStreetMap, ODbL), altitudes Open-Meteo / Copernicus ; diamètres de départ surdimensionnés volontairement, ce n’est pas un réseau exploité.'))

# 7 · architecture
box = lambda x, y, w, h, t, s, c: (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="22" fill="rgba(255,255,255,.05)" stroke="{c}" stroke-width="3"/>'
    f'<text x="{x + w / 2}" y="{y + h / 2 - 6}" text-anchor="middle" font-family="Space Grotesk" font-size="34" font-weight="700" fill="{INK}">{t}</text>'
    f'<text x="{x + w / 2}" y="{y + h / 2 + 30}" text-anchor="middle" font-family="Inter" font-size="21" fill="{MUTED}">{s}</text>')
arr = lambda x1, y1, x2, y2: f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{CYAN}" stroke-width="4" marker-end="url(#a)"/>'
svg = (f'<svg viewBox="0 0 1700 430" width="1700" height="430"><defs><marker id="a" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{CYAN}"/></marker></defs>'
       + box(0, 140, 330, 150, 'Application', 'carte · courbe en direct', CYAN) + box(450, 140, 300, 150, 'Gateway', 'API + flux en direct', CYAN)
       + box(870, 140, 300, 150, 'File Redis', 'répartit les calculs', GOLD)
       + box(1300, 0, 400, 120, 'Optimiseur 1', 'moteur propriétaire ORCADEEP', SAGE) + box(1300, 155, 400, 120, 'Optimiseur 2', 'solveur hydraulique', SAGE) + box(1300, 310, 400, 120, 'Optimiseur N', '+1 commande = +1 machine', SAGE)
       + arr(330, 215, 446, 215) + arr(750, 215, 866, 215) + arr(1170, 200, 1296, 60) + arr(1170, 215, 1296, 215) + arr(1170, 230, 1296, 370) + '</svg>')
slide('Architecture', 'Chaque calcul part dans une file ; chaque optimiseur en prend un et publie sa courbe. Multi-départ : plusieurs graines en parallèle, on garde la meilleure (c’est ainsi qu’on approche le record sur Hanoi). Sans cluster, l’appli calcule seule. Mesuré : 2 calculs simultanés en 25 s chacun, résultat identique.',
      f'<div style="position:absolute;left:110px;top:110px;right:110px">{kicker("Architecture")}'
      + T('Des calculs en parallèle, sur un PC ou un serveur', 60, 700, INK, G, 'margin-bottom:50px') + svg
      + f'<div style="display:flex;gap:90px;margin-top:50px">{big("×N", "optimiseurs : on ajoute des machines", CYAN)}{big("25 s", "2 calculs simultanés (mesuré)", GOLD)}{big("100 %", "hors ligne possible, données chez le client", SAGE)}</div></div>')

# 8 · modèle économique
offer = lambda t, p, d, c: (f'<div style="flex:1;min-width:0;background:{CARD};border-top:6px solid {c};border-radius:24px;padding:34px">'
                            + T(t, 38, 700, INK, G) + T(p, 54, 700, c, G, 'margin:14px 0') + T(d, 26, 400, MUTED, I, 'line-height:1.35') + '</div>')
slide('Modèle économique', 'Prix proposés, à valider avec les premiers clients. Hypothèse prudente : 5 % d’économie. 5 % de 10 M TND de conduites = 500 k TND.',
      f'<div style="position:absolute;left:110px;top:110px;right:110px">{kicker("Modèle économique", GOLD)}'
      + T('Payé par ce qu’il fait économiser', 60, 700, INK, G, 'margin-bottom:46px')
      + f'<div style="display:flex;gap:30px">{offer("Étude", "3 000 TND", "un réseau optimisé + rapport, prêt pour l’appel d’offres", CYAN)}{offer("Abonnement", "1 500 TND/mois", "bureaux d’études : projets illimités", GOLD)}{offer("Licence", "sur devis", "SONEDE, régies : installé chez le client", SAGE)}</div>'
      + f'<div style="display:flex;align-items:center;gap:44px;margin-top:46px">{T("×25", 130, 700, SAGE, G)}'
      + T('Hypothèse prudente : 5 % d’économie sur 10 M TND de conduites = <b style="color:#f3f8fa">500 k TND</b>, pour moins de 20 k TND d’abonnement par an.', 34, 400, MUTED, I, 'line-height:1.35;max-width:1200px') + '</div></div>'
      + source('prix et hypothèse d’économie : propositions de l’équipe, à valider avec des clients.'))

# 9 · fin
slide('Merci', 'Conclure en 10 secondes, puis questions.',
      f'<div style="position:absolute;left:110px;top:200px;right:110px">{kicker("KizunOrca")}'
      + T('Le bon réseau, au bon prix, prouvé.', 90, 700, INK, G)
      + f'<div style="display:flex;gap:110px;margin-top:80px">{big("419 000 $", "Two-Loop : record égalé", SAGE)}{big("+" + fr(han["gapPct"], 1) + " %", "Hanoi : écart au record publié", CYAN)}{big("−82 %", "démo Tunis, vitesses respectées", GOLD)}</div>'
      + T('Merci. Des questions ?', 40, 600, CYAN, I, 'margin-top:90px')
      + T('ORCADEEP SARL · Immeuble du Lac de Constance, bloc A, 2e étage, n° 2.2, Les Berges du Lac, 1053 La Marsa, Tunis · contact@orcadeep.com · +216 53 311 748 · orcadeep.com', 24, 400, MUTED, I, 'margin-top:40px') + '</div>')

# ── annexes ──
slide('Annexes', 'Réserve : à ouvrir seulement si on nous pose la question.', f'<div style="position:absolute;left:110px;top:420px">{kicker("Annexes", MUTED)}' + T('Sources · questions · concurrence · détails', 72, 700, INK, G) + '</div>')
refs = [
    ('Fichiers .inp et barèmes', 'github.com/WaterFutures/WaterBenchmarkHub (projet Water-Futures) — téléchargés sans modification'),
    ('Hanoi', 'Fujiwara O., Khang D.B. (1990), Water Resources Research 26(4) 539-549, doi:10.1029/WR026i004p00539 ; fiche ASCE / Univ. of Kentucky : uky.edu/WDST'),
    ('Modène (Italie)', 'Réseau réel de la ville : Bragalli C. et al. (2008), IBM Research Report RC24495 ; fiche Univ. of Kentucky : uknowledge.uky.edu/wdst_international/5 ; record 2,539 M€ : front de Pareto de référence, Centre for Water Systems, Univ. of Exeter (fichier bestPF_MOD.txt)'),
    ('Two-Loop', 'Alperovits E., Shamir U. (1977), Water Resources Research 13(6) 885-900, doi:10.1029/WR013i006p00885'),
    ('Records publiés', 'Hanoi 6,081 M$ et Two-Loop 419 000 $ : Kambalame et al. (2025), World Water Policy, doi:10.1002/wwp2.12238 ; Hanoi aussi : Water 12(4) 1037 (2020), doi:10.3390/w12041037'),
    ('Revue des résultats', 'De Corte A., Sörensen K. (2013), European Journal of Operational Research 228, 1-10'),
    ('Simulateur de référence', 'EPANET (US EPA) : epa.gov/water-research/epanet — notre solveur applique la même méthode (gradient global, Todini &amp; Pilati 1988)'),
    ('Démo Tunis', 'rues © contributeurs OpenStreetMap (ODbL), altitudes Open-Meteo / Copernicus ; diamètres de départ fictifs (réseau de démonstration)'),
    ('Reproduire', 'moteur de calcul propriétaire Orcadeep · résultats : cases/benchmarks/*-result.json · réseaux optimisés : *-optimise.inp (vérifiables dans EPANET)'),
]
slide('Sources', 'Toutes les références, pour le jury.',
      f'<div style="position:absolute;left:110px;top:90px;right:110px">{kicker("Sources vérifiables", SAGE)}'
      + ''.join(f'<div style="display:flex;gap:30px;padding:16px 0;border-bottom:1px solid rgba(255,255,255,.08)"><div style="width:380px;flex:none">{T(t, 26, 700, INK, G)}</div>{T(d, 24, 400, MUTED, I, "line-height:1.35")}</div>' for t, d in refs) + '</div>')
qa = [('« Est-ce l’optimum absolu ? »', 'Personne ne peut le prouver sur 10^3591 cas. On se compare aux records publiés : égalé sur Two-Loop, ' + fr(han['gapPct'], 1) + ' % d’écart sur Hanoi.'),
      ('« Le calcul est-il juste ? »', 'Même méthode qu’EPANET. Les réseaux optimisés sont réexportés en .inp : ouvrez-les dans EPANET.'),
      ('« Vos réseaux sont-ils réels ? »', 'Modène : réseau réel d’une ville italienne, publié. Hanoi : réseau maître planifié publié (1990). Tunis : démonstration sur rues réelles, diamètres fictifs, et on le dit. Aucun distributeur tunisien ou japonais ne publie ses fichiers EPANET.'),
      ('« Nos données sortent-elles ? »', 'Non : tout tourne chez le client. Seule la phrase de l’agent IA part, et elle est facultative.')]
slide('Questions du jury', 'Réponses courtes.',
      f'<div style="position:absolute;left:110px;top:100px;right:110px">{kicker("Questions du jury")}<div style="display:grid;grid-template-columns:1fr 1fr;gap:28px">'
      + ''.join(f'<div style="background:{CARD};border-radius:24px;padding:34px">{T(q, 34, 700, INK, G)}{T(r, 27, 400, MUTED, I, "margin-top:14px;line-height:1.35")}</div>' for q, r in qa) + '</div></div>')
rows = [('', 'EPANET', 'Module commercial', 'KizunOrca'), ('Simulation hydraulique', 'Oui', 'Oui', 'Oui'), ('Optimisation coût + vitesse + pression', 'Non', 'Oui', 'Oui, en direct'),
        ('Réseau posé sur les vraies rues', 'Non', 'Non', 'Oui'), ('Conception depuis une phrase (IA)', 'Non', 'Non', 'Oui'), ('Hors ligne, données chez le client', 'Oui', 'Selon licence', 'Oui'), ('Prix', 'Gratuit', 'Licence', 'Étude / abonnement')]
slide('Concurrence', 'EPANET est gratuit mais n’optimise pas ; les modules d’optimisation commerciaux (ex. Darwin Designer de Bentley) sont sous licence.',
      f'<div style="position:absolute;left:110px;top:100px;right:110px">{kicker("Concurrence")}<div style="display:grid;grid-template-columns:2fr 1fr 1.2fr 1.2fr;font-family:{I};font-size:30px">'
      + ''.join(f'<div style="padding:20px;border-bottom:1px solid rgba(255,255,255,.1);color:{(SAGE if j == 3 and i else INK if i == 0 or j == 0 else MUTED)};font-weight:{700 if i == 0 or j == 3 else 400}">{c}</div>' for i, r in enumerate(rows) for j, c in enumerate(r)) + '</div></div>')
for k in (13, 14, 22, 23, 24):  # explications et feuille de route du modèle d'origine
    slides.append(old[k])

# numéros, libellés d'accessibilité, lecture du film
n = len(slides)
for i in range(n):
    s = re.sub(r'id="(x|\d+)"', f'id="{i + 1}"', slides[i], count=1).replace('color:#4f7184">#</div>', f'color:#4f7184">{i + 1}</div>')
    s = re.sub(r' aria-label="Slide \d+ of \d+"', '', s, count=1).replace('aria-roledescription="slide"', f'aria-roledescription="slide" aria-label="Slide {i + 1} of {n}"', 1)
    slides[i] = s
PLAYER = '''<script>(function(){var v=document.querySelector('video.intro-film');if(!v)return;var shown=false;
v.addEventListener('click',function(e){e.stopPropagation();if(v.paused)v.play();else v.pause();});
setInterval(function(){var r=v.getBoundingClientRect(),on=r.width>0&&r.left<innerWidth/2&&r.right>innerWidth/2&&r.top<innerHeight/2&&r.bottom>innerHeight/2;
if(on&&!shown){shown=true;v.currentTime=0;v.play().catch(function(){});}if(!on&&shown){shown=false;v.pause();}},200);})();</script>'''
html = head.replace('<title>Optimisation des réseaux d’eau potable</title>', '<title>KizunOrca — pitch</title>') + ''.join(slides) + tail.replace('</body>', PLAYER + '</body>')
open(OUT, 'w', encoding='utf8').write(html)
print(f'{OUT} : {n} diapositives (9 + film, {n - 10} en annexe), {len(html) / 1e6:.1f} Mo')
