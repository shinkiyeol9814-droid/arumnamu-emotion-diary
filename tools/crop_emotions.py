from PIL import Image
im = Image.open('src/img/original-chart.webp').convert('RGB')
xs = [112, 360, 615, 875, 1090, 1305]
rows = [(350,548),(612,808),(880,1055),(1130,1305),(1380,1570),(1640,1808)]
sheet = Image.new('RGB',(5*170,6*170),'white')
import os
os.makedirs('src/img/emotions',exist_ok=True)
n=0
for r,(t,b) in enumerate(rows):
  for c in range(5):
    sh = [0,0,-4,-8,-12,-14][r]
    l,rr = xs[c]+sh, xs[c+1]+sh
    box=(l+6,t+4,rr-6,b-4)
    cell=im.crop(box)
    px=cell.load()
    for yy in range(cell.size[1]):
      for xx in range(cell.size[0]):
        R,G,B=px[xx,yy]
        if min(R,G,B)>175 and max(R,G,B)-min(R,G,B)<30: px[xx,yy]=(255,255,255)
    W,H=cell.size
    def dark(p): return sum(p)<300
    for xx in list(range(0,22))+list(range(W-30,W)):
      if sum(dark(px[xx,yy]) for yy in range(H))>0.45*H:
        for d in (-2,-1,0,1,2):
          if 0<=xx+d<W:
            for yy in range(H): px[xx+d,yy]=(255,255,255)
    for yy in list(range(0,18))+list(range(H-18,H)):
      if sum(dark(px[xx,yy]) for xx in range(W))>0.45*W:
        for d in (-2,-1,0,1,2):
          if 0<=yy+d<H:
            for xx in range(W): px[xx,yy+d]=(255,255,255)
    w,h=cell.size; s=max(w,h)
    sq=Image.new('RGB',(s,s),'white'); sq.paste(cell,((s-w)//2,(s-h)//2))
    sq=sq.resize((240,240),Image.LANCZOS)
    n+=1
    sq.save(f'src/img/emotions/e{n:02d}.webp',quality=85)
    sheet.paste(sq.resize((160,160)),(c*170,r*170))
sheet.save('tools/contact-sheet.png')
# icon: crop the book inside yellow border
ic=Image.open('src/img/original-icon.webp').convert('RGB').crop((170,90,860,920))
w,h=ic.size; s=max(w,h); sq=Image.new('RGB',(s,s),(255,255,255)); sq.paste(ic,((s-w)//2,(s-h)//2))
for z in (512,192,64): sq.resize((z,z),Image.LANCZOS).save(f'src/img/icon-{z}.png')
