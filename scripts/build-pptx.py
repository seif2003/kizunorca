# Copie PowerPoint de secours du pitch : une image plein cadre par diapositive (rendue depuis KizunOrca-pitch.html),
# le film de 45 s intégré sur la diapo 2 et les notes de l'orateur.
# Usage : python -I kizunorca/scripts/build-pptx.py <dossier des captures p1.png…pN.png + poster.png>
import html, os, re, sys
from pptx import Presentation
from pptx.util import Emu

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
shots = sys.argv[1]
deck = open(os.path.join(ROOT, 'KizunOrca-pitch.html'), encoding='utf8').read()
notes = [html.unescape(m) for m in re.findall(r'<section class="deck-slide"[^>]*?data-speaker-notes="([^"]*)"', deck)]
n = deck.count('<section class="deck-slide"')
assert len(notes) == n, (len(notes), n)  # chaque diapositive porte ses notes

prs = Presentation()
prs.slide_width, prs.slide_height = Emu(12192000), Emu(6858000)  # 16:9
blank = prs.slide_layouts[6]
for i in range(1, n + 1):
    s = prs.slides.add_slide(blank)
    s.shapes.add_picture(os.path.join(shots, f'p{i}.png'), 0, 0, prs.slide_width, prs.slide_height)
    if 'intro-film' in re.split(r'(?=<section class="deck-slide")', deck)[i]:
        s.shapes.add_movie(os.path.join(ROOT, 'presentation', 'out', 'intro.mp4'), 0, 0, prs.slide_width, prs.slide_height,
                           poster_frame_image=os.path.join(shots, 'poster.png'), mime_type='video/mp4')
    s.notes_slide.notes_text_frame.text = notes[i - 1]
out = os.path.join(ROOT, os.environ.get('PPTX_OUT', 'KizunOrca-pitch.pptx'))
prs.save(out)
print(out, n, 'diapositives', round(os.path.getsize(out) / 1e6, 1), 'Mo')
