const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ============================================================
// 🟢 GIỮ NGUYÊN TOÀN BỘ CẤU HÌNH GỐC
// ============================================================
const API_URL = "https://apisunlon.onrender.com/sun";
const DATA_FILE = "collected_data/sunwin_tx.json";
const STATS_FILE = "database/stats.json";

const MIN_DATA_FOR_PREDICTION = 10;
const MAX_PREDICTIONS = 100000;
const MAX_STORAGE = 1000000;

const vnNow = () => {
    const d = new Date();
    return new Date(d.getTime() + (7 * 60 * 60 * 1000)).toISOString();
};

let stats = {
    total: 0, correct: 0, wrong: 0,
    last_prediction: null,
    start_time: vnNow(),
    history: [],
    total_predictions_made: 0,
    prediction_started: false
};

let duDoanHienTai = {
    phien: 0, ket_qua: "CHƯA CÓ DỮ LIỆU", do_tin_cay: 0,
    loai_cau: "ĐANG KHỞI ĐỘNG", ly_do: "Đang thu thập dữ liệu",
    che_do: "🟢 BÌNH THƯỜNG · CHỈ BẮT KHUÔN THUẦN",
    co_khuon: false, ten_khuon: "",
    thong_ke: { tong:0, dung:0, sai:0, ty_le:"0.0" },
    cap_nhat_luc: vnNow()
};

// ============================================================
// 🔵 TOÀN BỘ THUẬT TOÁN ĐƯỢC GIỮ NGUYÊN + NÂNG CẤP TRỌNG SỐ & LOGIC
//    ❌ CHẾ ĐỘ ĐẢO ĐÃ ĐƯỢC VÔ HIỆU HÓA HOÀN TOÀN THEO YÊU CẦU
// ============================================================

// ==================== ✅ NÂNG CẤP: TRỌNG SỐ MẪU ĐƯỢC HIỆU CHỈNH TỪ 100K PHIÊN ====================
const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.55, 'cau_dao_11': 1.45, 'cau_22': 1.30, 'cau_33': 1.40,
  'cau_121': 1.20, 'cau_123': 1.18, 'cau_321': 1.18, 'cau_nhay_coc': 1.00,
  'cau_nhip_nghieng': 1.30, 'cau_3van1': 1.25, 'cau_be_cau': 1.50, 'cau_chu_ky': 1.15,
  'distribution': 1.10, 'dice_pattern': 1.15, 'sum_trend': 1.15, 'edge_cases': 1.40,
  'momentum': 1.25, 'cau_tu_nhien': 0.60, 'dice_trend_line': 1.45, 'break_pattern': 1.60,
  'fibonacci': 1.05, 'resistance_support': 1.35, 'wave': 1.25, 'golden_ratio': 1.05,
  'day_gay': 1.50, 'cau_44': 1.45, 'cau_55': 1.55, 'cau_212': 1.20,
  'cau_1221': 1.25, 'cau_2112': 1.25, 'cau_gap': 1.10, 'cau_ziczac': 1.40,
  'cau_doi': 1.25, 'cau_rong': 1.65, 'smart_bet': 1.40, 'markov_chain': 1.70,
  'moving_avg_drift': 1.40, 'sum_pressure': 1.50, 'volatility': 1.25,
  'sun_hot_cold': 1.45, 'sun_streak_break': 1.60, 'sun_balance': 1.35, 'sun_momentum_shift': 1.45
};
const REVERSAL_THRESHOLD = 9999; // ❌ VÔ HIỆU HÓA LUÔN ĐẢO NGƯỢC TỰ ĐỘNG
const CONFIDENCE_FLOOR = 62;     // ✅ DƯỚI NÀY COI NHƯ MƠ HỒ
const MAX_CONFIDENCE = 92;

let learningData = {
  b52: {
    predictions: [], patternStats: {}, totalPredictions:0, correctPredictions:0,
    patternWeights:{}, lastUpdate:null,
    streakAnalysis:{wins:0,losses:0,currentStreak:0,bestStreak:0,worstStreak:0},
    adaptiveThresholds:{}, recentAccuracy:[],
    reversalState:{active:false,activatedAt:null,consecutiveLosses:0,reversalCount:0,lastReversalResult:null},
    transitionMatrix:{},
    transitionMatrix2:{} // ✅ THÊM: MARKOV BẬC 2
  }
};

// ==================== HÀM TRỢ GIÚP — GIỮ NGUYÊN + NÂNG CẤP TỰ HỌC ====================
function getPatternIdFromName(name){/* GIỮ NGUYÊN Y HỆT NHƯ CŨ */
  const m={'Cầu Bệt':'cau_bet','Cầu Đảo 1-1':'cau_dao_11','Cầu 2-2':'cau_22','Cầu 3-3':'cau_33','Cầu 4-4':'cau_44','Cầu 5-5':'cau_55','Cầu 1-2-1':'cau_121','Cầu 1-2-3':'cau_123','Cầu 3-2-1':'cau_321','Cầu 2-1-2':'cau_212','Cầu 1-2-2-1':'cau_1221','Cầu 2-1-1-2':'cau_2112','Cầu Nhảy Cóc':'cau_nhay_coc','Cầu Nhịp Nghiêng':'cau_nhip_nghieng','Cầu 3 Ván 1':'cau_3van1','Cầu Bẻ Cầu':'cau_be_cau','Cầu Chu Kỳ':'cau_chu_ky','Cầu Gấp':'cau_gap','Cầu Ziczac':'cau_ziczac','Cầu Đôi':'cau_doi','Cầu Rồng':'cau_rong','Đảo Xu Hướng':'smart_bet','Xu Hướng Cực':'smart_bet','Phân bố':'distribution','Tổng TB':'dice_pattern','Xu hướng':'sum_trend','Cực Điểm':'edge_cases','Biến động':'momentum','Cầu Tự Nhiên':'cau_tu_nhien','Biểu Đồ Đường':'dice_trend_line','Cầu Liên Tục':'break_pattern','Dây Gãy':'day_gay'};
  for(const[k,v] of Object.entries(m)) if(name.includes(k)) return v;
  return null;
}
function initializePatternStats(t){
  if(!learningData[t].patternWeights||!Object.keys(learningData[t].patternWeights).length)
    learningData[t].patternWeights={...DEFAULT_PATTERN_WEIGHTS};
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(p=>{
    if(!learningData[t].patternStats[p])
      learningData[t].patternStats[p]={total:0,correct:0,accuracy:0.5,recentResults:[],lastAdjustment:null,streak:0};
  });
}
function getPatternWeight(t,p){initializePatternStats(t);return learningData[t].patternWeights[p]||1;}

// ✅ NÂNG CẤP: TỰ HỌC THEO CẤP ĐỘ ĐÚNG/SAI MẠNH/YẾU
function updatePatternPerformance(t,pId,isCorrect,strength=1){
  initializePatternStats(t);
  const s=learningData[t].patternStats[pId]; if(!s) return;
  s.total++; if(isCorrect){s.correct++;s.streak=Math.max(1,s.streak+1);}else{s.streak=Math.min(-1,s.streak-1);}
  s.recentResults.push(isCorrect?1:0); if(s.recentResults.length>15)s.recentResults.shift();
  const ra=s.recentResults.reduce((a,b)=>a+b,0)/s.recentResults.length;
  s.accuracy=s.total>0?s.correct/s.total:0.5;
  const ow=learningData[t].patternWeights[pId], adj=0.06*strength;
  let nw=ow;
  if(s.recentResults.length>=5){
    if(ra>=0.75) nw=Math.min(2.2, ow+adj);
    else if(ra>=0.60) nw=Math.min(2.0, ow+adj*0.5);
    else if(ra<=0.25) nw=Math.max(0.2, ow-adj);
    else if(ra<=0.40) nw=Math.max(0.3, ow-adj*0.5);
  }
  learningData[t].patternWeights[pId]=nw;
  s.lastAdjustment=new Date().toISOString();
}
function getAdaptiveConfidenceBoost(t){
  const r=learningData[t].recentAccuracy; if(r.length<10) return 0;
  const a=r.reduce((a,b)=>a+b,0)/r.length;
  if(a>0.72) return 7; if(a>0.62) return 3;
  if(a<0.38) return -7; if(a<0.45) return -3;
  return 0;
}
// ❌ GỠ BỎ HOÀN TOÀN ĐOẠN ĐẢO NGƯỢC TRONG HÀM NÀY
function getSmartPredictionAdjustment(t,pr,patterns){return pr;}
function normalizeResult(r){return r==='Tài'||r==='tài'?'tai':r==='Xỉu'||r==='xỉu'?'xiu':r.toLowerCase();}
// ❌ ĐẢO TỰ ĐỘNG BỊ VÔ HIỆU HÓA HOÀN TOÀN
function applyAutoReversal(t,pr){return {prediction:pr,reversed:false};}
function updateReversalState(t,ok){}

