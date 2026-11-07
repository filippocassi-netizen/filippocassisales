"""
Controllo dei materiali del ritratto interattivo.

    python scripts/verifica-ritratto.py

1. Verifica che tutte le facce in public/img/face/*.webp abbiano la stessa
   dimensione e lo stesso riquadro di sagoma (allineamento).
2. Misura quanto ogni faccia differisce dalla base fuori dal volto: il corpo
   deve restare identico, altrimenti passando da una faccia all'altra si vede
   un salto.
3. Disegna le regioni di src/data/ritratto.json (occhi, palpebre,
   sopracciglia, bocca, ovale del viso) sopra ogni faccia e salva le immagini
   in scripts/_controllo/ per il controllo a vista.

Le maschere non sono file: sono ellissi risolte nello shader da ritratto.json,
cosi' restano allineate per costruzione a qualunque faccia.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

RADICE = Path(__file__).resolve().parent.parent
FACCE = sorted((RADICE / "public/img/face").glob("*.webp"))
CFG = json.loads((RADICE / "src/data/ritratto.json").read_text(encoding="utf-8"))
USCITA = RADICE / "scripts/_controllo"
USCITA.mkdir(exist_ok=True)

errori = []
base = Image.open(RADICE / "public/img/face/smile.webp").convert("RGBA")
W, H = base.size
if (W, H) != (CFG["immagine"]["w"], CFG["immagine"]["h"]):
    errori.append(f"smile.webp e' {W}x{H}, ritratto.json dice {CFG['immagine']}")

bbox_base = base.getchannel("A").getbbox()
# fuori dal volto: tutto sotto il mento
corpo = (0, int(H * 0.5), W, H)

print(f"{'faccia':<18}{'dim':<12}{'bbox sagoma':<26}{'diff corpo'}")
for f in FACCE:
    im = Image.open(f).convert("RGBA")
    bb = im.getchannel("A").getbbox()
    d = ImageChops.difference(base.crop(corpo).convert("RGB"), im.crop(corpo).convert("RGB"))
    px = list(d.convert("L").getdata())
    media = sum(px) / len(px)
    print(f"{f.name:<18}{str(im.size):<12}{str(bb):<26}{media:.2f}")
    if im.size != (W, H):
        errori.append(f"{f.name}: dimensione {im.size} diversa da {(W, H)}")
    if bb and bbox_base and max(abs(a - b) for a, b in zip(bb, bbox_base)) > 6:
        errori.append(f"{f.name}: sagoma {bb} spostata rispetto alla base {bbox_base}")

    # regioni sopra la faccia
    ov = im.copy()
    d = ImageDraw.Draw(ov, "RGBA")

    def ell(cx, cy, rx, ry, col):
        d.ellipse([(cx - rx) * W, (cy - ry) * H, (cx + rx) * W, (cy + ry) * H], outline=col, width=2)

    o = CFG["occhi"]
    for k in ("sx", "dx"):
        ell(o[k]["x"], o[k]["y"], o["semiassi"]["rx"], o["semiassi"]["ry"], (0, 255, 255, 255))
        ell(o[k]["x"], o[k]["y"], o["semiassi"]["rx"] * 1.12, o["semiassi"]["ry"] * 1.3, (255, 255, 0, 255))
    s = CFG["sopracciglia"]
    for k in ("sx", "dx"):
        ell(s[k]["x"], s[k]["y"], s["semiassi"]["rx"], s["semiassi"]["ry"], (255, 80, 80, 255))
    b = CFG["bocca"]
    ell(b["x"], b["y"], b["rx"], b["ry"], (120, 255, 120, 255))
    v = CFG["viso"]
    ell(v["x"], v["y"], v["rx"], v["ry"], (255, 255, 255, 120))
    ov.crop((300, 40, 700, 440)).resize((800, 800)).save(USCITA / f"{f.stem}_regioni.png")

if errori:
    print("\nPROBLEMI:")
    for e in errori:
        print(" -", e)
    sys.exit(1)
print(f"\nOK: {len(FACCE)} facce allineate. Immagini di controllo in {USCITA}")
