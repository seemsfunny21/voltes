'use strict';
// Optional on-device OCR for Strava screenshots. Nothing is uploaded or auto-saved.
(function(scope){
 const CDN='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
 let loading;
 function loadEngine(){
  if(scope.Tesseract?.recognize)return Promise.resolve(scope.Tesseract);
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src=CDN;script.async=true;script.crossOrigin='anonymous';
   script.onload=()=>scope.Tesseract?.recognize?resolve(scope.Tesseract):reject(Error('Το εργαλείο αναγνώρισης δεν φορτώθηκε.'));
   script.onerror=()=>reject(Error('Δεν ήταν δυνατή η φόρτωση OCR. Συμπλήρωσε τα στοιχεία χειροκίνητα.'));
   document.head.appendChild(script);
  }).catch(err=>{loading=null;throw err});
  return loading;
 }
 function parse(text){
  const lines=String(text||'').replace(/\u00a0/g,' ').split(/\n/).map(x=>x.trim()).filter(Boolean);
  const joined=lines.join(' | ');
  const decimal=s=>Number(String(s).replace(/\s/g,'').replace(',','.'));
  let speed=null,km=null,elevationGain=null,movingTime=null,date=null;
  // Accept commas and periods; distinguish km from km/h.
  const speeds=[...joined.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s*k\s*m\s*[\/]\s*h\b/gi)];
  if(speeds.length)speed=decimal(speeds[speeds.length-1][1]);
  const distances=[...joined.matchAll(/(\d{1,4}(?:[.,]\d{1,2})?)\s*k\s*m(?!\s*[\/]\s*h)\b/gi)];
  if(distances.length)km=decimal(distances[distances.length-1][1]);
  const times=[...joined.matchAll(/\b(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\b/g)];
  if(times.length){const m=times[0];let minutes=Number(m[1])*60+Number(m[2])+Math.round(Number(m[3]||0)/60);movingTime=Math.floor(minutes/60)+':'+String(minutes%60).padStart(2,'0')}
  const elevations=[...joined.matchAll(/\b(\d{1,5}(?:[.,]\d{1,2})?)\s*m\b(?!\s*[\/]\s*s)/gi)];
  if(elevations.length)elevationGain=Math.round(decimal(elevations[elevations.length-1][1]));
  // Date can be shown as 07/10/2026, 7 Οκτωβρίου 2026, or Oct 7, 2026.
  const dateCheck=(y,m,d)=>{const dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d&&y>=2000&&dt.getTime()<=Date.now()+86400000?y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'):null};
  const numeric=joined.match(/\b([0-3]?\d)[/.-]([01]?\d)[/.-](20\d{2})\b/);
  if(numeric)date=dateCheck(Number(numeric[3]),Number(numeric[2]),Number(numeric[1]));
  const months={'ιαν':1,'φεβ':2,'μαρ':3,'απρ':4,'μαϊ':5,'μαι':5,'ιουν':6,'ιουλ':7,'αυγ':8,'σεπ':9,'οκτ':10,'νοε':11,'δεκ':12,'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12};
  if(!date){const words=joined.toLocaleLowerCase('el').normalize('NFD').replace(/[\u0300-\u036f]/g,'');const pattern=/(\d{1,2})\s+([a-zα-ω]{3,20})\s*,?\s*(20\d{2})/g;for(const match of words.matchAll(pattern)){let token=match[2].slice(0,3);const month=months[token]||months[match[2].slice(0,3).replace('ϊ','ι')];if(month){date=dateCheck(Number(match[3]),month,Number(match[1]));if(date)break}}}
  // Strava mobile commonly displays: "October 12, 2025 at 1:17 PM".
  // Match the month-first date independently from a status-bar clock.
  if(!date){
   const words=joined.toLocaleLowerCase('en').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
   const monthFirst=/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})\s*,?\s*(20\d{2})\b/g;
   for(const match of words.matchAll(monthFirst)){
    const month=months[match[1].slice(0,3)],candidate=dateCheck(Number(match[3]),month,Number(match[2]));
    if(candidate){date=candidate;break}
   }
  }
  // Accept only values in the same ranges as the manual form.
  const valid=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max?n:null;
  return {km:valid(km,.1,1000),speed:valid(speed,1,100),elevationGain:valid(elevationGain,0,50000),movingTime,date,rawText:lines.join('\n')};
 }
 async function read(file,onProgress=()=>{}){
  if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>10*1024*1024)throw Error('Επίλεξε εικόνα JPG, PNG ή WebP έως 10 MB.');
  const engine=await loadEngine();
  const result=await engine.recognize(file,'eng+ell',{logger:m=>{if(m.status==='recognizing text')onProgress(Math.round((m.progress||0)*100))}});
  return parse(result.data?.text);
 }
 scope.VoltesStravaOCR={read,parse};
})(globalThis);