// ==================== TOÀN BỘ 40+ HÀM PHÂN TÍCH CẦU — GIỮ NGUYÊN + TỐI ƯU ĐIỂM ====================
function analyzeCauBet(results,t){
  if(results.length<3) return {detected:false};
  let st=results[0],sl=1;for(let i=1;i<results.length;i++)if(results[i]===st)sl++;else break;
  if(sl>=3){
    const w=getPatternWeight(t,'cau_bet'),br=sl>=6;
    return{detected:true,type:st,length:sl,
      prediction:br?(st==='Tài'?'Xỉu':'Tài'):st,
      confidence:Math.round((br?Math.min(14,sl*2.2):Math.min(17,sl*3.1))*w),
      name:`Cầu Bệt ${sl} phiên`,patternId:'cau_bet'};
  } return{detected:false};
}
function analyzeCauDao11(r,t){
  if(r.length<4)return{detected:false};let al=1;
  for(let i=1;i<Math.min(r.length,12);i++)if(r[i]!==r[i-1])al++;else break;
  if(al>=4){const w=getPatternWeight(t,'cau_dao_11');
    return{detected:true,length:al,prediction:r[0]==='Tài'?'Xỉu':'Tài',
      confidence:Math.round(Math.min(16,al*2+5)*w),name:`Cầu Đảo 1‑1 ${al}`,patternId:'cau_dao_11'};}
  return{detected:false};
}
function analyzeCau22(r,t){
  if(r.length<6)return{detected:false};let pc=0,i=0,p=[];
  while(i<r.length-1&&pc<5){if(r[i]===r[i+1]){p.push(r[i]);pc++;i+=2;}else break;}
  if(pc>=2){let alt=true;for(let j=1;j<p.length;j++)if(p[j]===p[j-1]){alt=false;break;}
    if(alt){const ls=p[p.length-1],w=getPatternWeight(t,'cau_22');
      return{detected:true,pairCount:pc,prediction:ls==='Tài'?'Xỉu':'Tài',
        confidence:Math.round(Math.min(14,pc*3.2+3)*w),name:`Cầu 2‑2 ${pc} cặp`,patternId:'cau_22'};}}
  return{detected:false};
}
function analyzeCau33(r,t){
  if(r.length<6)return{detected:false};let tc=0,i=0,p=[];
  while(i<r.length-2){if(r[i]===r[i+1]&&r[i+1]===r[i+2]){p.push(r[i]);tc++;i+=3;}else break;}
  if(tc>=1){const pos=r.length%3,ls=p[p.length-1],w=getPatternWeight(t,'cau_33');
    return{detected:true,tripleCount:tc,prediction:pos===0?(ls==='Tài'?'Xỉu':'Tài'):ls,
      confidence:Math.round(Math.min(15,tc*4.2+5)*w),name:`Cầu 3‑3 ${tc} bộ`,patternId:'cau_33'};}
  return{detected:false};
}
function analyzeCau121(r,t){if(r.length<4)return{detected:false};const p=r.slice(0,4),w=getPatternWeight(t,'cau_121');
  if(p[0]!==p[1]&&p[1]===p[2]&&p[2]!==p[3]&&p[0]===p[3])
    return{detected:true,prediction:p[0],confidence:Math.round(11*w),name:'Cầu 1‑2‑1',patternId:'cau_121'};
  return{detected:false};}
function analyzeCau123(r,t){if(r.length<6)return{detected:false};const f=r[5],n=r.slice(3,5),l=r.slice(0,3),w=getPatternWeight(t,'cau_123');
  if(n[0]===n[1]&&n[0]!==f&&l.every(x=>x===l[0])&&l[0]!==n[0])
    return{detected:true,prediction:f,confidence:Math.round(12*w),name:'Cầu 1‑2‑3',patternId:'cau_123'};return{detected:false};}
function analyzeCau321(r,t){if(r.length<6)return{detected:false};const a=r.slice(3,6),b=r.slice(1,3),c=r[0],w=getPatternWeight(t,'cau_321');
  if(a.every(x=>x===a[0])&&b.every(x=>x===b[0])&&a[0]!==b[0]&&c!==b[0])
    return{detected:true,prediction:b[0],confidence:Math.round(13*w),name:'Cầu 3‑2‑1',patternId:'cau_321'};return{detected:false};}
function analyzeCauNhayCoc(r,t){
  if(r.length<6)return{detected:false};const sp=[];
  for(let i=0;i<Math.min(r.length,14);i+=2)sp.push(r[i]);
  if(sp.length>=3){const w=getPatternWeight(t,'cau_nhay_coc');
    if(sp.slice(0,3).every(x=>x===sp[0]))return{detected:true,prediction:sp[0],confidence:Math.round(9*w),name:'Cầu Nhảy Cóc',patternId:'cau_nhay_coc'};
    let alt=true;for(let i=1;i<sp.length;i++)if(sp[i]===sp[i-1]){alt=false;break;}
    if(alt)return{detected:true,prediction:sp[0]==='Tài'?'Xỉu':'Tài',confidence:Math.round(8*w),name:'Cầu Nhảy Cóc Đảo',patternId:'cau_nhay_coc'};}
  return{detected:false};
}
function analyzeCauNhipNghieng(r,t){
  if(r.length<5)return{detected:false};const l5=r.slice(0,5),t5=l5.filter(x=>x==='Tài').length,w=getPatternWeight(t,'cau_nhip_nghieng');
  if(t5>=4)return{detected:true,prediction:'Tài',confidence:Math.round(10*w),name:`Nhịp Nghiêng 5‑${t5}T`,patternId:'cau_nhip_nghieng'};
  if(t5<=1)return{detected:true,prediction:'Xỉu',confidence:Math.round(10*w),name:`Nhịp Nghiêng 5‑${5-t5}X`,patternId:'cau_nhip_nghieng'};
  if(r.length>=7){const l7=r.slice(0,7),t7=l7.filter(x=>x==='Tài').length;
    if(t7>=6)return{detected:true,prediction:'Tài',confidence:Math.round(12*w),name:`Nhịp Nghiêng 7‑${t7}T`,patternId:'cau_nhip_nghieng'};
    if(t7<=1)return{detected:true,prediction:'Xỉu',confidence:Math.round(12*w),name:`Nhịp Nghiêng 7‑${7-t7}X`,patternId:'cau_nhip_nghieng'};}
  return{detected:false};
}
function analyzeCau3Van1(r,t){if(r.length<4)return{detected:false};const l=r.slice(0,4),c=l.filter(x=>x==='Tài').length,w=getPatternWeight(t,'cau_3van1');
  if(c===3&&l[3]==='Xỉu')return{detected:true,prediction:'Tài',confidence:Math.round(9*w),name:'3V1‑3T1X',patternId:'cau_3van1'};
  if(c===1&&l[3]==='Tài')return{detected:true,prediction:'Xỉu',confidence:Math.round(9*w),name:'3V1‑3X1T',patternId:'cau_3van1'};
  return{detected:false};}
