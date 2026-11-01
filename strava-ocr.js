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
  let speed=null,km=null,elevationGain=null,movingTime=null,date=null,startTime=null;
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
  const months={'ιαν':1,'φεβ':2,'μαρ':3,'απρ':4,'μαι':5,'ιουν':6,'ιουλ':7,'αυγ':8,'σεπ':9,'οκτ':10,'νοε':11,'δεκ':12,'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12};
  const normalized=lines.join(' ').toLocaleLowerCase('en').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  // Prefer explicitly named months over ambiguous numeric patterns.
  const monthFirst=/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})\s*,?\s*(20\d{2})\b/g;
  for(const m of normalized.matchAll(monthFirst)){
   const candidate=dateCheck(Number(m[3]),months[m[1].slice(0,3)],Number(m[2]));
   if(candidate){date=candidate;break}
  }
  if(!date){
   const dayFirst=/(\d{1,2})\s+([a-zα-ω]{3,20})\s*,?\s*(20\d{2})/g;
   for(const m of normalized.matchAll(dayFirst)){
    const month=months[m[2].slice(0,3)];
    if(month){const candidate=dateCheck(Number(m[3]),month,Number(m[1]));if(candidate){date=candidate;break}}
   }
  }
  // Do not infer ambiguous numeric OCR dates like "10 3 2026".
  // Prefer a visible, written month from the activity header.
  if(date){
   const start=normalized.match(/\b20\d{2}\s+(?:at|στις)\s+(\d{1,2}):([0-5]\d)\s*([ap])\.?\s*m\.?\b/i);
   if(start){
    const hour=Number(start[1]);
    if(hour>=1&&hour<=12){
     const h=hour%12+(start[3].toLowerCase()==='p'?12:0);
     startTime=String(h).padStart(2,'0')+':'+start[2];
    }
   }
  }
  // Accept only values in the same ranges as the manual form.
  const valid=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max?n:null;
  return {km:valid(km,.1,1000),speed:valid(speed,1,100),elevationGain:valid(elevationGain,0,50000),movingTime,date,startTime,rawText:lines.join('\n')};
 }
 async function read(file,onProgress=()=>{},options={}){
  if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>10*1024*1024)throw Error('Επίλεξε εικόνα JPG, PNG ή WebP έως 10 MB.');
  const engine=await loadEngine();
  const result=await engine.recognize(file,'eng+ell',{logger:m=>{if(m.status==='recognizing text')onProgress(Math.round((m.progress||0)*100))}});
  const parsed=parse(result.data?.text);
  if(options.activityDate){
   // The activity header is immediately below the map on Strava screenshots.
   // Focused English OCR avoids confusing it with status-bar/map text.
   try{
    const bitmap=await createImageBitmap(file);
    try{
     const sx=Math.round(bitmap.width*.04),sy=Math.round(bitmap.height*.49);
     const width=Math.round(bitmap.width*.92),height=Math.round(bitmap.height*.17);
     const canvas=document.createElement('canvas');
     canvas.width=width*2;canvas.height=height*2;
     const ctx=canvas.getContext('2d');
     if(ctx){
      ctx.drawImage(bitmap,sx,sy,width,height,0,0,canvas.width,canvas.height);
      const focus=await engine.recognize(canvas,'eng');
      const header=parse(focus.data?.text);
      if(header.date){parsed.date=header.date;parsed.startTime=header.startTime}
     }
    }finally{bitmap.close()}
   }catch{/* Keep unambiguous date/time read from the full screenshot. */}
  }
  return parsed;
 }
 scope.VoltesStravaOCR={read,parse};
})(globalThis);
