# 아바타 위치 조정용 단독 HTML 생성 (이미지 base64 내장 → 어디서든 더블클릭으로 열림)
import os, base64, json

# repo 어디서 실행하든 동작하도록 이 스크립트 위치 기준 경로 사용
HERE = os.path.dirname(os.path.abspath(__file__))
KIDS = os.path.join(HERE, "..", "chflow-app", "public", "avatars", "kids")
OUT  = os.path.join(HERE, "avatar-tuner.html")

# 현재 배포된 값 (kidAvatar.ts FACE_ADJUST 와 동일)  name:[X%, Y%, scale]
CUR = {
 "boy-1":[0,10,1.10], "boy-2":[14,6,1.10], "boy-3":[-3,0,1.10],
 "boy-4":[9,10,1.10], "boy-5":[11,9,1.10], "boy-6":[-8,-8,1.12],
 "boy-7":[-5,-6,1.10], "boy-8":[0,-8,1.10], "boy-9":[4,-5,1.10],
 "girl-1":[-6,6,1.12], "girl-2":[-4,4,1.10], "girl-3":[6,5,1.08],
 "girl-4":[-4,-3,1.10], "girl-5":[-3,8,1.10], "girl-6":[-1,4,1.08],
}
order = [f"boy-{i}" for i in range(1,10)] + [f"girl-{i}" for i in range(1,7)]

def uri(n):
    with open(os.path.join(KIDS, n+".png"),"rb") as f:
        return "data:image/png;base64,"+base64.b64encode(f.read()).decode()

imgs = {n: uri(n) for n in order}

html = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>아바타 얼굴 위치 조정기</title>
<style>
 body{margin:0;background:#f4f4f5;font:14px 'Malgun Gothic',sans-serif;color:#222;padding:18px}
 h1{font-size:18px;margin:0 0 4px}
 p.tip{color:#666;margin:0 0 16px;font-size:13px;line-height:1.6}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
 .card{background:#fff;border:1px solid #ddd;border-radius:12px;padding:12px;display:flex;flex-direction:column;align-items:center}
 .name{font-weight:700;margin-bottom:8px}
 .av{position:relative;width:140px;height:140px;border-radius:999px;overflow:hidden;border:1px solid #bbb;background:#f7f2e8}
 .av img{width:100%;height:100%;object-fit:cover;object-position:center;display:block}
 .v{position:absolute;top:0;bottom:0;left:50%;width:1px;background:rgba(255,0,0,.85)}
 .h{position:absolute;left:0;right:0;top:42%;height:1px;background:rgba(0,90,255,.85)}
 .row{display:flex;align-items:center;gap:6px;width:100%;margin-top:8px;font-size:12px}
 .row label{width:54px;color:#555}
 .row input[type=range]{flex:1}
 .row output{width:42px;text-align:right;color:#333;font-variant-numeric:tabular-nums}
 .reset{margin-top:8px;font-size:11px;background:#eee;border:1px solid #ccc;border-radius:6px;padding:4px 8px;cursor:pointer}
 .out{margin-top:22px}
 textarea{width:100%;height:380px;font:12px Consolas,monospace;border:1px solid #ccc;border-radius:8px;padding:10px;box-sizing:border-box}
 .copy{margin:8px 0;background:#3e5a4a;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer}
</style></head><body>
<h1>아바타 얼굴 위치 조정기</h1>
<p class="tip">
빨간 세로선 = 좌우 중앙 · 파란 가로선 = 눈높이(42%) 기준.<br>
<b>X</b> 슬라이더 = 좌우(왼쪽←/→오른쪽) · <b>Y</b> = 위아래(↑위/↓아래) · <b>크기</b> = 확대.<br>
코·눈이 십자선에 오도록 끌면 됩니다. 다 맞추면 아래 <b>코드 복사</b> → 채팅에 붙여넣어 주세요.
</p>
<div class="grid" id="grid"></div>
<div class="out">
 <button class="copy" onclick="copyCode()">📋 코드 복사 (kidAvatar.ts 에 붙여넣을 내용)</button>
 <textarea id="code" readonly></textarea>
</div>
<script>
const IMGS = __IMGS__;
const CUR  = __CUR__;
const ORDER= __ORDER__;
const state = JSON.parse(JSON.stringify(CUR));

function tstr(v){
  const [x,y,s]=v;
  const sc=`scale(${(+s).toFixed(2)})`;
  if(x===0&&y===0) return sc;
  if(y===0) return `translateX(${x}%) ${sc}`;
  if(x===0) return `translateY(${y}%) ${sc}`;
  return `translate(${x}%, ${y}%) ${sc}`;
}
function applyOne(n){
  document.getElementById('img-'+n).style.transform = tstr(state[n]);
  document.getElementById('xo-'+n).value = state[n][0];
  document.getElementById('yo-'+n).value = state[n][1];
  document.getElementById('so-'+n).value = (+state[n][2]).toFixed(2);
  updateCode();
}
function updateCode(){
  let lines = ORDER.map(n=>`  "${n}": "${tstr(state[n])}",`);
  document.getElementById('code').value =
    "const FACE_ADJUST: Record<string, string> = {\\n"+lines.join("\\n")+"\\n};";
}
function copyCode(){ const t=document.getElementById('code'); t.select(); document.execCommand('copy'); alert('복사됐습니다. 채팅창에 붙여넣어 주세요.'); }

const grid=document.getElementById('grid');
ORDER.forEach(n=>{
  const c=document.createElement('div'); c.className='card';
  c.innerHTML=`<div class="name">${n}</div>
   <div class="av"><img id="img-${n}" src="${IMGS[n]}"><div class="v"></div><div class="h"></div></div>
   <div class="row"><label>X 좌우</label><input type="range" min="-30" max="30" step="1" id="x-${n}"><output id="xo-${n}"></output></div>
   <div class="row"><label>Y 상하</label><input type="range" min="-30" max="30" step="1" id="y-${n}"><output id="yo-${n}"></output></div>
   <div class="row"><label>크기</label><input type="range" min="0.90" max="1.45" step="0.01" id="s-${n}"><output id="so-${n}"></output></div>
   <button class="reset" id="r-${n}">처음값으로</button>`;
  grid.appendChild(c);
});
ORDER.forEach(n=>{
  const x=document.getElementById('x-'+n), y=document.getElementById('y-'+n), s=document.getElementById('s-'+n);
  x.value=state[n][0]; y.value=state[n][1]; s.value=state[n][2];
  x.oninput=()=>{state[n][0]=+x.value; applyOne(n)};
  y.oninput=()=>{state[n][1]=+y.value; applyOne(n)};
  s.oninput=()=>{state[n][2]=+s.value; applyOne(n)};
  document.getElementById('r-'+n).onclick=()=>{state[n]=CUR[n].slice();
    x.value=state[n][0]; y.value=state[n][1]; s.value=state[n][2]; applyOne(n)};
  applyOne(n);
});
</script></body></html>"""

html = (html
        .replace("__IMGS__", json.dumps(imgs))
        .replace("__CUR__", json.dumps(CUR))
        .replace("__ORDER__", json.dumps(order)))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT,"w",encoding="utf-8") as f: f.write(html)
print("WROTE", OUT, round(os.path.getsize(OUT)/1024), "KB")