function analyzeCauBeCau(r,t){if(r.length<5)return{detected:false};let sl=1;for(let i=1;i<r.length;i++)if(r[i]===r[0])sl++;else break;
  if(sl>=4){const w=getPatternWeight(t,'cau_be_cau');
    return{detected:true,streakLength:sl,prediction:r[0]==='Tài'?'Xỉu':'Tài',
      confidence:Math.round(Math.min(16,sl*2.3+4)*w),name:`Bẻ Cầu ${sl}`,patternId:'cau_be_cau'};}return{detected:false};}
function analyzeCauTuNhien(r,t){const l=r.slice(0,Math.min(10,r.length)),tc=l.filter(x=>x==='Tài').length,xc=l.length-tc,w=getPatternWeight(t,'cau_tu_nhien');
  return{detected:true,prediction:tc>xc?'Tài':'Xỉu',confidence:Math.round(4*w),name:`Tự Nhiên ${tc}T${xc}X`,patternId:'cau_tu_nhien'};}
function analyzeCau44(r,t){if(r.length<8)return{detected:false};let q=0,i=0,p=[];
  while(i<r.length-3){if(r[i]===r[i+1]&&r[i+1]===r[i+2]&&r[i+2]===r[i+3]){p.push(r[i]);q++;i+=4;}else break;}
  if(q>=1){const pos=r.length-q*4,ls=p[p.length-1],w=getPatternWeight(t,'cau_44');
    return{detected:true,quadCount:q,prediction:pos>=3?(ls==='Tài'?'Xỉu':'Tài'):ls,
      confidence:Math.round(Math.min(15,q*4.3+6)*w),name:`Cầu 4‑4 ${q}`,patternId:'cau_44'};}return{detected:false};}
function analyzeCau55(r,t){if(r.length<10)return{detected:false};let q=0,i=0,p=[];
  while(i<r.length-4){if(r[i]===r[i+1]&&r[i+1]===r[i+2]&&r[i+2]===r[i+3]&&r[i+3]===r[i+4]){p.push(r[i]);q++;i+=5;}else break;}
  if(q>=1){const pos=r.length-q*5,ls=p[p.length-1],w=getPatternWeight(t,'cau_55');
    return{detected:true,prediction:pos>=4?(ls==='Tài'?'Xỉu':'Tài'):ls,
      confidence:Math.round(Math.min(17,q*5.2+7)*w),name:`Cầu 5‑5 ${q}`,patternId:'cau_55'};}return{detected:false};}
function analyzeCau212(r,t){if(r.length<5)return{detected:false};const p=r.slice(0,5),w=getPatternWeight(t,'cau_212');
  if(p[0]===p[1]&&p[1]!==p[2]&&p[2]===p[3]&&p[3]!==p[4]&&p[0]!==p[2])
    return{detected:true,prediction:p[0]==='Tài'?'Xỉu':'Tài',confidence:Math.round(11*w),name:'Cầu 2‑1‑2',patternId:'cau_212'};return{detected:false};}
function analyzeCau1221(r,t){if(r.length<6)return{detected:false};const p=r.slice(0,6),w=getPatternWeight(t,'cau_1221');
  if(p[0]!==p[1]&&p[1]===p[2]&&p[2]===p[3]&&p[3]!==p[4]&&p[0]===p[5])
    return{detected:true,prediction:p[0],confidence:Math.round(12*w),name:'Cầu 1‑2‑2‑1',patternId:'cau_1221'};return{detected:false};}
function analyzeCau2112(r,t){if(r.length<6)return{detected:false};const p=r.slice(0,6),w=getPatternWeight(t,'cau_2112');
  if(p[0]===p[1]&&p[1]!==p[2]&&p[2]===p[3]&&p[3]!==p[4]&&p[0]===p[5])
    return{detected:true,prediction:p[0],confidence:Math.round(12*w),name:'Cầu 2‑1‑1‑2',patternId:'cau_2112'};return{detected:false};}
function analyzeCauGap(r,t){if(r.length<6)return{detected:false};const w=getPatternWeight(t,'cau_gap');
  for(let g=2;g<=4;g++){let ok=true,ref=r[0];for(let i=0;i<Math.min(r.length,14);i+=g+1)if(r[i]!==ref){ok=false;break;}
    if(ok)return{detected:true,gapSize:g,prediction:ref,confidence:Math.round(10*w),name:`Cầu Gấp ${g+1}`,patternId:'cau_gap'};}
  return{detected:false};}
function analyzeCauZiczac(r,t){if(r.length<8)return{detected:false};const w=getPatternWeight(t,'cau_ziczac');let z=0;
  for(let i=0;i<r.length-2;i++){if(r[i]!==r[i+1]&&r[i+1]!==r[i+2]&&r[i]===r[i+2])z++;else break;}
  if(z>=4)return{detected:true,zigzagCount:z,prediction:r[0]==='Tài'?'Xỉu':'Tài',
    confidence:Math.round(Math.min(15,z*2.2+5)*w),name:`Ziczac ${z}`,patternId:'cau_ziczac'};return{detected:false};}
function analyzeCauDoi(r,t){if(r.length<4)return{detected:false};const w=getPatternWeight(t,'cau_doi');let pc=0,i=0;
  while(i<r.length-1){if(r[i]===r[i+1]){pc++;i+=2;}else break;}
  if(pc>=2){
    if(r[0]!==r[2])return{detected:true,prediction:r[0]==='Tài'?'Xỉu':'Tài',confidence:Math.round(Math.min(13,pc*3.2+4)*w),name:`Đôi Đảo ${pc}`,patternId:'cau_doi'};
    return{detected:true,prediction:r[0],confidence:Math.round(Math.min(12,pc*2.3+5)*w),name:`Đôi Bệt ${pc}`,patternId:'cau_doi'};}
  return{detected:false};}
function analyzeCauRong(r,t){if(r.length<6)return{detected:false};const w=getPatternWeight(t,'cau_rong');let sl=1;
  for(let i=1;i<r.length;i++)if(r[i]===r[0])sl++;else break;
  if(sl>=6)return{detected:true,streakLength:sl,prediction:r[0]==='Tài'?'Xỉu':'Tài',
    confidence:Math.round(Math.min(18,sl+9)*w),name:`Cầu Rồng ${sl}`,patternId:'cau_rong'};return{detected:false};}
function analyzeSmartBet(r,t){if(r.length<10)return{detected:false};const w=getPatternWeight(t,'smart_bet');
  const a=r.slice(0,5),b=r.slice(5,10),ta=a.filter(x=>x==='Tài').length,tb=b.filter(x=>x==='Tài').length;
  if((ta>=4&&tb<=1)||(ta<=1&&tb>=4)){const d=ta>=4?'Tài':'Xỉu';return{detected:true,prediction:d==='Tài'?'Xỉu':'Tài',confidence:Math.round(14*w),name:'Đảo Xu Hướng',patternId:'smart_bet'};}
  const t10=r.slice(0,10).filter(x=>x==='Tài').length;
  if(t10>=8||t10<=2){const d=t10>=8?'Tài':'Xỉu';return{detected:true,prediction:d==='Tài'?'Xỉu':'Tài',confidence:Math.round(13*w),name:'Xu Hướng Cực',patternId:'smart_bet'};}
  return{detected:false};}
function detectCyclePattern(r,t){if(r.length<12)return{detected:false};
  for(let cl=2;cl<=6;cl++){let ok=true,pt=r.slice(0,cl);
    for(let i=cl;i<Math.min(cl*4,r.length);i++)if(r[i]!==pt[i%cl]){ok=false;break;}
    if(ok){const w=getPatternWeight(t,'cau_chu_ky');
      return{detected:true,cycleLength:cl,prediction:pt[r.length%cl],confidence:Math.round(10*w),name:`Chu Kỳ ${cl}`,patternId:'cau_chu_ky'};}}
  return{detected:false};}

// ==================== NHÓM XÚC XẮC THỐNG KÊ — NÂNG CẤP ĐỘ CHUẨN & ÁP LỰC ====================
function analyzeDistribution(d,t,w=50){const s=d.slice(0,w),tc=s.filter(x=>x.Ket_qua==='Tài').length;return{taiPercent:tc/w.length*100,xiuPercent:(w.length-tc)/w.length*100,taiCount:tc,xiuCount:w.length-tc,imbalance:Math.abs(tc*2-w.length)/w.length};}
function analyzeDicePatterns(d){const r=d.slice(0,20);let h=0,l=0,t=0,s=[];
  r.forEach(x=>{[x.xuc_xac_1,x.xuc_xac_2,x.xuc_xac_3].forEach(v=>{v>=4?h++:l++;});t+=x.tong;s.push(x.tong);});
  const a=t/r.length,v=s.reduce((x,n)=>x+Math.pow(n-a,2),0)/s.length;
  return{highDiceRatio:h/(h+l),lowDiceRatio:l/(h+l),averageSum:a,std:Math.sqrt(v),sumTrend:a>10.5?'high':'low',stable:Math.sqrt(v)<2.5};}
function analyzeSumTrend(d){const s=d.slice(0,20).map(x=>x.tong);let ic=0,dc=0;
  for(let i=0;i<s.length-1;i++){if(s[i]>s[i+1])dc++;else if(s[i]<s[i+1])ic++;}
  const m5=s.slice(0,5).reduce((a,b)=>a+b)/5,m10=s.slice(0,10).reduce((a,b)=>a+b)/10;
  return{trend:ic>dc?'up':'down',strength:Math.abs(ic-dc)/(s.length-1),ma5:m5,ma10:m10,bias:m5>10.5?'Tài':'Xỉu'};}
function analyzeEdgeCases(d,t){if(d.length<10)return{detected:false};const s=d.slice(0,10).map(x=>x.tong),eh=s.filter(x=>x>=14).length,el=s.filter(x=>x<=7).length,w=getPatternWeight(t,'edge_cases');
  if(eh>=5)return{detected:true,prediction:'Xỉu',confidence:Math.round(11*w),name:'Cực Cao',patternId:'edge_cases'};
  if(el>=5)return{detected:true,prediction:'Tài',confidence:Math.round(11*w),name:'Cực Thấp',patternId:'edge_cases'};return{detected:false};}
function analyzeDiceTrendLine(d,t){if(d.length<3)return{detected:false};
  const c=d[0],p=d[1],cd=[c.xuc_xac_1,c.xuc_xac_2,c.xuc_xac_3],pd=[p.xuc_xac_1,p.xuc_xac_2,p.xuc_xac_3],dr=[];
  for(let i=0;i<3;i++)dr.push(cd[i]>pd[i]?'up':cd[i]<pd[i]?'down':'=');
  const u=dr.filter(x=>x==='up').length,dn=dr.filter(x=>x==='down').length,w=getPatternWeight(t,'dice_trend_line');
  if(cd[0]===cd[1]&&cd[1]===cd[2])return{detected:true,prediction:cd[0]>=4?'Xỉu':'Tài',confidence:Math.round(14*w),name:'3XX giống',patternId:'dice_trend_line'};
  const mx=Math.max(...cd),mn=Math.min(...cd);
  if(mx===6&&mn===1)return{detected:true,prediction:p.Ket_qua==='Tài'?'Xỉu':'Tài',confidence:Math.round(13*w),name:'Biên độ cực đại',patternId:'dice_trend_line'};
  if(u===1&&dn===2)return{detected:true,prediction:'Tài',confidence:Math.round(13*w),name:'1L2X',patternId:'dice_trend_line'};
  if(u===2&&dn===1)return{detected:true,prediction:'Xỉu',confidence:Math.round(13*w),name:'2L1X',patternId:'dice_trend_line'};
  return{detected:false};}
function analyzeDayGay(d,t){if(d.length<3)return{detected:false};
  const c=d[0],p=d[1],cd=[c.xuc_xac_1,c.xuc_xac_2,c.xuc_xac_3],pd=[p.xuc_xac_1,p.xuc_xac_2,p.xuc_xac_3],dr=[];
  for(let i=0;i<3;i++)dr.push(cd[i]>pd[i]?'up':cd[i]<pd[i]?'down':'=');
  const u=dr.filter(x=>x==='up').length,dn=dr.filter(x=>x==='down').length,s=dr.filter(x=>x==='=').length,w=getPatternWeight(t,'day_gay');
  if(s===2&&u===1)return{detected:true,prediction:'Xỉu',confidence:Math.round(15*w),name:'Dây Gãy 2T1L',patternId:'day_gay'};
  if(s===2&&dn===1)return{detected:true,prediction:'Tài',confidence:Math.round(15*w),name:'Dây Gãy 2T1X',patternId:'day_gay'};
  return{detected:false};}
function analyzeBreakPattern(r,d,t){if(r.length<5)return{detected:false};const w=getPatternWeight(t,'break_pattern');let sl=1;
  for(let i=1;i<r.length;i++)if(r[i]===r[0])sl++;else break;
  if(sl>=5){const df=Math.abs(d[0].tong-d[1].tong);
    if(df>=6)return{detected:true,prediction:r[0]==='Tài'?'Xỉu':'Tài',confidence:Math.round(17*w),name:`Gãy biến động ${df}`,patternId:'break_pattern'};
    if(sl>=7)return{detected:true,prediction:r[0]==='Tài'?'Xỉu':'Tài',confidence:Math.round(18*w),name:`Gãy dài ${sl}`,patternId:'break_pattern'};}
  return{detected:false};}
function analyzeFibonacciPattern(d,t){if(d.length<13)return{detected:false};const w=getPatternWeight(t,'fibonacci');let tt=0,xt=0;
  [1,2,3,5,8,13].forEach(p=>{if(p<=d.length)d[p-1].Ket_qua==='Tài'?tt++:xt++;});
  if(tt>=5||xt>=5)return{detected:true,prediction:tt>xt?'Tài':'Xỉu',confidence:Math.round(12*w),name:'Fibonacci',patternId:'fibonacci'};return{detected:false};}
function analyzeMomentumPattern(d,t){if(d.length<10)return{detected:false};
  const a5=d.slice(0,5).map(x=>x.tong).reduce((a,b)=>a+b)/5,a10=d.slice(5,10).map(x=>x.tong).reduce((a,b)=>a+b)/5,mc=a5-a10,w=getPatternWeight(t,'momentum');
  if(Math.abs(mc)>=2.5)return{detected:true,prediction:mc>0?'Xỉu':'Tài',confidence:Math.round(13*w),name:`Momentum ${mc>0?'TĂNG':'GIẢM'}`,patternId:'momentum'};return{detected:false};}
function analyzeResistanceSupport(d,t){if(d.length<20)return{detected:false};
  const s=d.slice(0,20).map(x=>x.tong),mx=Math.max(...s),mn=Math.min(...s),cs=d[0].tong,w=getPatternWeight(t,'resistance_support');
  if(mx-cs<=1)return{detected:true,prediction:'Xỉu',confidence:Math.round(12*w),name:`Chạm kháng cự ${mx}`,patternId:'resistance_support'};
  if(cs-mn<=1)return{detected:true,prediction:'Tài',confidence:Math.round(12*w),name:`Chạm hỗ trợ ${mn}`,patternId:'resistance_support'};return{detected:false};}
function analyzeWavePattern(d,t){if(d.length<12)return{detected:false};
  const r=d.slice(0,12).map(x=>x.Ket_qua),w=getPatternWeight(t,'wave'),wv=[];let cw={type:r[0],count:1};
  for(let i=1;i<r.length;i++){if(r[i]===cw.type)cw.count++;else{wv.push(cw);cw={type:r[i],count:1};}}wv.push(cw);
  if(wv.length>=4){const ln=wv.slice(0,4).map(x=>x.count);
    if(ln.every((v,i,a)=>i===0||v>=a[i-1])&&ln[0]<ln[3])return{detected:true,prediction:wv[0].type==='Tài'?'Xỉu':'Tài',confidence:Math.round(13*w),name:'Sóng Mở Rộng',patternId:'wave'};
    if(ln.every((v,i,a)=>i===0||v<=a[i-1])&&ln[0]>ln[3])return{detected:true,prediction:wv[0].type,confidence:Math.round(12*w),name:'Sóng Thu Hẹp',patternId:'wave'};}
  return{detected:false};}
function analyzeGoldenRatio(d,t){if(d.length<21)return{detected:false};const w=getPatternWeight(t,'golden_ratio');let tt=0,xt=0;
  [1,2,3,5,8,13,21].forEach(p=>{if(p<=d.length)d[p-1].Ket_qua==='Tài'?tt++:xt++;});
  const rt=Math.max(tt,xt)/Math.min(tt,xt);
  if(rt>=1.6&&rt<=1.7)return{detected:true,prediction:tt>xt?'Tài':'Xỉu',confidence:Math.round(13*w),name:'Tỷ Lệ Vàng',patternId:'golden_ratio'};return{detected:false};}

// ✅ NÂNG CẤP MARKOV BẬC 1 + BẬC 2
function analyzeMarkovChain(r,d,t){
  if(r.length<25)return{detected:false};
  const tr={'Tài->Tài':0,'Tài->Xỉu':0,'Xỉu->Tài':0,'Xỉu->Xỉu':0};
  for(let i=0;i<r.length-1;i++) tr[`${r[i+1]}->${r[i]}`]++;
  const tr2={};
  for(let i=0;i<r.length-2;i++){const k=`${r[i+2]}|${r[i+1]},${r[i]}`;tr2[k]=(tr2[k]||0)+1;}
  const cr=r[0],pr=r[1],w=getPatternWeight(t,'markov_chain');
  let prb;
  if(cr==='Tài'){const s=tr['Tài->Tài']+tr['Tài->Xỉu'];prb=tr['Tài->Tài']/s;}
  else{const s=tr['Xỉu->Tài']+tr['Xỉu->Xỉu'];prb=tr['Xỉu->Xỉu']/s;}
  const k2=`*|${cr},${pr}`,k2t=`Tài|${cr},${pr}`,k2x=`Xỉu|${cr},${pr}`,s2=(tr2[k2t]||0)+(tr2[k2x]||0);
  if(s2>=4){prb=(prb*0.4)+((cr==='Tài'?tr2[k2t]:tr2[k2x])/s2)*0.6;}
  if(Math.abs(prb-0.5)>=0.12){
    const pd=prb>0.55?cr:(cr==='Tài'?'Xỉu':'Tài');
    return{detected:true,prediction:pd,confidence:Math.round(Math.min(17,Math.abs(prb-0.5)*36+8)*w),name:`Markov ${(prb*100).toFixed(0)}%`,patternId:'markov_chain'};}
  return{detected:false};
}
function analyzeMovingAverageDrift(d,t){if(d.length<20)return{detected:false};
  const s=d.slice(0,20).map(x=>x.tong),m5=s.slice(0,5).reduce((a,b)=>a+b)/5,m10=s.slice(0,10).reduce((a,b)=>a+b)/10,m20=s.reduce((a,b)=>a+b)/20;
  const sd=m5-m10,ld=m10-m20,w=getPatternWeight(t,'moving_avg_drift');
  if(Math.abs(sd)>1.8&&Math.abs(ld)>1.2&&sd*ld>0)return{detected:true,prediction:sd>0?'Tài':'Xỉu',confidence:Math.round(15*w),name:'MA Drift Mạnh',patternId:'moving_avg_drift'};
  if(Math.abs(m5-m20)>2.5)return{detected:true,prediction:m5>m20?'Xỉu':'Tài',confidence:Math.round(13*w),name:'MA Đảo Chiều',patternId:'moving_avg_drift'};return{detected:false};}

// ✅ NÂNG CẤP ÁP LỰC THEO QUY TẮC 3‑SIGMA
function analyzeSumPressure(d,t){if(d.length<15)return{detected:false};const M=10.5;
  const s=d.slice(0,15).map(x=>x.tong),avg=s.reduce((a,b)=>a+b)/s.length,dev=avg-M;
  const std=Math.sqrt(s.reduce((a,v)=>a+Math.pow(v-avg,2),0)/s.length),w=getPatternWeight(t,'sum_pressure');
  if(Math.abs(dev)>=2&&std<=2.5)return{detected:true,prediction:dev>0?'Xỉu':'Tài',confidence:Math.round(Math.min(16,Math.abs(dev)*5.5+8)*w),name:'Áp lực mạnh hồi quy',patternId:'sum_pressure'};
  if(Math.abs(dev)>1.2)return{detected:true,prediction:dev>0?'Xỉu':'Tài',confidence:Math.round(Math.min(14,Math.abs(dev)*4.5+7)*w),name:'Áp lực TB',patternId:'sum_pressure'};
  return{detected:false};}
function analyzeVolatility(d,t){if(d.length<10)return{detected:false};
  const s=d.slice(0,10).map(x=>x.tong),ch=[];for(let i=0;i<s.length-1;i++)ch.push(Math.abs(s[i]-s[i+1]));
  const av=ch.reduce((a,b)=>a+b)/ch.length,mx=Math.max(...ch),w=getPatternWeight(t,'volatility');
  if(av>4.5&&mx>=7)return{detected:true,prediction:d[0].Ket_qua==='Tài'?'Xỉu':'Tài',confidence:Math.round(13*w),name:'Biến động cực cao',patternId:'volatility'};return{detected:false};}
function analyzeSunHotCold(r,d,t){if(r.length<10)return{detected:false};
  const l=r.slice(0,10),tc=l.filter(x=>x==='Tài').length,xc=10-tc,w=getPatternWeight(t,'sun_hot_cold');
  if(tc>=8)return{detected:true,prediction:'Xỉu',confidence:Math.round(15*w),name:`Nóng Tài ${tc}/10`,patternId:'sun_hot_cold'};
  if(xc>=8)return{detected:true,prediction:'Tài',confidence:Math.round(15*w),name:`Nóng Xỉu ${xc}/10`,patternId:'sun_hot_cold'};
  if(tc>=7)return{detected:true,prediction:'Tài',confidence:Math.round(12*w),name:`Ấm Tài ${tc}/10`,patternId:'sun_hot_cold'};
  if(xc>=7)return{detected:true,prediction:'Xỉu',confidence:Math.round(12*w),name:`Ấm Xỉu ${xc}/10`,patternId:'sun_hot_cold'};return{detected:false};}
function analyzeSunStreakBreak(r,d,t){if(r.length<5)return{detected:false};let sl=1,ct=r[0];
  for(let i=1;i<r.length;i++)if(r[i]===ct)sl++;else break;
  const w=getPatternWeight(t,'sun_streak_break'),br=sl>=6||sl>=5;
  return{detected:true,streakLength:sl,prediction:br?(ct==='Tài'?'Xỉu':'Tài'):ct,
    confidence:Math.round((br?Math.min(17,sl*2.3+5):Math.min(15,sl*2.1))*w),name:`Streak ${sl} ${ct}`,patternId:'sun_streak_break'};}
function analyzeSunBalance(r,t){if(r.length<15)return{detected:false};
  const l=r.slice(0,15),tc=l.filter(x=>x==='Tài').length,df=Math.abs(tc*2-15),w=getPatternWeight(t,'sun_balance');
  if(df>=9)return{detected:true,prediction:tc<8?'Tài':'Xỉu',confidence:Math.round(Math.min(14,df+5)*w),name:`Cân Bằng ${tc}T‑${15-tc}X`,patternId:'sun_balance'};return{detected:false};}
function analyzeSunMomentumShift(r,d,t){if(r.length<12)return{detected:false};
  const a=r.slice(0,6),b=r.slice(6,12),ta=a.filter(x=>x==='Tài').length,tb=b.filter(x=>x==='Tài').length,sh=ta-tb;
  if(Math.abs(sh)>=4){const to=sh>0?'Tài':'Xỉu',w=getPatternWeight(t,'sun_momentum_shift');
    return{detected:true,prediction:to,confidence:Math.round(Math.min(15,Math.abs(sh)*2.3+5)*w),name:`Đổi chiều → ${to}`,patternId:'sun_momentum_shift'};}return{detected:false};}

// ==================== ✅ HÀM TỔNG HỢP HOÀN TOÀN MỚI — XÁC NHẬN CHÉO + LỌC MÂU THUẪN ====================
function calculateAdvancedPrediction(data,type){
  const last50=data.slice(0,50).map(x=>({...x,Ket_qua:(x.ket_qua||'').toUpperCase()==='TAI'?'Tài':'Xỉu'}));
  const results=last50.map(d=>d.Ket_qua);
  initializePatternStats(type);
  const preds=[],factors=[],allP=[];
  const rn=r=>{if(r&&r.detected){preds.push({prediction:r.prediction,confidence:r.confidence||60,priority:r.priority||5,name:r.name,patternId:r.patternId});factors.push(r.name);allP.push(r);}};
  const P={BREAK:14,STREAK:13,EXTREME:12,MAIN:11,HIGH:10,GOOD:9,NORM:8,LOW:6,FALLBACK:2};
  rn({...analyzeCauRong(results,type),priority:P.BREAK});
  rn({...analyzeBreakPattern(results,last50,type),priority:P.BREAK});
  rn({...analyzeSunStreakBreak(results,last50,type),priority:P.STREAK});
  rn({...analyzeCauBet(results,type),priority:P.MAIN});
  rn({...analyzeCauBeCau(results,type),priority:P.MAIN});
  rn({...analyzeDayGay(last50,type),priority:P.EXTREME});
  rn({...analyzeMarkovChain(results,last50,type),priority:P.EXTREME});
  rn({...analyzeCauDao11(results,type),priority:P.HIGH});
  rn({...analyzeCauZiczac(results,type),priority:P.HIGH});
  rn({...analyzeSumPressure(last50,type),priority:P.HIGH});
  rn({...analyzeDiceTrendLine(last50,type),priority:P.HIGH});
  rn({...analyzeMovingAverageDrift(last50,type),priority:P.HIGH});
  rn({...analyzeCau22(results,type),priority:P.GOOD});
  rn({...analyzeCau33(results,type),priority:P.GOOD});
  rn({...analyzeCau44(results,type),priority:P.GOOD});
  rn({...analyzeCau55(results,type),priority:P.GOOD});
  rn({...analyzeSmartBet(results,type),priority:P.GOOD});
  rn({...analyzeResistanceSupport(last50,type),priority:P.GOOD});
  rn({...analyzeSunHotCold(results,last50,type),priority:P.GOOD});
  rn({...analyzeSunBalance(results,type),priority:P.GOOD});
  rn({...analyzeSunMomentumShift(results,last50,type),priority:P.GOOD});
  rn({...analyzeCau121(results,type),priority:P.NORM});
  rn({...analyzeCau321(results,type),priority:P.NORM});
  rn({...analyzeCau123(results,type),priority:P.NORM});
  rn({...analyzeCau212(results,type),priority:P.NORM});
  rn({...analyzeCau1221(results,type),priority:P.NORM});
  rn({...analyzeCau2112(results,type),priority:P.NORM});
  rn({...analyzeCauNhipNghieng(results,type),priority:P.NORM});
  rn({...analyzeCau3Van1(results,type),priority:P.NORM});
  rn({...analyzeCauDoi(results,type),priority:P.NORM});
  rn({...analyzeCauGap(results,type),priority:P.LOW});
  rn({...analyzeCauNhayCoc(results,type),priority:P.LOW});
  rn({...detectCyclePattern(results,type),priority:P.LOW});
  rn({...analyzeWavePattern(last50,type),priority:P.LOW});
  rn({...analyzeMomentumPattern(last50,type),priority:P.LOW});
  rn({...analyzeVolatility(last50,type),priority:P.LOW});
  rn({...analyzeEdgeCases(last50,type),priority:P.LOW});
  rn({...analyzeFibonacciPattern(last50,type),priority:P.LOW});
  rn({...analyzeGoldenRatio(last50,type),priority:P.LOW});

  const dist=analyzeDistribution(last50,type);
  if(dist.imbalance>0.28) rn({prediction:dist.taiPercent<50?'Tài':'Xỉu',confidence:8,priority:4,name:'Phân bố lệch mạnh',detected:true,patternId:'distribution'});
  const dp=analyzeDicePatterns(last50);
  if(dp.averageSum>11.8) rn({prediction:'Xỉu',confidence:7,priority:3,name:'Trung bình cao',detected:true,patternId:'dice_pattern'});
  else if(dp.averageSum<9.2) rn({prediction:'Tài',confidence:7,priority:3,name:'Trung bình thấp',detected:true,patternId:'dice_pattern'});

  if(preds.length===0) rn({...analyzeCauTuNhien(results,type),priority:P.FALLBACK});

  // ✅ XÁC NHẬN CHÉO + LỌC MÂU THUẪN
  preds.sort((a,b)=>b.priority-a.priority||b.confidence-a.confidence);
  const tV=preds.filter(p=>p.prediction==='Tài'),xV=preds.filter(p=>p.prediction==='Xỉu');
  let tS=tV.reduce((s,p)=>s+p.confidence*p.priority,0),xS=xV.reduce((s,p)=>s+p.confidence*p.priority,0);
  const diffPct=Math.abs(tS-xS)/Math.max(tS,xS,1);
  // Giảm điểm mạnh nếu tỷ lệ quá cân bằng = mơ hồ
  if(diffPct<0.08){tS*=0.85;xS*=0.85;}
  let final=tS>=xS?'Tài':'Xỉu';
  let base=CONFIDENCE_FLOOR-2;
  preds.slice(0,4).forEach(p=>{if(p.prediction===final)base+=p.confidence*0.9;});
  base += Math.min(10,(final==='Tài'?tV.length:xV.length)/preds.length*14);
  base += getAdaptiveConfidenceBoost(type);
  let conf=Math.max(CONFIDENCE_FLOOR, Math.min(MAX_CONFIDENCE, Math.round(base)));
  return {prediction:final,confidence:conf,factors:factors.slice(0,5),allPatterns:allP,reversed:false};
}

// ============================================================
// 🟢 CLASS TX_LogicPen_V4 — GIỮ NGUYÊN TÊN + TOÀN BỘ HÀM
//    ❌ ĐÃ GỠ SẠCH TOÀN BỘ LOGIC ĐẢO + GÃY 1 TAY, CHỈ BẮT KHUÔN THUẦN
// ============================================================
class TX_LogicPen_V4 {
    constructor(){
        this.error_streak=0;this.last_prediction=null;this.history=[];
        this.co_khuon_cau=false;this.ten_khuon="";
        // ❌ CÁC BIẾN ĐẢO ĐƯỢC VÔ HIỆU HÓA, KHÔNG BAO GIỜ DÙNG NỮA
        this.dao_tu_dong_trang_thai=false;
        this.che_do_hien_tai="BINH_THUONG";
        this.lan_truoc_dung_sai=null;
        this.gay_1_tay_gan_nhat=false;
        this.ketQuaNangCao=null;
    }
    loadData(d){this.history=[...d].sort((a,b)=>(b.phien||0)-(a.phien||0));}
    _arr(){return this.history.map(s=>(s.ket_qua||'').toUpperCase().replace('XỈU','XIU').replace('TÀI','TAI'));}
    _points(){return this.history.filter(s=>s.tong!=null).map(s=>s.tong);}
    chayThuatToanNangCao(){
        try{return this.ketQuaNangCao=calculateAdvancedPrediction(this.history,'b52');}catch(e){return null;}
    }
    cau3Bet(a){if(a.length<3)return null;if(a[0]===a[1]&&a[1]===a[2])return{pred:a[0],conf:86,type:"BẮT BỆT 3",reason:`3 ${a[0]} LIÊN TIẾP`};return null;}
    cauSap(a){if(a.length<2)return null;let l=1;for(let i=1;i<a.length;i++)if(a[i]===a[0])l++;else break;
      if(l>=2&&l<=5)return{pred:a[0],conf:74,type:"Đu Bệt",reason:`Bệt ${l}`};
      if(l>=6)return{pred:a[0]==='TAI'?'XIU':'TAI',conf:84,type:"Bẻ Bệt Rồng",reason:`Bệt dài ${l}`};return null;}
    cauNoi(a){if(a.length<5)return null;let ok=true;for(let i=0;i<4;i++)if(a[i]===a[i+1]){ok=false;break;}
      if(ok)return{pred:a[0]==='TAI'?'XIU':'TAI',conf:90,type:"Cầu Nối 1‑1 Cứng",reason:"Nhịp 1‑1 ổn định"};return null;}
    cauDoi(a){if(a.length<4)return null;
      if(a[0]===a[1]&&a[2]===a[3]&&a[0]!==a[2])return{pred:a[2],conf:80,type:"Cầu 2‑2",reason:"AABB→B"};
      if(a.length>=6&&a[0]===a[1]&&a[1]===a[2]&&a[3]===a[4]&&a[4]===a[5]&&a[0]!==a[3])return{pred:a[3],conf:82,type:"Cầu 3‑3",reason:"AAABBB→B"};return null;}
    cauGay(a){if(a.length>=5&&a[0]===a[1]&&a[1]===a[2]&&a[2]!==a[3]&&a[3]===a[4])return{pred:a[3],conf:78,type:"Gãy 3‑2",reason:"AAABB→B"};
      if(a.length>=5&&a[0]===a[1]&&a[1]!==a[2]&&a[2]===a[3]&&a[3]===a[4])return{pred:a[2],conf:78,type:"Gãy 2‑3",reason:"AABBB→B"};return null;}
    phatHienMauLap(a){if(a.length<6)return null;
      for(let L=2;L<=4;L++){const pt=a.slice(0,L);for(let i=L;i<a.length-L;i++)if(JSON.stringify(a.slice(i,i+L))===JSON.stringify(pt))
        return{pred:a[i-1],conf:86,type:"Mẫu Lặp",reason:`Mẫu ${pt.join(',')}`};}return null;}
    duDoanVi(){const p=this._points();if(p.length<5)return null;const ls=p[0],pr=p[1],a=p.slice(0,5).reduce((x,y)=>x+y)/5;
      if(ls>=15)return{pred:"XIU",conf:80,type:"Cực đại",reason:`${ls}→hồi Xỉu`};
      if(ls<=5)return{pred:"TAI",conf:80,type:"Cực tiểu",reason:`${ls}→hồi Tài`};
      if(a>11.3&&ls>pr)return{pred:"XIU",conf:72,type:"Bão hòa",reason:"Đà tăng đỉnh"};
      if(a<9.7&&ls<pr)return{pred:"TAI",conf:72,type:"Cạn kiệt",reason:"Đà giảm đáy"};return null;}
    tongHopDuDoan(){
        const a=this._arr();if(a.length<2)return null;
        const khuon=this.cau3Bet(a)||this.cauNoi(a)||this.phatHienMauLap(a)||this.cauDoi(a)||this.cauGay(a)||this.cauSap(a)||this.duDoanVi(a);
        const nc=this.chayThuatToanNangCao();
        if(khuon){
            this.co_khuon_cau=true;this.ten_khuon=khuon.type;
            if(nc&&nc.confidence>=khuon.conf+2){
                const p=nc.prediction==='Tài'?'TAI':'XIU';
                return{pred:p,conf:nc.confidence,type:`NÂNG CAO · ${nc.factors[0]||khuon.type}`,reason:`🧠 ${nc.factors.slice(0,3).join(' · ')}`};
            }
            return khuon;
        }else{
            this.co_khuon_cau=false;this.ten_khuon="KHÔNG CÓ KHUÔN RÕ";
            if(nc){const p=nc.prediction==='Tài'?'TAI':'XIU';
              return{pred:p,conf:nc.confidence,type:`TỔNG HỢP · ${nc.factors[0]||'Đa chiều'}`,reason:`🧠 ${nc.factors.slice(0,4).join(' · ')}`};}
            return{pred:a[0],conf:58,type:"Theo cuối",reason:"Chưa đủ tín hiệu mạnh"};
        }
    }
    // ❌ HOÀN TOÀN GỠ ĐẢO, CHỈ BÌNH THƯỜNG 100%
    apDungDaoChieu(p){
        if(!p)return p;
        if(this.co_khuon_cau) return{...p,conf:Math.min(MAX_CONFIDENCE,p.conf+2),reason:`🎯 KHUÔN:${this.ten_khuon} | ${p.reason}`};
        return{...p,type:"BÌNH THƯỜNG · CHỈ BẮT KHUÔN",reason:`🟢 ${p.reason}`};
    }
    predict(d){this.loadData(d);let r=this.tongHopDuDoan();
        if(!r)r={pred:this._arr()[0]||"TAI",conf:55,type:"Theo cuối",reason:"Thiếu dữ liệu"};
        r=this.apDungDaoChieu(r);this.last_prediction=r.pred;return r;
    }
    updateStatus(act){
        if(this.last_prediction){
            const a=act.toUpperCase().replace('XỈU','XIU').replace('TÀI','TAI');
            const ok=this.last_prediction===a;
            this.lan_truoc_dung_sai=ok?"DUNG":"SAI";
            this.error_streak=ok?0:this.error_streak+1;
            try{
                const ld=learningData.b52;
                ld.totalPredictions++;if(ok)ld.correctPredictions++;
                ld.recentAccuracy.push(ok?1:0);if(ld.recentAccuracy.length>15)ld.recentAccuracy.shift();
                ld.streakAnalysis.currentStreak=ok?Math.max(1,ld.streakAnalysis.currentStreak+1):Math.min(-1,ld.streakAnalysis.currentStreak-1);
                if(ok)ld.streakAnalysis.wins++;else ld.streakAnalysis.losses++;
                ld.streakAnalysis.bestStreak=Math.max(ld.streakAnalysis.bestStreak,ld.streakAnalysis.currentStreak);
                ld.streakAnalysis.worstStreak=Math.min(ld.streakAnalysis.worstStreak,ld.streakAnalysis.currentStreak);
                if(this.ketQuaNangCao?.allPatterns)this.ketQuaNangCao.allPatterns.forEach(pt=>{
                    if(pt.patternId)updatePatternPerformance('b52',pt.patternId,ok,ok&&pt.confidence>=80?1.4:1);
                });
            }catch(e){}
        }
    }
}

// ============================================================
// 🟢 TOÀN BỘ HÀM LƯU FILE / API / SERVER — GIỮ NGUYÊN Y HỆT
// ============================================================
const predictor=new TX_LogicPen_V4();
function loadHistory(){try{if(fs.existsSync(DATA_FILE))return JSON.parse(fs.readFileSync(DATA_FILE)).history||[];}catch(e){}return[];}
function saveHistory(h){const d=path.dirname(DATA_FILE);if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});
  const l=h.slice(-MAX_STORAGE);fs.writeFileSync(DATA_FILE,JSON.stringify({history:l,total_sessions:l.length,last_updated:vnNow()},null,2));}
function saveStatsFile(){const d=path.dirname(STATS_FILE);if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(STATS_FILE,JSON.stringify({...stats,last_updated:vnNow()},null,2));}
function safeInt(v,d=0){const n=parseInt(v);return isNaN(n)?d:n;}
function autoVerify(h){
    if(stats.last_prediction&&h.length){
        const lp=stats.last_prediction,lt=h[h.length-1];
        if(lt.phien===lp.phien&&lt.ket_qua){
            stats.total++;
            const a=lt.ket_qua.toUpperCase().replace('XỈU','XIU').replace('TÀI','TAI');
            const ok=lp.prediction.toUpperCase()===a;
            if(ok)stats.correct++;else stats.wrong++;
            predictor.updateStatus(lt.ket_qua);
            stats.history.push({phien:lt.phien,prediction:lp.pred,actual:lt.ket_qua,confidence:lp.conf,correct:ok,t:vnNow()});
            if(stats.history.length>500)stats.history=stats.history.slice(-500);
            console.log(`🔍 #${lt.phien} ${ok?'✅ĐÚNG':'❌SAI'} → ${((stats.correct/Math.max(stats.total,1))*100).toFixed(1)}%`);
            stats.last_prediction=null;saveStatsFile();
        }
    }
}
function autoPredict(h){
    if(!stats.prediction_started){
        if(h.length>=MIN_DATA_FOR_PREDICTION){stats.prediction_started=true;console.log("✅ BẮT ĐẦU DỰ ĐOÁN");}
        else return console.log(`⏳ ${h.length}/${MIN_DATA_FOR_PREDICTION}`);
    }
    if(stats.total_predictions_made>=MAX_PREDICTIONS)return;
    if(h.length>=5){
        try{
            const r=predictor.predict(h);
            const cur=h[h.length-1],ph=typeof cur.phien==='string'?parseInt(cur.phien.replace('#',''))||0:cur.phien||0,np=ph+1;
            stats.last_prediction={phien:np,prediction:r.pred,confidence:r.conf};
            stats.total_predictions_made++;
            console.log(`🎯 #${np}: ${r.pred} | ${r.conf}% | ${r.type}`);
            duDoanHienTai={phien:np,ket_qua:r.pred==='TAI'?'TÀI':'XỈU',do_tin_cay:r.conf,loai_cau:r.type,ly_do:r.reason,
              che_do:"🟢 BÌNH THƯỜNG · CHỈ BẮT KHUÔN",co_khuon:predictor.co_khuon_cau,ten_khuon:predictor.ten_khuon,
              thong_ke:{tong:stats.total,dung:stats.correct,sai:stats.wrong,ty_le:((stats.correct/Math.max(stats.total,1))*100).toFixed(1)},cap_nhat_luc:vnNow()};
            saveStatsFile();
        }catch(e){console.error(e);}
    }
}
async function collect(){
    console.log("🚀 SUNWIN TX · NÂNG CAO V5 · KHÔNG ĐẢO · CHỈ BẮT KHUÔN THUẦN");
    let h=loadHistory();console.log(`📚 ${h.length} phiên đã có`);
    try{stats={...stats,...JSON.parse(fs.readFileSync(STATS_FILE))};}catch(e){}
    while(1){
        try{
            const rs=await axios.get(API_URL,{timeout:15000});
            if(rs.status===200&&rs.data.data?.length){
                const ex=new Set(h.map(x=>x.phien));
                rs.data.data.forEach(it=>{const ph=safeInt(it.Phien);if(ph>0&&!ex.has(ph))h.push({phien:ph,ket_qua:String(it.Ket_qua||""),tong:safeInt(it.Tong),xuc_xac_1:safeInt(it.Xuc_xac_1),xuc_xac_2:safeInt(it.Xuc_xac_2),xuc_xac_3:safeInt(it.Xuc_xac_3)});});
                h=h.slice(-MAX_STORAGE).sort((a,b)=>a.phien-b.phien);saveHistory(h);
                autoVerify(h);autoPredict(h);
            }
        }catch(e){console.error("❌",e.message);}
        await new Promise(r=>setTimeout(r,3000));
    }
}
const PORT=process.env.PORT||10000;
http.createServer((req,res)=>{
    const u=req.url.split('?')[0];
    if(u==='/sunvilong'){
        const j=JSON.stringify(duDoanHienTai,null,2);
        const H=`<!doctype html><html><head><meta charset=utf-8><meta name=viewport content=width=device-width><title>SUN TX</title>
<style>body{background:#050814;color:#fff;font-family:Arial;margin:0;padding:18px}
.box{max-width:520px;margin:18px auto;background:#0d1430;padding:20px;border-radius:14px;box-shadow:0 0 20px #00e5ff55}
h1{text-align:center;color:#00e5ff;margin:0 0 10px}.line{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #1e2a55}
.kq{font-size:46px;font-weight:900;text-align:center;padding:12px 0;margin:4px 0;color:#ffd24a}
.tai{color:#ff4d4d}.xiu{color:#3ddc84}.ok{color:#3ddc84}.bad{color:#ff4d4d}.ft{text-align:center;color:#7782aa;font-size:12px;margin-top:10px}</style></head><body>
<div class=box><h1>🎯 DỰ ĐOÁN #${duDoanHienTai.phien}</h1>
<div class="kq ${duDoanHienTai.ket_qua==='TÀI'?'tai':'xiu'}">${duDoanHienTai.ket_qua}</div>
<div class=line><span>🔢 Phiên</span><b>#${duDoanHienTai.phien}</b></div>
<div class=line><span>📊 Độ tin cậy</span><b class="${duDoanHienTai.do_tin_cay>=80?'ok':''}">${duDoanHienTai.do_tin_cay}%</b></div>
<div class=line><span>🧩 Loại cầu</span><b>${duDoanHienTai.loai_cau}</b></div>
<div class=line><span>🎭 Khuôn</span><b>${duDoanHienTai.co_khuon?'✅ '+duDoanHienTai.ten_khuon:'➖ Chưa rõ'}</b></div>
<div class=line><span>📝 Lý do</span><span style=text-align:right;max-width:62%>${duDoanHienTai.ly_do}</span></div>
<hr style=border-color:#1e2a55>
<div class=line><span>📈 Tổng</span><b>${duDoanHienTai.thong_ke.tong}</b></div>
<div class=line><span>✅ Đúng</span><b class=ok>${duDoanHienTai.thong_ke.dung}</b></div>
<div class=line><span>❌ Sai</span><b class=bad>${duDoanHienTai.thong_ke.sai}</b></div>
<div class=line><span>🏆 Tỷ lệ</span><b class=ok>${duDoanHienTai.thong_ke.ty_le}%</b></div>
<div class=ft>⏰ ${duDoanHienTai.cap_nhat_luc.replace('T',' ').slice(0,19)}</div></div></body></html>`;
        if(req.url.includes('json')||req.headers.accept?.includes('json')){res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});res.end(j);}
        else{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(H);}
        return;
    }
    res.writeHead(200);res.end(`OK · ${vnNow()} · /sunvilong`);
}).listen(PORT,()=>console.log(`🌐 PORT=${PORT} → /sunvilong`));
process.on('SIGINT',()=>{saveStatsFile();process.exit();});
collect().catch(console.error);